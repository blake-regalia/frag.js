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

// merges given chunk data with chunk to the left
function chunks$merge_left(a_chunks, at_data, i_left) {
	let g_chunk = a_chunks[i_left];

	let nl_add = at_data.length;
	let at_left = g_chunk.data;
	let nl_left = at_left.length;
	let at_chunk = new Uint8Array(nl_left+nl_add);
	at_chunk.set(at_left);
	at_chunk.set(at_data, nl_left);

	// merge into chunk
	g_chunk.hi += nl_add;
	g_chunk.data = at_chunk;

	return g_chunk;
}

// merges given chunk data with chunk to the right
function chunks$merge_right(a_chunks, at_data, i_right) {
	let g_chunk = a_chunks[i_right];

	let nl_add = at_data.length;
	let at_right = g_chunk.data;
	let at_chunk = new Uint8Array(nl_add+at_right.length);
	at_chunk.set(at_data);
	at_chunk.set(at_right, nl_add);

	// merge into chunk
	g_chunk.lo -= nl_add;
	g_chunk.data = at_chunk;

	return g_chunk;
}

function chunks$gaps_left(a_chunks, i_chunk, i_ask_lo) {
	let i_chunk_lo = a_chunks[i_chunk].lo;

	let a_gaps = [];
	let b_dangle = false;

	// scan leftwards
	let i_scan = i_chunk - 1;
	let h_scan = a_chunks[i_scan];
	for(;;) {
		let {
			lo: i_scan_lo,
			hi: i_scan_hi,
		} = h_scan;

		// add gap range to list
		a_gaps.push([i_scan_hi, i_chunk_lo]);

		// no more scans needed
		if(i_scan_lo <= i_ask_lo) {
			break;
		}
		// no more chunks left
		else if(!i_scan) {
			// still need bytes at head
			if(i_ask_lo < i_scan_lo) {
				// push last gap range
				a_gaps.push([i_ask_lo, i_scan_lo]);

				// this chunk will merge right
				b_dangle = true;
			}

			break;
		}

		// next chunk
		h_scan = a_chunks[--i_scan];

		// shift pointer
		i_chunk_lo = i_scan_lo;
	}

	return {
		gaps: a_gaps,
		dangle: b_dangle,
		scan: i_scan,
	};
}

function chunks$gaps_right(a_chunks, i_chunk, i_ask_hi) {
	let i_scan_max = a_chunks.length - 1;
	let i_chunk_hi = a_chunks[i_chunk].hi;

	let a_gaps = [];
	let b_dangle = false;

	// scan rightwards
	let i_scan = i_chunk + 1;
	let h_scan = a_chunks[i_scan];
	for(;;) {
		let {
			lo: i_scan_lo,
			hi: i_scan_hi,
		} = h_scan;

		// add gap range to list
		a_gaps.push([i_chunk_hi, i_scan_lo]);

		// no more scans needed
		if(i_ask_hi <= i_scan_hi) {
			break;
		}
		// no more chunks left
		else if(i_scan === i_scan_max) {
			// still need bytes at tail
			if(i_ask_hi > i_scan_hi) {
				// push last gap range
				a_gaps.push([i_scan_hi, i_ask_hi]);

				// this chunk will merge left
				b_dangle = true;
			}

			break;
		}

		// next chunk
		h_scan = a_chunks[++i_scan];

		// shift pointer
		i_chunk_hi = i_scan_hi;
	}

	return {
		gaps: a_gaps,
		dangle: b_dangle,
		scan: i_scan,
	};
}

// merges given chunk data with chunks on left and right sides
function chunks$wedge(a_chunks, at_data, i_left) {
	let {
		lo: i_lo,
		data: at_left,
	} = a_chunks[i_left];

	let {
		hi: i_hi,
		data: at_right,
	} = a_chunks[i_left+1];

	let nb_left = at_left.length;
	let nb_wedge = at_data.length;
	let nb_right = at_right.length;
	let nb_chunk = nb_left + nb_wedge + nb_right;
	let at_chunk = new Uint8Array(nb_chunk);
	at_chunk.set(at_left);
	at_chunk.set(at_data, nb_left);
	at_chunk.set(at_right, nb_left+nb_wedge);

	// create new chunk
	let g_chunk = {
		lo: i_lo,
		hi: i_hi,
		data: at_chunk,
	};

	// replace 2 chunks with 1: remove and insert
	a_chunks.splice(i_left, 2, g_chunk);

	return g_chunk;
}

