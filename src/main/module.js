const {
	B_BROWSER,
} = require('./locals.js');

const rc = require('../rc-iso/locals.js');

const Initable = require('../class/initable.js');
const AsyncLock = require('../class/async-lock.js');

const bkit = require('bkit');


function concat_2(at_a, at_b) {
	// byte count of a buffer
	let nb_a = at_a.byteLength;

	// a is empty; return b
	if(!nb_a) return at_b;

	// new buffer
	let at_out = new Uint8Array(nb_a+at_b.byteLength);

	// copy buffers into place
	at_out.set(at_a);
	at_out.set(at_b, nb_a);

	// return buffer
	return at_out;
}

// extracts the given range from a chunk
function chunk$within(g_chunk, i_ask_lo, i_ask_hi) {
	let i_lo = g_chunk.lo;
	return g_chunk.data.subarray(i_ask_lo-i_lo, i_ask_hi-i_lo);
}

class AsyncBuffer {
	constructor(krc) {
		this._krc = krc;
		this._a_chunks = [];
		this._a_fetches = [];
		this._a_retrievals = [];
		this._kl_chunks = new AsyncLock();
		this._cb_footprint = 0;
		this._cb_footprint_last_update = 0;
		this.fetch = this.fetch_direct;
	}

	get bytes() {
		return this._krc.bytes;
	}

	get footprint() {
		return this._cb_footprint;
	}

	clone() {
		return new AsyncBuffer(this._krc);
	}

	async free() {
		// acquire chunks lock
		await this._kl_chunks.acquire();

		// drop chunks
		this._a_chunks.length = 0;

		// update footprints
		this._cb_footprint = this._cb_footprint_last_update = 0;

		// release chunks lock
		this._kl_chunks.release();
	}

	async validate() {
		let a_chunks = this._a_chunks;

		for(let g_chunk of a_chunks) {
			let {
				lo: ib_chunk_lo,
				hi: ib_chunk_hi,
				data: at_data,
			} = g_chunk;

			let at_fetch = await this._krc.fetch(ib_chunk_lo, ib_chunk_hi);

			let nb_chunk = ib_chunk_hi - ib_chunk_lo;
			console.assert(at_data.length === at_fetch.length);
			for(let ib_check=0; ib_check<nb_chunk; ib_check++) {
				if(at_data[ib_check] !== at_fetch[ib_check]) {
					return [
						ib_chunk_lo+ib_check,
					];
					// debugger;
					// throw new Error(`data / fetch mismatch`);
				}
			}
		}

		return null;
	}


	// create a 'view' on a specific portion of the buffer
	view(i_start, nb_view) {
		return new AsyncView(this, i_start, nb_view);
	}

	// takes multiple slices
	async slices(a_ranges) {
		// acquire chunks lock
		await this._kl_chunks.acquire();

		// mutate fetch method temporarily
		this.fetch = this.fetch_queue;

		// start to perform all slicing (in reverse)
		let adp_slices = a_ranges.reverse().map((a_range) => {
			return this.slice(a_range[0], a_range[1]);
		});

		// fetch all ranges
		let a_retrievals = this._a_retrievals;
		this._krc.fetch_ranges(this._a_fetches).forEach((at_fetch, i_fetch) => {
			// resolve promise
			a_retrievals[i_fetch](at_fetch);
		});

		// gather results
		let a_results = await Promise.all(adp_slices);

		// reset fetch method
		this.fetch = this.fetch_direct;

		// release chunks lock
		this._kl_chunks.release();

		// out
		return a_results.reverse();
	}

	async fetch_direct(i_ask_lo, i_ask_hi) {
		return await this._krc.fetch(i_ask_lo, i_ask_hi);
	}

	fetch_queue(i_ask_lo, i_ask_hi) {
		return new Promise((fk_fetch) => {
			this._a_fetches.push([i_ask_lo, i_ask_hi]);
			this._a_retrievals.push(fk_fetch);
		});
	}

