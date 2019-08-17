require('es6-promise').polyfill();
require('isomorphic-fetch');

const resource_connection = require('../abstract.js');

module.exports = class resource_connection_http_range extends resource_connection {
	constructor(p_url, h_headers={}) {
		super();

		Object.assign(this, {
			url: p_url,
			mode: p_url.startsWith(location.origin)? 'same-origin': 'cors',
			headers: h_headers,
			bytes: Infinity,
		});
	}

	async init() {
		// already initialized
		if(Infinity !== this.bytes) return this.bytes;

		// issue HEAD request for content length
		let d_res = await fetch(new Request(this.url, {
			method: 'HEAD',
			mode: this.mode,
			redirect: 'error',
		}))
			.catch((e_res) => {
				throw new Error(e_res);
			});

		// response headers
		let d_headers = d_res.headers;

		// parse content length
		this.bytes = +d_headers.get('content-length');
	}

	// direct fetch of a single range
	async fetch(i_lo, i_hi) {
		let d_res = await fetch(new Request(this.url, {
			method: 'GET',
			mode: this.mode,
			redirect: 'error',
			headers: Object.assign({}, this.headers, {
				Range: 'bytes='+i_lo+'-'+i_hi,
			}),
		}))
			.catch((e_res) => {
				debugger;
				throw new Error(e_res);
			});

		return new Uint8Array(await d_res.arrayBuffer());
	}

	// direct fetch of multiple ranges
	async fetch_ranges(a_ranges) {
		let d_res = await fetch(new Request(this.url, {
			method: 'GET',
			headers: Object.assign({}, this.headers, {
				Range: 'bytes='+a_ranges.map(a => a[0]+'-'+a[1]).join(', '),
			}),
		}))
			.catch((e_res) => {
				debugger;
				throw new Error(e_res);
			});

		debugger;
		console.info(d_res);
	}
};
