require('isomorphic-fetch');

const bkit = require('bkit');
const content_type = require('content-type');

const ResourceConnection = require('../class/resource-connection.js');
const {
	ResourceConnectionError,
} = require('../main/locals.js');



async function ResourceConnection_HttpRange$fetch(k_self, d_req) {
	let d_res;

	try {
		// fetch attempt (allow it to throw on network error)
		d_res = await fetch(d_req);
	}
	catch(e_fetch) {
		// wrap in resource connection error
		throw new ResourceConnectionError(e_fetch);
	}

	// bad response; throw to handler to deal with strategy
	if(!d_res.ok) {
		throw new ResourceConnectionError.HttpStatus(d_res);
	}

	// return response
	return d_res;
}


async function ResourceConnection_HttpRange$fetch_content(k_self, d_req) {
	let d_res;

	try {
		// fetch attempt (allow it to throw on network error)
		d_res = await fetch(d_req);
	}
	catch(e_fetch) {
		// wrap in resource connection error
		throw new ResourceConnectionError(e_fetch);
	}

	// request range out of bounds
	if(416 === d_res.status) {
		throw new ResourceConnectionError.Range(`416 HTTP/S Response Status Code (${d_res.statusText}) from <${d_res.url}>`);
	}

	// bad response; throw to handler to deal with strategy
	if(!d_res.ok) {
		throw new ResourceConnectionError.HttpStatus(d_res);
	}

	// unexpected response; throw to handler to deal with strategy
	if(206 !== d_res.status) {
		throw new ResourceConnectionError.HttpStatus(d_res, `expected 206 Partial Content status`);
	}

	// ETag verification
	{
		let s_etag = k_self._s_etag;
		if(s_etag) {
			let s_etag_cache = d_res.headers.get('etag');

			// cache mismatch
			if(s_etag !== s_etag_cache) {
				throw new ResourceConnectionError.Cache(`ETag mismatch; the remote resource may have changed since it was last used`);
			}
		}
	}

	// return response
	return d_res;
}

async function ResourceConnection_HttpRange$batch_downgrade(a_ranges) {
	return await Promise.all(a_ranges.map(a => this.fetch(a[0], a[1])));
}