	// returns the number of bytes in cache following the given byte position
	cached(ib_ask_lo) {
		let a_chunks = this._a_chunks;

		// binary search
		let i_lo = 0;
		let i_hi = a_chunks.length;
		while(i_lo < i_hi) {
			let i_mid = (i_lo + i_hi) >>> 1;
			let g_mid = a_chunks[i_mid];
			let {
				lo: ib_chunk_lo,
				hi: ib_chunk_hi,
			} = g_mid;

			// move right
			if(ib_ask_lo >= ib_chunk_hi) {
				i_lo = i_mid + 1;
			}
			// move left
			else if(ib_ask_lo < ib_chunk_lo) {
				i_hi = i_mid;
			}
			// hit; return number of remaining bytes in chunk
			else {
				return ib_chunk_hi - ib_ask_lo;
			}
		}

		// none
		return 0;
	}

	async slice(ib_ask_lo, ib_ask_hi) {
		// acquire chunks lock
		await this._kl_chunks.acquire();

		let a_chunks = this._a_chunks;
		let nl_chunks = a_chunks.length;

		// byte length
		let nl_buffer = this._krc.bytes;

		// lo is out of range
		if(ib_ask_lo >= nl_buffer) {
			await this.validate();
			throw new RangeError('`ib_ask_lo` out of bounds');
		}

		// put hi in range
		if(ib_ask_hi > this._krc.bytes) ib_ask_hi = nl_buffer;

		// no chunks
		if(!nl_chunks) {
			// fetch new part
			let at_add = await this.fetch(ib_ask_lo, ib_ask_hi);

			// create chunk
			let g_chunk = {
				lo: ib_ask_lo,
				hi: ib_ask_hi,
				data: at_add,
			};

			// insert
			a_chunks.push(g_chunk);

			// increment footprint size
			this._cb_footprint += at_add.length;

			// release chunks lock
			this._kl_chunks.release();

			// straight-up
			return g_chunk.data;
		}

		// gaps to be fetched
		let a_gaps = [];

		// byte index of fetch lo
		let ib_fetch_lo = ib_ask_lo;

		// merge left/right flags
		let b_merge_left = false;
		let b_merge_right = false;

		// binary search
		let i_lo = 0;
		let i_hi = nl_chunks;
		while(i_lo < i_hi) {
			let i_mid = (i_lo + i_hi) >>> 1;
			let g_mid = a_chunks[i_mid];
			let {
				lo: ib_chunk_lo,
				hi: ib_chunk_hi,
			} = g_mid;

			// move right
			if(ib_ask_lo >= ib_chunk_hi) {
				i_lo = i_mid + 1;
			}
			// move left
			else if(ib_ask_lo < ib_chunk_lo) {
				i_hi = i_mid;
			}
			// target completely within this chunk
			else if(ib_ask_hi <= ib_chunk_hi) {
				// release chunks lock
				this._kl_chunks.release();

				// return slice within chunk
				return chunk$within(g_mid, ib_ask_lo, ib_ask_hi);
			}
			// target partially overlaps this chunk
			else {
				// set rightside chunk index
				i_hi = i_mid + 1;

				// push fetch lo to chunk hi
				ib_fetch_lo = ib_chunk_hi;

				// merge left
				b_merge_left = true;
				break;
			}
		}

		// index of left-most chunk to merge
		let i_merge_lo;

		// merge left
		if(b_merge_left) {
			i_merge_lo = i_hi - 1;
		}
		// perfect snap-fit; merge left
		else if(i_hi && ib_fetch_lo === a_chunks[i_hi-1].hi) {
			b_merge_left = true;
			i_merge_lo = i_hi - 1;
		}
		// default
		else {
			i_merge_lo = i_hi;
		}

		// index beyond right-most chunk to merge
		let i_merge_hi = Math.min(i_merge_lo+1, nl_chunks);

		// chunk(s) exist to right
		if(i_hi < nl_chunks) {
			// scan index
			let i_scan = i_hi;

			// collect gap ranges
			for(let ib_fetch=ib_fetch_lo; i_scan<nl_chunks; i_scan++) {
				let {
					lo: ib_chunk_lo,
					hi: ib_chunk_hi,
				} = a_chunks[i_scan];

				// add gap range
				a_gaps.push([
					ib_fetch,
					Math.min(ib_chunk_lo, ib_ask_hi),  // fetch hi
				]);

				// advance beyond next chunk
				ib_fetch = ib_chunk_hi;

				// chunk range exceeds ask; break loop
				if(ib_fetch >= ib_ask_hi) {
					i_scan += 1;
					break;
				}
			}

			// ask touches or overlaps chunk
			if(ib_ask_hi >= a_chunks[i_scan-1].lo) {
				// merge right
				b_merge_right = true;

				// set merge hi
				i_merge_hi = Math.min(i_scan, nl_chunks);
			}
			// set merge hi
			else {
				i_merge_hi = i_scan - 1;
			}
		}
		// nothing to right; append range directly
		else {
			a_gaps.push([
				ib_fetch_lo,
				ib_ask_hi,
			]);
		}

		// fetch all gap ranges at once
		let a_fetched = await this._krc.fetch_ranges(a_gaps);

		// byte size of new merged chunk
		let cb_merge = ib_ask_hi - ib_ask_lo;

		// lo/hi of merge chunk
		let ib_merge_lo = ib_ask_lo;
		let ib_merge_hi = ib_ask_hi;

		// merge left
		if(b_merge_left) {
			// update lo of merge chunk
			ib_merge_lo = a_chunks[i_merge_lo].lo;

			// add left chunk size diff
			cb_merge += (ib_ask_lo - ib_merge_lo);
		}

		// merge right
		if(b_merge_right) {
			// update hi of merge chunk
			ib_merge_hi = a_chunks[i_merge_hi-1].hi;

			// add right chunk size diff
			cb_merge += (ib_merge_hi - ib_ask_hi);
		}

		// alloc merge output buffer
		let at_merge = new Uint8Array(cb_merge);

		// byte write position in buffer
		let ib_write = 0;

		// index of chunk to traverse
		let i_merge = i_merge_lo;

		// merge left
		if(b_merge_left) {
			// ref chunk data
			let at_left = a_chunks[i_merge++].data;

			// copy to merge buffer
			at_merge.set(at_left);

			// update write position
			ib_write = at_left.length;
		}

		// footprint size
		let cb_footprint = this._cb_footprint;

		// each fetch/chunk pair
		for(let i_fetch_copy=0; ib_write<cb_merge;) {
			// ref fetch data
			let at_fetch = a_fetched[i_fetch_copy++];

			// copy fetch data to merge buffer
			at_merge.set(at_fetch, ib_write);

			// update write position
			ib_write += at_fetch.length;

			// increment footprint size
			cb_footprint += at_fetch.length;

			// chunk to right
			if(i_merge < i_merge_hi) {
				// ref chunk data
				let at_chunk = a_chunks[i_merge++].data;

				// copy to merge buffer
				at_merge.set(at_chunk, ib_write);

				// update write position
				ib_write += at_chunk.length;
			}
			// done
			else {
				break;
			}
		}

		// update footprint size
		this._cb_footprint = cb_footprint;

		// create chunk
		let g_merge = {
			lo: ib_merge_lo,
			hi: ib_merge_hi,
			data: at_merge,
		};

		// // invalid
		// let at_check = await this.fetch(ib_merge_lo, ib_merge_hi);
		// for(let ib_check=0; ib_check<at_check.length; ib_check++) {
		// 	if(at_check[ib_check] !== at_merge[ib_check]) {
		// 		debugger;
		// 	}
		// }

		// merge chunks
		a_chunks.splice(i_merge_lo, i_merge_hi-i_merge_lo, g_merge);

		// release chunks lock
		this._kl_chunks.release();

		if(cb_footprint > this._cb_footprint_last_update + (1024*256)) {
			console.log(`buffer footprint: ${cb_footprint / 1024 / 1024} MiB`);
			this._cb_footprint_last_update = cb_footprint;
		}

		// return slice of chunk
		return chunk$within(g_merge, ib_ask_lo, ib_ask_hi);
	}
}

