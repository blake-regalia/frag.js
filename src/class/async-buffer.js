const AsyncLock = require('../class/async-lock.js');
const AsyncView = require('../class/async-view.js');


/**
 * Provides asynchronous random access to some resource. All fragments are cached in memory
 * for later use.
 */
module.exports = class AsyncBuffer {
	/**
	 * Create a new (empty) AsyncBuffer from an existing one by reusing its ResourceConnection
	 * @param  {AsyncBuffer} kab_from - the existing AsyncBuffer
	 * @return {AsyncBuffer} the new instance
	 */
	static fromAsyncBuffer(kab_from) {
		return new AsyncBuffer(kab_from._krc);
	}

	/**
	 * @param  {ResourceConnection} krc - a connection object to some resource
	 * @param {BufferConfig} gc_buffer - monitor memory footprint via 'threshold' and 'notify' keys
	 */
	constructor(krc, gc_buffer) {
		this._krc = krc;
		this._a_chunks = [];
		this._kl_chunks = new AsyncLock();
		this._cb_footprint = 0;
		this._nb_threshold = gc_buffer.threshold || Infinity;
		this._f_notify = gc_buffer.notify || null;
	}

	/**
	 * The total size of the underlying resource in bytes
	 * @return {ByteLength} the size of underlying resource in bytes
	 */
	get bytes() {
		return this._krc.bytes;
	}

	/**
	 * The cumulative size of cached chunks in bytes.
	 *   NOTE: this does not reflect total memory consumption of cache
	 *   since each chunk incurs additional overhead.
	 * @return {ByteLength} the size of cached chunks in bytes
	 */
	get footprint() {
		return this._cb_footprint;
	}

	/**
	 * Clear all cached chunks
	 * @return {ClearedReport} how many chunks were cleared and their cumulative size in bytes.
	 */
	async clear() {
		// acquire chunks lock
		await this._kl_chunks.acquire();

		// cleared report
		let g_report = {
			chunks: this._a_chunks.length,
			footprint: this._cb_footprint,
		};

		// drop chunks
		this._a_chunks.length = 0;

		// update footprint
		this._cb_footprint = 0;

		// release chunks lock
		this._kl_chunks.release();

		// cleared report
		return g_report;
	}


	/**
	 * Create a new AsyncView on a specific portion of the buffer
	 * @param  {BytePosition} ib_start - inclusive lower range of view
	 * @param  {ByteLength} nb_view - number of bytes the view will span
	 * @return {AsyncView} the view instance
	 */
	view(ib_start, nb_view) {
		return new AsyncView(this, ib_start, nb_view);
	}

	/**
	 * Returns the number of contiguous bytes in the buffer's cache starting at the given byte position
	 * @param  {BytePosition} ib_ask_lo - the position to inquire about
	 * @return {ByteLength} how many contiguous bytes are available in cache starting at the given position
	 */
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

	/**
	 * Extract a range of bytes from the underlying resource, using cache when available
	 *   and fetching new data when necessary.
	 * @param  {BytePosition} ib_ask_lo - inclusive lower range of slice
	 * @param  {BytePosition} ib_ask_hi - exclusive upper range of slice
	 * @return {Uint8Array} a buffer covering the sliced region of the resource
	 */
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
			let at_add = await this._krc.fetch(ib_ask_lo, ib_ask_hi);

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

				// return shallow slice of chunk
				return g_mid.data.subarray(ib_ask_lo-ib_chunk_lo, ib_ask_hi-ib_chunk_lo);
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

		// exceeded threshold
		if(cb_footprint >= this._nb_threshold) {
			// reset threshold
			this._nb_threshold = Infinity;

			// notify handler
			this._f_notify(cb_footprint);
		}

		// return shallow slice of chunk
		return at_merge.subarray(ib_ask_lo-ib_merge_lo, ib_ask_hi-ib_merge_lo);
	}

	// /**
	//  * Extract multiple ranges of bytes from the underlying resource, taking advantage
	//  *   of pooling I/O requests over the connectiong in case it minimizes overhead.
	//  * @param  {Array<BytePositionRange>>} a_ranges - list of ranges to extract
	//  * @return {Array<Uint8Array>} corresponding list of buffers covering the slices regions
	//  */
	// async slices(a_ranges) {
	// 	// acquire chunks lock
	// 	await this._kl_chunks.acquire();

	// 	// start to perform all slicing (in reverse)
	// 	let adp_slices = a_ranges.reverse().map((a_range) => {
	// 		return this.slice(a_range[0], a_range[1]);
	// 	});

	// 	// fetch all ranges
	// 	let a_retrievals = this._a_retrievals;
	// 	this._krc.fetch_ranges(this._a_fetches).forEach((at_fetch, i_fetch) => {
	// 		// resolve promise
	// 		a_retrievals[i_fetch](at_fetch);
	// 	});

	// 	// gather results
	// 	let a_results = await Promise.all(adp_slices);

	// 	// release chunks lock
	// 	this._kl_chunks.release();

	// 	// out
	// 	return a_results.reverse();
	// }
};