module.exports = class ResourceConnection_HttpRange extends ResourceConnection {
	constructor(p_src, h_headers={}) {
		super();

		Object.assign(this, {
			_p_src: p_src,
			_nb_src: Infinity,
			_s_mode: p_src.startsWith(location.origin)? 'same-origin': 'cors',
			_h_headers: h_headers,
			_s_etag: null,
		});
	}

	async init() {
		// issue HEAD request for content length and accept-ranges header check
		let d_res = await ResourceConnection_HttpRange$fetch(this, new Request(this._p_src, {
			method: 'HEAD',
			mode: this._s_mode,
			redirect: 'error',
		}));

		// response headers
		let d_headers = d_res.headers;

		// check accept-ranges
		if('bytes' !== d_headers.get('accept-ranges')) {
			let s_accept = d_headers.get('accept-ranges');
			throw new ResourceConnectionError.HttpHeader(`expected 'Accept-Ranges: bytes', found ${s_accept? `'${s_accept}'`: 'nothing'} instead`);
		}

		// ETag
		{
			let s_etag = d_headers.get('etag');
			if(s_etag) this._s_etag = s_etag;
		}

		// parse content length
		this._nb_src = +d_headers.get('content-length');

		// done
		return await super.init();
	}

	// direct fetch of a single range
	async fetch(i_lo, i_hi) {
		// fetch range
		let d_res = await ResourceConnection_HttpRange$fetch_content(this, new Request(this._p_src, {
			method: 'GET',
			mode: this._s_mode,
			redirect: 'error',
			headers: Object.assign({}, this._h_headers, {
				Range: 'bytes='+i_lo+'-'+(i_hi-1),
			}),
		}));

		// create buffer
		return new Uint8Array(await d_res.arrayBuffer());
	}

	// direct fetch of multiple ranges
	async batch(a_ranges) {
		// abort controller
		let dac_batch = new AbortController();

		// fetch ranges
		let d_res;
		try {
			d_res = await ResourceConnection_HttpRange$fetch_content(this, new Request(this._p_src, {
				method: 'GET',
				headers: Object.assign({}, this._h_headers, {
					Range: 'bytes='+a_ranges.map(a => a[0]+'-'+(a[1]-1)).join(', '),
				}),
				signal: dac_batch.signal,
			}));
		}
		catch(e_fetch) {
			// 200 HTTP status code
			if(e_fetch instanceof ResourceConnectionError.HttpStatus && 200 === e_fetch.statusCode) {
				// abort request
				dac_batch.abort();

				// change batch mode
				this.batch = ResourceConnection_HttpRange$batch_downgrade;

				// retry
				return this.batch(a_ranges);
			}
			// other error; throw
			else {
				throw e_fetch;
			}
		}

		// ref headers
		let d_headers = d_res.headers;

		// check content type
		let s_content_type = d_headers.get('content-type');

		// parse content type
		let g_content_type;
		try {
			g_content_type = content_type.parse(s_content_type);
		}
		catch(e_parse) {
			throw new ResourceConnectionError.HttpHeader(d_headers, `expected 'Content-Type: multipart/byteranges; ...', failed to parse '${s_content_type}'`);
		}

		// not multipart content-type
		if('multipart/byteranges' !== g_content_type.type) {
			// octet-stream fallback
			if('application/octet-stream' === g_content_type.type) {
				// more than one range was requested
				if(a_ranges.length > 1) {
					throw new ResourceConnectionError.HttpHeader(d_headers, `requested ${a_ranges.length} ranges and so expected 'Content-Type: multipart/byteranges; ...', but received '${g_content_type.type}' instead`);
				}
				// single range: OK
				else {
					// done
					return [
						// load entire respone
						new Uint8Array(await d_res.arrayBuffer()),
					];
				}
			}

			// invalid response type
			throw new ResourceConnectionError.HttpHeader(d_headers, `expected 'Content-Type: multipart/byteranges; ...' or 'Content-Type: application/octet-stream; ...', found '${g_content_type.type}' instead`);
		}

		// missing boundary
		if(!('boundary' in g_content_type.parameters)) {
			throw new ResourceConnectionError.HttpHeader(d_headers, `missing boundary parameter in 'Content-Type' header`);
		}

		// ref boundary string
		let s_boundary = g_content_type.parameters.boundary.replace(/^--/, '');

		// encode to word
		let at_boundary = bkit.encodeUtf8(s_boundary);

		// length of boundary string in bytes
		let nb_boundary = at_boundary.length;

		// load entire respone
		let at_response = new Uint8Array(await d_res.arrayBuffer());

		// response length
		let nb_response = at_response.length;

		// ref 0th byte of boundary
		let xb_dash = '-'.charCodeAt(0);

		// verify first boundary
		{
			// invalid boundary
			if(xb_dash !== at_response[0] || xb_dash !== at_response[1]) {
				throw ResourceConnectionError.raw(`Invalid multipart response body boundary`);
			}

			// verify boundary
			for(let ib_verify=0; ib_verify<nb_boundary; ib_verify++) {
				// character mismatch
				if(at_boundary[ib_verify] !== at_response[2+ib_verify]) {
					throw ResourceConnectionError.raw(`Invalid multipart response body boundary`);
				}
			}
		}

		// search position within response body (skip first boundary)
		let ib_search = nb_boundary;

		// search position hi
		let ib_search_hi = nb_response - 2 - nb_boundary;

		// list of parts
		let a_parts = [];

		// byte position of previous chunk
		let ib_chunk_prev = 0;

		// each part
		for(; ib_search<ib_search_hi;) {
			// find start of boundary
			let ib_boundary = at_response.indexOf(xb_dash, ib_search);

			// next character does not match
			if(xb_dash !== at_response[ib_boundary+1]) {
				// skip over and continue search
				ib_search = ib_boundary + 2;
				continue;
			}

			// position of boundary compare
			let ib_boundary_cmp = ib_boundary + 2;

			// compare strings
			for(let ib_find=0; ib_find<nb_boundary; ib_find++) {
				// character mismatch
				if(at_boundary[ib_find] !== at_response[ib_boundary_cmp+ib_find]) {
					// skip over and continue search
					ib_search = ib_boundary_cmp + ib_find;
					continue;
				}
			}

			// push part
			a_parts.push(at_response.subarray(ib_chunk_prev, ib_boundary));

			// update prev chunk position
			ib_chunk_prev = ib_boundary_cmp + nb_boundary;
		}

		// number of ranges expected
		let nl_ranges = a_ranges.length;

		// part count mismatch
		if(a_parts.length > nl_ranges) {
			throw ResourceConnectionError.raw(`Request ${nl_ranges} ranges but parsed ${a_parts.length} parts from multipart body`);
		}

		// should be at end now
		if(ib_search !== ib_search_hi) {
			throw ResourceConnectionError.raw(`Failed to reach end of multipart body`);
		}

		// return parts
		return a_parts;
	}
};