class AsyncView {
	constructor(kab, ib_start=0, nb_view=Infinity) {
		this._kab = kab;
		this._ib_start = ib_start;
		this._nb_view = nb_view;
	}

	get bytes() {
		return this._nb_view;
	}

	get buffer() {
		return this._kab;
	}

	clone() {
		return new AsyncView(this._kab.clone(), this._ib_start, this._nb_view);
	}

	cached(ib_rel) {
		// ask buffer for size of chunk cache
		let nb_cached = this._kab.cached(this._ib_start+ib_rel);

		// clamp to remaining size of view
		return Math.min(nb_cached, this._nb_view-ib_rel);
	}

	pluck(ib_lo, nb_min) {
		// set minimum fetch size, opting for longer cache if available
		let nb_fetch = Math.max(nb_min, this.cached(ib_lo));

		// fetch chunk for testing
		return this.slice(ib_lo, ib_lo+nb_fetch);
	}

	view(ib_rel, nb_view=-1) {
		if(nb_view < 0) nb_view = this._nb_view - ib_rel;
		let ib_view = this._ib_start + ib_rel;
		return new AsyncView(this._kab, ib_view, nb_view);
	}

	next() {
		return new AsyncView(this._kab, this._ib_start+this._nb_view);
	}

	async slice(ib_lo=0, ib_hi=Infinity) {
		let {
			_kab: kab,
			_ib_start: ib_start,
		} = this;

		return await kab.slice(ib_start+ib_lo, Infinity === ib_hi? kab._nb_view: ib_start+ib_hi);
	}