// merges multiples chunk values with chunks on left and right sides
function chunks$wedges(a_chunks, a_values, a_ranges, i_left) {
	let nl_ranges = a_ranges.length;

	// byte count of output
	let cb_output = 0;

	// count chunk sizes
	for(let i_range=0, i_chunk=i_left; i_range<nl_ranges; i_range++, i_chunk++) {
		let g_chunk = a_chunks[i_left];
		cb_output += g_chunk.hi - g_chunk.lo;
	}

	// count wedge sizes
	for(let i_value=0; i_value<nl_ranges; i_value++) {
		cb_output += a_values[i_value].length;
	}

	// output buffer
	let at_output = new Uint8Array(cb_output);

	// each chunk/wedge
	let i_write = 0;
	for(let i_value=0, i_chunk=i_left; i_value<nl_ranges; i_value++, i_chunk++) {
		// write chunk to output
		let at_chunk = a_chunks[i_chunk];
		at_output.set(at_chunk, i_write);
		i_write += at_chunk.length;

		// write wedge to output
		let at_value = a_values[i_value];
		at_output.set(at_value, i_write);
		i_write += at_value.length;
	}

	// terminal chunk
	at_output.set(a_chunks[i_left+nl_ranges], i_write);

	// create output
	let h_output = {
		lo: a_ranges[0].lo,
		hi: a_ranges[nl_ranges].hi,
		data: at_output,
	};

	// replace n chunks with 1: remove and insert
	a_chunks.splice(i_left, nl_ranges+1, h_output);

	return h_output;
}


async function AsyncBuffer$fill_left(k_self, i_chunk, i_ask_lo, i_ask_hi) {
	let a_chunks = k_self._chunks;

	// deduce gaps that need to be filled
	let {
		gaps: a_gaps,
		dangle: b_dangle,
		scan: i_scan,
	} = chunks$gaps_left(a_chunks, i_chunk, i_ask_lo);

	// fetch all gap ranges
	let a_fetched = await k_self._krc.fetch_ranges(a_gaps);

	// prep result after fitting chunks into place
	let g_chunk;

	// leftmost chunk merges right
	if(b_dangle) {
		// merge dangle first
		chunks$merge_right(a_chunks, a_fetched.shift(), i_scan);

		// don't wedge this chunk
		a_gaps.shift();
	}

	// insert wedges
	g_chunk = chunks$wedges(a_chunks, a_fetched, a_gaps, i_scan);

	// final chunk
	return chunk$within(g_chunk, i_ask_lo, i_ask_hi);
}

async function AsyncBuffer$fill_right(k_self, i_chunk, i_ask_lo, i_ask_hi) {
	let a_chunks = k_self._chunks;

	// deduce gaps that need to be filled
	let {
		gaps: a_gaps,
		dangle: b_dangle,
		scan: i_scan,
	} = chunks$gaps_right(a_chunks, i_chunk, i_ask_hi);

	// fetch all gap ranges
	let a_fetched = await k_self._krc.fetch_ranges(a_gaps);

	// prep result after fitting chunks into place
	let g_chunk;

	// rightmost chunk merges left
	if(b_dangle) {
		// merge dangle first
		chunks$merge_left(a_chunks, a_fetched.pop(), i_scan);

		// don't wedge this chunk
		a_gaps.pop();
	}

	// insert wedges
	g_chunk = chunks$wedges(a_chunks, a_fetched, a_gaps, i_chunk);

	// final chunk
	return chunk$within(g_chunk, i_ask_lo, i_ask_hi);
}