	async slices(a_ranges) {
		let ib_start = this._ib_start;
		return await this._kab.slices(a_ranges.map(a => [ib_start+a[0], ib_start+a[1]]));
	}

	// fetch given ranges and then discard bytes
	async fetch_ranges(a_ranges) {
		let ib_start = this._ib_start;
		return await this._kab.resource.fetch_ranges(a_ranges.map(a => [ib_start+a[0], ib_start+a[1]]));
	}
}

class AsyncViewRegion {
	constructor(h_buffers, ib_start=0, nb_view=Infinity) {
		this._h_buffers = h_buffers;
		this._ib_start = ib_start;

		// infinite view length; deduce byte limit from first buffer
		if(!Number.isFinite(nb_view)) {
			nb_view = h_buffers[Object.keys(h_buffers)[0]].bytes;
		}

		this._nb_view = nb_view;
	}

	get bytes() {
		return this._nb_view;
	}

	report() {
		let h_buffers = this._h_buffers;
		let s_report = '';
		for(let s_name in h_buffers) {
			let kb_which = h_buffers[s_name];
			s_report += `[[${s_name}]]: {
	chunks: ${kb_which._a_chunks.length},
	footprint: ${(kb_which.footprint / 1024 / 1024).toFixed(3)} MiB,
}
`;
		}

		return s_report;
	}

	skip(nb_skip) {
		this._ib_start += nb_skip;
		this._nb_view -= nb_skip;
		if(this._nb_view < 0) {
			debugger;
		}
		return this;
	}

	view(ib_rel=0, nb_view=Infinity) {
		// infinite view length is till end (cannot expand)
		if(!Number.isFinite(nb_view)) {
			debugger;
			nb_view = this._nb_view - ib_rel;
		}
		// negative view length is relative to end length
		else if(nb_view < 0) {
			debugger;
			nb_view = this._nb_view - ib_rel + nb_view;
		}

		// new view region
		return new AsyncViewRegion(this._h_buffers, this._ib_start+ib_rel, nb_view);
	}