async function AsyncBuffer$fill_both(k_self, i_chunk, i_ask_lo, i_ask_hi) {
	let a_chunks = k_self._chunks;

	// deduce gaps on left side
	let {
		gaps: a_gaps_left,
		dangle: b_dangle_left,
		scan: i_fill_left,
	} = chunks$gaps_left(a_chunks, i_chunk, i_ask_lo);

	// deduce gaps on right side
	let {
		gaps: a_gaps_right,
		dangle: b_dangle_right,
		scan: i_fill_right,
	} = chunks$gaps_right(a_chunks, i_chunk, i_ask_hi);

	// fetch all gap ranges at once
	let a_gaps = a_gaps_left.concat(a_gaps_right);
	let a_fetched = await k_self._krc.fetch_ranges(a_gaps);

	// prep result after fitting chunks into place
	let g_chunk;

	// rightmost chunk merges left
	if(b_dangle_right) {
		// merge dangle first
		chunks$merge_left(a_chunks, a_fetched.pop(), i_fill_right);

		// don't wedge this chunk
		a_gaps_right.pop();
	}

	//
	let nl_gaps_left = a_gaps_left.length;

	// // iterate backwards to avoid mutating chunk index offset
	// for(let i_fetch=nl_ranges_left+a_ranges_right.length-1, i_wedge=i_chunk-1; i_fetch>=nl_ranges_left; i_fetch--, i_wedge--) {
	// 	// wedge chunk into place
	// 	g_chunk = this.wedge(a_fetched[i_fetch], i_wedge);
	// }

	// leftmost chunk merges right
	if(b_dangle_left) {
		// merge dangle first
		chunks$merge_right(a_chunks, a_fetched.shift(), i_fill_left);

		// don't wedge this chunk
		a_gaps_left.shift();
	}

	// // iterate backwards to avoid mutating chunk index offset
	// for(let i_fetch=nl_ranges_left-1, i_wedge=i_chunk-1; i_fetch>=0; i_fetch--, i_wedge--) {
	// 	// wedge chunk into place
	// 	g_chunk = this.wedge(a_fetched[i_fetch], i_wedge);
	// }

	g_chunk = chunks$wedges(a_chunks, a_fetched, a_gaps, i_fill_left);

	// final chunk
	return chunk$within(g_chunk, i_ask_lo, i_ask_hi);
}


class AsyncBuffer {
	constructor(krc) {
		this._krc = krc;
		this._chunks = [];
		this._fetches = [];
		this._retrievals = [];
		this._kl_chunks = new AsyncLock();
		this.fetch = this.fetch_direct;
	}

	get bytes() {
		return this._krc.bytes;
	}

	fresh() {
		return new AsyncBuffer(this._krc);
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
		let a_retrievals = this._retrievals;
		this._krc.fetch_ranges(this._fetches).forEach((at_fetch, i_fetch) => {
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
			this._fetches.push([i_ask_lo, i_ask_hi]);
			this._retrievals.push(fk_fetch);
		});
	}

	async slice(ib_ask_lo, ib_ask_hi) {
		// acquire chunks lock
		await this._kl_chunks.acquire();

		let a_chunks = this._chunks;
		let nl_chunks = a_chunks.length;

		// byte length
		let nl_buffer = this._krc.bytes;

		// lo is out of range
		if(ib_ask_lo >= nl_buffer) throw new RangeError('`ib_ask_lo` out of bounds');

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
				lo: i_chunk_lo,
				hi: i_chunk_hi,
			} = g_mid;

			// move right
			if(ib_ask_lo >= i_chunk_hi) {
				i_lo = i_mid + 1;
			}
			// move left
			else if(ib_ask_lo < i_chunk_lo) {
				i_hi = i_mid;
			}
			// target completely within this chunk
			else if(ib_ask_hi <= i_chunk_hi) {
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
				ib_fetch_lo = i_chunk_hi;

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
		let i_merge_hi = i_merge_lo + 1;

		// chunk(s) exist to right
		if(i_hi < nl_chunks) {
			debugger;

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

				// chunk range exceeds ask; merge right; break loop
				if(ib_fetch >= ib_ask_hi) {
					b_merge_right = true;
					break;
				}
			}

			// index of merge hi
			i_merge_hi = i_scan + 1;
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

		// fetch write index
		let i_fetch_write = 0;

		// each fetch/chunk pair
		for(;;) {
			// ref fetch data
			let at_fetch = a_fetched[i_fetch_write++];

			// copy fetch data to merge buffer
			at_merge.set(at_fetch, ib_write);

			// update write position
			ib_write += at_fetch.length;

			// chunk to right
			if(i_merge < i_merge_hi) {
				// ref chunk data
				let at_chunk = a_chunks[i_merge++].data;

				// copy to merge buffer
				at_merge.set(at_chunk);

				// update write position
				ib_write += at_chunk.length;
			}
			// done
			else {
				break;
			}
		}

		// create chunk
		let g_merge = {
			lo: ib_merge_lo,
			hi: ib_merge_hi,
			data: at_merge,
		};

		// merge chunks
		a_chunks.splice(i_merge_lo, i_merge_hi-i_merge_lo, g_merge);

		// release chunks lock
		this._kl_chunks.release();

		// return slice of chunk
		return chunk$within(g_merge, ib_ask_lo, ib_ask_hi);
	}