	select(s_region, kav_ref=null) {
		let kab_select = this._h_buffers[s_region];
		if(!kab_select) throw new Error(`AsyncViewRegion does not have a region labeled '${s_region}'`);

		if(!kav_ref) kav_ref = this;

		return new AsyncView(kab_select, kav_ref._ib_start, kav_ref._nb_view);
	}

	free(s_region) {
		return this._h_buffers[s_region].free();
	}
}

const H_TYPED_ARRAY_NAMES_TO_GET_METHOD = {
	Int8Array: 'getInt8',
	Uint8Array: 'getUint8',
	Uint8ClampedArray: 'getUint8',
	Int16Array: 'getInt16',
	Uint16Array: 'getUint16',
	Int32Array: 'getInt32',
	Uint32Array: 'getUint32',
	BigInt64Array: 'getBigInt64',
	BigUint64Array: 'getBigUint64',
	Float32Array: 'getFloat32',
	Float64Array: 'getFloat64',
};

const NB_DEFAULT_CURSOR_CHUNK = 512;

async function AsyncTypedArrayCursor$refresh(k_self) {
	if(k_self._at_cache.length) {
		return k_self._at_cache;
	}

	let kav = k_self._kav;

	let ns_element = kav._shifts_per_element;

	let nt_fetch = Math.max(1, NB_DEFAULT_CURSOR_CHUNK >> ns_element);

	let it_curr = this._it_curr;
	let it_next = Math.min(it_curr + nt_fetch, this._it_hi);
	let at_slice = await kav.slice(it_curr, it_next);
	this._it_curr = it_next;

	return at_slice;
}

class AsyncTypedArrayCursor {
	constructor(kav, it_lo, it_hi, nb_chunk) {
		this._kav = kav;
		this._it_lo = it_lo;
		this._it_hi = it_hi;
		this._it_curr = it_lo;
		this._nb_chunk = nb_chunk || NB_DEFAULT_CURSOR_CHUNK;
	}

	get remaining() {
		return this._it_hi - this._it_curr;
	}

	async next() {
		let at_cache = await AsyncTypedArrayCursor$refresh(this);

		let x_value = this._at_cache[0];

		this._at_cache = at_cache.subarray(1);

		return x_value;
	}
}

class AsyncTypedArray {
	constructor(kav_items, dc_typed_array, nl_items=Infinity) {
		this._kav_items = kav_items;
		this._dc_typed_array = dc_typed_array;
		this._nl_items = nl_items;
		this._shifts_per_element = Math.log2(dc_typed_array.BYTES_PER_ELEMENT);
	}

	get size() {
		return this._nl_items;
	}

	async at(i_at) {
		// ref shift-per-element
		let ns_element = this._shifts_per_element;

		// range exception
		if(i_at >= this._nl_items) {
			throw new RangeError(`cannot fetch item at out-of-bounds position ${i_at}`);
		}

		// byte index of item start
		let ib_lo = i_at << ns_element;

		// fetch slice
		let at_slice = await this._kav_items.slice(ib_lo, (ib_lo+1) << ns_element);

		// create data view of slice
		let av_slice = new DataView(at_slice.buffer, at_slice.byteOffset, at_slice.byteLength);

		// method name
		let s_get_value = H_TYPED_ARRAY_NAMES_TO_GET_METHOD[this._dc_typed_array.name];

		// decode and return elemenet value
		return av_slice[s_get_value](0, true);

		// // create typed array view
		// let at_element = new this._dc_typed_array(at_slice.buffer, at_slice.byteOffset, 1);

		// // return element value
		// return at_element[0];
	}

	async pair(i_lo) {
		// ref shift-per-element
		let ns_element = this._shifts_per_element;

		// fetch slice
		let at_slice = await this._kav_items.slice(i_lo<<ns_element, (i_lo+2)<<ns_element);

		// create data view of slice
		let av_slice = new DataView(at_slice.buffer, at_slice.byteOffset, at_slice.byteLength);

		// method name
		let s_get_value = H_TYPED_ARRAY_NAMES_TO_GET_METHOD[this._dc_typed_array.name];

		// create typed array of slice
		return new this._dc_typed_array([
			av_slice[s_get_value](0, true),
			av_slice[s_get_value](1 << ns_element, true),
		]);
	}

	async slice(i_lo=0, i_hi=this._nl_items-i_lo) {
		let ns_element = this._shifts_per_element;
		let at_slice = await this._kav_items.slice(i_lo<<ns_element, i_hi<<ns_element);

		// ref typed array constructor
		let dc_typed_array = this._dc_typed_array;

		// buffer byte offset of slice
		let ib_offset = at_slice.byteOffset;

		// not mem-aligned!
		if(ib_offset % dc_typed_array.BYTES_PER_ELEMENT) {
			// allocate new mem-aligned segment
			let ab_aligned = new ArrayBuffer(at_slice.byteLength);

			// create byte-view over segment
			let atu8_aligned = new Uint8Array(ab_aligned);

			// copy contents over
			atu8_aligned.set(at_slice);

			// create typed array instance
			return new dc_typed_array(ab_aligned);
		}

		// mem-aligned
		return new this._dc_typed_array(at_slice.buffer, ib_offset, at_slice.byteLength >>> ns_element);
	}

	cursor(i_lo=0, i_hi=this._nl_items-i_lo, nb_chunk=0) {
		return new AsyncTypedArrayCursor(this, i_lo, i_hi, nb_chunk);
	}

	next() {
		if(!Number.isFinite(this._nl_items)) throw new Error('cannot call next() method on AsyncTypedArray since size was not set');
		let ib_start = this._nl_items << this._shifts_per_element;
		let nb_view = this._kav_items.bytes;
		return this._kav_items.view(ib_start, nb_view - ib_start);
	}
}

const NB_DEFAULT_BUFFER_CHUNK = 1 << 9;


const AT_EMPTY = new Uint8Array();


async function AsyncBufferDecoder$refresh(k_self) {
	let ib_read = k_self._ib_read;

	// cache is empty
	if(!k_self._at_cache.length) {
		let kav = k_self._kav;
		let nb_chunk = k_self._nb_chunk;

		// lock before going async
		k_self._at_cache = null;

		// advance read pointer
		let ib_advance = ib_read + Math.min(kav.cached(ib_read) || nb_chunk, nb_chunk);

		// reload cache
		let at_cache = k_self._at_cache = await kav.slice(ib_read, ib_advance);  // eslint-disable-line require-atomic-updates

		// update pointer
		k_self._ib_read = ib_read + at_cache.length;  // eslint-disable-line require-atomic-updates
	}

	// fetch cache
	let at_cache = k_self._at_cache;

	// expire
	k_self._at_cache = AT_EMPTY;  // eslint-disable-line require-atomic-updates

	// cache
	return at_cache;
}


async function AsyncBufferDecoder$byte(k_self) {
	let at_cache = await AsyncBufferDecoder$refresh(k_self);

	let xb_value = at_cache[0];

	k_self._at_cache = at_cache.subarray(1);  // eslint-disable-line require-atomic-updates

	return xb_value;
}