	// takes a slice out of buffer from lo inclusive to hi exclusive
	async slicea(i_ask_lo, i_ask_hi) {
		let a_chunks = this._chunks;
		let nl_chunks = a_chunks.length;

		// byte length
		let nl_buffer = this._krc.bytes;

		// lo is out of range
		if(i_ask_lo >= nl_buffer) throw new RangeError('`i_ask_lo` out of bounds');

		// put hi in range
		if(i_ask_hi > this._krc.bytes) i_ask_hi = nl_buffer;

		// no chunks
		if(!nl_chunks) {
			// fetch new part
			let at_add = await this.fetch(i_ask_lo, i_ask_hi);

			// create chunk
			let g_chunk = {
				lo: i_ask_lo,
				hi: i_ask_hi,
				data: at_add,
			};

			// insert
			a_chunks.push(g_chunk);

			// straight-up
			return g_chunk.data;
		}

		// binary search
		let i_lo = 0;
		let i_hi = nl_chunks;
		while(i_lo < i_hi) {
			let i_mid = (i_lo + i_hi) >>> 1;
			let h_mid = a_chunks[i_mid];
			let {
				lo: i_chunk_lo,
				hi: i_chunk_hi,
			} = h_mid;

			// starts at/before chunk starts
			if(i_ask_lo <= i_chunk_lo) {
				// ends after chunk starts (chunk is a hit)
				if(i_ask_hi > i_chunk_lo) {
					// ends at/before chunk ends
					if(i_ask_hi <= i_chunk_hi) {
						// chunk contains entire target
						if(i_ask_lo === i_chunk_lo) {
							return chunk$within(h_mid, i_ask_lo, i_ask_hi);
						}
						// chunk is missing target's head, left chunk does not contain target
						else if(!i_lo || i_ask_lo >= a_chunks[i_mid-1].hi) {
							// fetch difference
							let at_add = await this.fetch(i_ask_lo, i_chunk_lo);
							let g_chunk;

							// left and right chunks exists and this will wedge between them
							if(i_lo && i_ask_lo === a_chunks[i_mid-1].hi) {
								g_chunk = chunks$wedge(a_chunks, at_add, i_mid-1);
							}
							// left chunk does not exist or there is gap; merge with right chunk
							else {
								g_chunk = chunks$merge_right(a_chunks, at_add, i_mid);
							}

							// view of chunk
							return chunk$within(g_chunk, i_ask_lo, i_ask_hi);
						}
						// previous chunk contains part of target
						else {
							return AsyncBuffer$fill_left(this, i_mid, i_ask_lo, i_ask_hi);
						}
					}
					// ends after chunk ends, chunk contains head
					else if(i_ask_lo === i_chunk_lo) {
						// no chunks to the right
						if(i_mid === nl_chunks-1) {
							// fetch difference
							let at_add = await this.fetch(i_chunk_hi, i_ask_hi);

							// merge with chunk
							let g_chunk = chunks$merge_left(a_chunks, at_add, i_mid);

							// view of chunk
							return chunk$within(g_chunk, i_ask_lo, i_ask_hi);
						}
						// more chunks to the right
						else {
							return AsyncBuffer$fill_right(this, i_mid, i_ask_lo, i_ask_hi);
						}
					}
					// missing parts at both head and tail
					else {
						return AsyncBuffer$fill_both(this, i_mid, i_ask_lo, i_ask_hi);
					}
				}
				// ends before chunk starts; aim left
				else {
					i_hi = i_mid;
				}
			}
			// starts after chunk starts, starts before chunk ends (hit)
			else if(i_ask_lo < i_chunk_hi) {
				// ends at/before chunk ends, chunk contains entire target
				if(i_ask_hi <= i_chunk_hi) {
					return chunk$within(h_mid, i_ask_lo, i_ask_hi);
				}
				// ends after chunk
				else {
					return AsyncBuffer$fill_right(this, i_mid, i_ask_lo, i_ask_hi);
				}
			}
			// starts after chunk ends; aim right
			else {
				i_lo = i_mid + 1;
			}
		}

		// insert new chunk
		{
			// ref within chunk
			let g_within;

			// need entire frag
			let at_add = await this.fetch(i_ask_lo, i_ask_hi);

			debugger;

			let h_resolve = a_chunks[i_hi-1];
			let b_connects_right = i_hi < a_chunks.length && i_ask_hi === a_chunks[i_hi].lo;

			// connects to left
			if(i_ask_lo === h_resolve.hi) {
				// also connects to right; wedge
				if(b_connects_right) {
					g_within = chunks$wedge(a_chunks, at_add, i_hi-1);
				}

				// merge left
				g_within = chunks$merge_left(a_chunks, at_add, i_hi-1);
			}
			// connects to right
			else if(b_connects_right) {
				g_within = chunks$merge_right(a_chunks, at_add, i_hi);
			}
			// insert chunk here
			else {
				// create chunk
				let g_chunk = {
					lo: i_ask_lo,
					hi: i_ask_hi,
					data: at_add,
				};

				// insert chunk
				a_chunks.splice(i_hi, 0, g_chunk);

				// return
				return g_chunk;
			}

			// within
			return chunk$within(g_within, i_ask_lo, i_ask_hi);
		}
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

	fresh() {
		return new AsyncView(this._kab.fresh(), this._ib_start, this._nb_view);
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
		this._nb_view = nb_view;
	}

	get bytes() {
		return this._nb_view;
	}

	skip(nb_skip) {
		this._ib_start += nb_skip;
		this._nb_view -= nb_skip;
		return this;
	}

	view(ib_rel=0, nb_view=Infinity) {
		// infinite view length is till end (cannot expand)
		if(!Number.isFinite(nb_view)) {
			nb_view = this._nb_view - ib_rel;
		}
		// negative view length is relative to end length
		else if(nb_view < 0) {
			nb_view = this._nb_view - ib_rel + nb_view;
		}

		// new view region
		return new AsyncViewRegion(this._h_buffers, this._ib_start+ib_rel, nb_view);
	}

	select(s_region) {
		let kab_select = this._h_buffers[s_region];
		if(!kab_select) throw new Error(`AsyncViewRegion does not have a region labeled '${s_region}'`);

		return new AsyncView(kab_select, this._ib_start, this._nb_view);
	}
}

class AsyncTypedArray {
	constructor(kav_items, dc_type, nl_items=Infinity) {
		this._kav_items = kav_items;
		this._type = dc_type;
		this._nl_items = nl_items;
		this._shifts_per_element = Math.log2(dc_type.BYTES_PER_ELEMENT);
	}

	get size() {
		return this._nl_items;
	}

	async at(i_at) {
		let i_pos = i_at << this._shifts_per_element;
		let at_slice = await this._kav_items.slice(i_pos, i_pos+1);
		let at_element = new this._type(at_slice);
		return at_element[0];
	}

	async slice(i_lo=0, i_hi=this._nl_items) {
		let ns_element = this._shifts_per_element;
		let at_slice = await this._kav_items.slice(i_lo<<ns_element, i_hi<<ns_element);
		return new this._type(at_slice);
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
		// lock before going async
		k_self._at_cache = null;

		// advance read pointer
		let ib_advance = ib_read + k_self._nb_chunk;

		// TODO: limit chunk to view size?

		// reload cache
		k_self._at_cache = await k_self._kav.slice(ib_read, ib_advance);  // eslint-disable-line require-atomic-updates

		// update pointer
		k_self._ib_read = ib_advance;  // eslint-disable-line require-atomic-updates
	}