/* eslint-disable require-atomic-updates */
async function AsyncBufferDecoder$vuint(k_self) {
	let at_cache = await AsyncBufferDecoder$refresh(k_self);
	let nb_cache = at_cache.length;

	let ib_local = 0;

	// 1 byte value
	let xb_local = at_cache[ib_local];

	// first byte is end of int
	if(xb_local < 0x80) {
		k_self._at_cache = at_cache.slice(1);
		return xb_local;
	}

	// set vuint value to lower value
	let x_value = xb_local & 0x7f;


	// cache ran out; refresh
	if(nb_cache < 2) {
		at_cache = concat_2(at_cache, await AsyncBufferDecoder$refresh(k_self));
	}

	// 2 bytes; keep going
	xb_local = at_cache[ib_local+1];

	// add lower value
	x_value |= (xb_local & 0x7f) << 7;

	// last byte of number
	if(xb_local < 0x80) {
		k_self._at_cache = at_cache.slice(2);
		return x_value;
	}


	// cache ran out; refresh
	if(nb_cache < 3) {
		at_cache = concat_2(at_cache, await AsyncBufferDecoder$refresh(k_self));
	}

	// 3 bytes; keep going
	xb_local = at_cache[ib_local+2];

	// add lower value
	x_value |= (xb_local & 0x7f) << 14;

	// last byte of number
	if(xb_local < 0x80) {
		k_self._at_cache = at_cache.slice(3);
		return x_value;
	}


	// cache ran out; refresh
	if(nb_cache < 4) {
		at_cache = concat_2(at_cache, await AsyncBufferDecoder$refresh(k_self));
	}

	// 4 bytes; keep going
	xb_local = at_cache[ib_local+3];

	// add lower value
	x_value |= (xb_local & 0x7f) << 21;

	// last byte of number
	if(xb_local < 0x80) {
		k_self._at_cache = at_cache.slice(4);
		return x_value;
	}


	// cache ran out; refresh
	if(nb_cache < 5) {
		at_cache = concat_2(at_cache, await AsyncBufferDecoder$refresh(k_self));
	}

	// 5 bytes; be cautious
	xb_local = at_cache[ib_local+4];

	// safe to shift
	let x_hi = (xb_local & 0x7f);
	if(x_hi < 0x07) {
		// add lower value
		x_value |= x_hi << 28;
	}
	// cannot shift
	else {
		// shift by means of float multiplication
		x_value += (x_hi * 0x10000000);
	}

	// last byte of number
	if(xb_local < 0x80) {
		k_self._at_cache = at_cache.slice(5);
		return x_value;
	}


	// 6 bytes (or more)
	throw new Error(`decoding integers of 6 bytes or more not supported by '.vuint()'; try using '.vbigint()' instead`);
}
/* eslint-enable require-atomic-updates */


class AsyncBufferDecoder {
	constructor(kav, nb_chunk=NB_DEFAULT_BUFFER_CHUNK) {
		this._kav = kav;
		this._ib_read = 0;
		this._nb_chunk = nb_chunk || NB_DEFAULT_BUFFER_CHUNK;
		this._at_cache = AT_EMPTY;
		this._kl_cache = new AsyncLock();
	}

	get read() {
		return this._ib_read-this._at_cache.length;
	}

	view(ib_biew=0, nb_view=-1) {
		return this._kav.view(this.read+ib_biew, nb_view);
	}

	async byte() {
		// acquire cache lock
		await this._kl_cache.acquire();

		// read byte
		let xb_value = await AsyncBufferDecoder$byte(this);

		// release cache lock
		this._kl_cache.release();

		// return value
		return xb_value;
	}

	async typed_array() {
		// acquire cache lock
		await this._kl_cache.acquire();

		// typed array type
		let x_type = await AsyncBufferDecoder$byte(this);

		// nubmer of elements in array
		let nl_items = await AsyncBufferDecoder$vuint(this);

		// typed array class
		let dc_typed_array = bkit.constants.H_ENCODING_TO_TYPED_ARRAY[x_type];

		// size of array in bytes
		let nb_array = dc_typed_array.BYTES_PER_ELEMENT * nl_items;

		// create async typed array
		let kat_array = new AsyncTypedArray(this.view(0, nb_array), dc_typed_array, nl_items);

		// went beyond cache; reset and update read position
		if(nb_array >= this._at_cache.length) {
			this._ib_read = this.read + nb_array;
			this._at_cache = AT_EMPTY;
		}
		// preserve cache
		else {
			this._at_cache = this._at_cache.slice(nb_array);
		}

		// relase cache lock
		this._kl_cache.release();

		return kat_array;
	}