	// fetch cache
	let at_cache = k_self._at_cache;

	// expire
	k_self._at_cache = AT_EMPTY;  // eslint-disable-line require-atomic-updates

	// cache
	return at_cache;
}


class AsyncBufferDecoder {
	constructor(kav, nb_chunk=NB_DEFAULT_BUFFER_CHUNK) {
		this._kav = kav;
		this._ib_read = 0;
		this._nb_chunk = nb_chunk || NB_DEFAULT_BUFFER_CHUNK;
		this._at_cache = AT_EMPTY;
	}

	get read() {
		return this._ib_read-this._at_cache.length;
	}

	view(ib_biew=0, nb_view=-1) {
		return this._kav.view(this.read+ib_biew, nb_view);
	}

	async byte() {
		let at_cache = await AsyncBufferDecoder$refresh(this);

		let xb_value = at_cache[0];

		this._at_cache = at_cache.subarray(1);

		return xb_value;
	}

	async typed_array() {
		// typed array type
		let x_type = await this.byte();

		// nubmer of elements in array
		let nl_items = await this.vuint();

		// typed array class
		let dc_typed_array = bkit.constants.H_ENCODING_TO_TYPED_ARRAY[x_type];

		// size of array in bytes
		let nb_array = dc_typed_array.BYTES_PER_ELEMENT * nl_items;

		// create async typed array
		let kat_array = new AsyncTypedArray(this.view(0, nb_array), dc_typed_array, nl_items);

		// advance cache
		this._at_cache = this._at_cache.slice(nb_array);

		return kat_array;
	}

	async ntu8_string() {
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

		// decode string
		return bkit.decodeUtf8(at_string);
	}

	async vuint() {
		let at_cache = await AsyncBufferDecoder$refresh(this);
		let nb_cache = at_cache.length;

		let ib_local = 0;

		// 1 byte value
		let xb_local = at_cache[ib_local];

		// first byte is end of int
		if(xb_local < 0x80) {
			this._at_cache = at_cache.slice(1);
			return xb_local;
		}

		// set vuint value to lower value
		let x_value = xb_local & 0x7f;


		// cache ran out; refresh
		if(nb_cache < 2) {
			at_cache = concat_2(at_cache, await AsyncBufferDecoder$refresh(this));
		}

		// 2 bytes; keep going
		xb_local = at_cache[ib_local+1];

		// add lower value
		x_value |= (xb_local & 0x7f) << 7;

		// last byte of number
		if(xb_local < 0x80) {
			this._at_cache = at_cache.slice(2);
			return x_value;
		}


		// cache ran out; refresh
		if(nb_cache < 3) {
			at_cache = concat_2(at_cache, await AsyncBufferDecoder$refresh(this));
		}

		// 3 bytes; keep going
		xb_local = at_cache[ib_local+2];

		// add lower value
		x_value |= (xb_local & 0x7f) << 14;

		// last byte of number
		if(xb_local < 0x80) {
			this._at_cache = at_cache.slice(3);
			return x_value;
		}


		// cache ran out; refresh
		if(nb_cache < 4) {
			at_cache = concat_2(at_cache, await AsyncBufferDecoder$refresh(this));
		}

		// 4 bytes; keep going
		xb_local = at_cache[ib_local+3];

		// add lower value
		x_value |= (xb_local & 0x7f) << 21;

		// last byte of number
		if(xb_local < 0x80) {
			this._at_cache = at_cache.slice(4);
			return x_value;
		}


		// cache ran out; refresh
		if(nb_cache < 5) {
			at_cache = concat_2(at_cache, await AsyncBufferDecoder$refresh(this));
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
			this._at_cache = at_cache.slice(5);
			return x_value;
		}


		// 6 bytes (or more)
		throw new Error(`decoding integers of 6 bytes or more not supported by '.vuint()'; try using '.vbigint()' instead`);
	}
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