	async ntu8_string() {
		// acquire cache lock
		await this._kl_cache.acquire();

		let at_cache = AT_EMPTY;

		// while missing null-terminator
		let ib_nt = -1;
		do {
			// refresh cache
			at_cache = concat_2(at_cache, await AsyncBufferDecoder$refresh(this));

			// update null-terminator index
			ib_nt = at_cache.indexOf(0);
		} while(ib_nt < 0);

		// extract string
		let at_string = at_cache.subarray(0, ib_nt);

		// update cache
		this._at_cache = at_cache.slice(ib_nt+1);

		// relase cache lock
		this._kl_cache.release();

		// decode string
		return bkit.decodeUtf8(at_string);
	}

	async vuint() {
		// acquire cache lock
		await this._kl_cache.acquire();

		// read vuint
		let x_value = await AsyncBufferDecoder$vuint(this);

		// relase cache lock
		this._kl_cache.release();

		// return value
		return x_value;
	}

	slice(ib_lo=0, ib_hi=Infinity) {
		return this._kav.slice(ib_lo, ib_hi);
	}

	// async cache(nb_minimum=1) {
	// 	// cache meets minimum size requirement; return as is
	// 	if(this._at_cache.length >= nb_minimum) {
	// 		return this._at_cache;
	// 	}

	// 	// acquire cache lock
	// 	await this._kl_cache.acquire();

	// 	//
	// 	let at_out = AT_EMPTY;

	// 	// refresh cache
	// 	while(at_out.length < nb_minimum) {
	// 		at_out = bkit.concat_2(at_out, await AsyncBufferDecoder$refresh(this));
	// 	}

	// 	// save 

	// 	// return
	// 	return at_out;
	// }
}

function mk_new(dc_class) {
	return function(...a_args) {
		return new dc_class(...a_args);
	};
}

class Abstraction {
	constructor(a_sources, h_options={}) {
		let a_krcs = a_sources.map((z_source) => {
			// path
			if('string' === typeof z_source) {
				let p_source = z_source;

				// file
				if('/' === p_source[0] || p_source.startsWith('./') || p_source.startsWith('../')) {
					// in browser
					if(B_BROWSER) {
						return new rc.http_range(p_source);
					}
					// in node.js
					else {
						return new rc.file(p_source);
					}
				}
				// http(s)
				else if(p_source.startsWith('http://') || p_source.startsWith('https://') || p_source.startsWith('file://')) {
					return new rc.http_range(p_source);
				}
				// websocket
				else if(p_source.startsWith('ws://')) {
					return new rc.websocket(p_source);
				}
				// torrent
				else if(p_source.startsWith('magnet:?') || p_source.endsWith('.torrent')) {
					throw new Error('not yet implemented');
				}
				// unknown
				else {
					throw new Error('not sure how to handle the string: '+p_source);
				}
			}
			// object
			else if('object' === typeof z_source) {
				// http(s)
				if(z_source instanceof rc.http_range) {
					return rc.http_range(z_source);
				}
				// websocket
				else if(z_source instanceof rc.websocket) {
					return rc.websocket(z_source);
				}
				// // torrent
				// else if(z_source instanceof )
				// plain object
				// if(Object === p_source.constructor)
			}

			return null;
		});

		let krc = new rc.auto_switching(a_krcs);
		let kab = new AsyncBuffer(krc);

		Object.assign(this, {
			krc,
			kab,
		});
	}

	get bytes() {
		return this._kab.bytes;
	}

	// create a new view
	view(i_start, nb_view) {
		return this.kab.view(i_start, nb_view);
	}
}


module.exports = Object.assign((a_sources, h_options) => new Abstraction(a_sources, h_options), {
	// auto: mk_new(rc.Auto),
	// http_range: mk_new(rc.http_range),
	// websocket: mk_new(rc.websocket),
	// file: mk_new(rc.File),

	// File: rc.file,

	buffer: mk_new(AsyncBuffer),
	view: mk_new(AsyncView),
	typed_array: mk_new(AsyncTypedArray),

	AsyncBuffer,
	AsyncBufferDecoder,
	AsyncView,
	AsyncViewRegion,
	AsyncTypedArray,

	Initable,
	AsyncLock,

	resource_connections: rc,

	rc,
});
