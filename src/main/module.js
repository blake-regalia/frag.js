const {
	B_BROWSER,
} = require('./locals.js');

const rc = require('./resource_connections/locals.js');

class async_buffer {
	constructor(krc) {
		Object.assign(this, {
			krc: null,
			ready: [],
			chunks: [],
			fetches: [],
			retrievals: [],
			fetch: this.fetch_direct,
		});

		// initialize resource connection
		krc.init().then(() => {
			this.krc = krc;

			// empty wait ready queue
			while(this.ready.length) {
				this.ready.shift()();
			}
		});
	}

	wait(fk_wait) {
		return new Promise((f_resolve) => {
			this.ready.push(() => {
				f_resolve(fk_wait());
			});
		});
	}

	async size() {
		return await this.wait(() => this.krc.bytes);
	}

	fresh() {
		return new async_buffer(this.krc);
	}

	// merges given chunk value with chunks on left and right sides
	wedge(at_value, i_left) {
		let a_chunks = this.chunks;

		let {
			lo: i_lo,
			value: at_left,
		} = a_chunks[i_left];

		let {
			hi: i_hi,
			value: at_right,
		} = a_chunks[i_left+1];

		let nl_left = at_left.length;
		let nl_wedge = at_value.length;
		let nl_right = at_right.length;
		let nl_chunk = nl_left + nl_wedge + nl_right;
		let at_chunk = new Uint8Array(nl_chunk);
		at_chunk.set(at_left);
		at_chunk.set(at_value, nl_left);
		at_chunk.set(at_right, nl_left+nl_wedge);

		// create new chunk
		let h_chunk = {
			lo: i_lo,
			hi: i_hi,
			value: at_chunk,
		};

		// replace 2 chunks with 1: remove and insert
		a_chunks.splice(i_left, 2, h_chunk);

		return h_chunk;
	}

	// merges multiples chunk values with chunks on left and right sides
	wedges(a_values, a_ranges, i_left) {
		let a_chunks = this.chunks;
		let nl_ranges = a_ranges.length;

		let nl_output = 0;
		for(let i_range=0, i_chunk=i_left; i_range<nl_ranges; i_range++, i_chunk++) {
			nl_output += a_chunks[i_left];
		}

		for(let i_value=0; i_value<nl_ranges; i_value++) {
			nl_output += a_values[i_value].length;
		}

		let at_output = new Uint8Array(nl_output);
		let i_write = 0;
		for(let i_value=0, i_chunk=i_left; i_value<nl_ranges; i_value++, i_chunk++) {
			let at_chunk = a_chunks[i_chunk];
			at_output.set(at_chunk, i_write);
			i_write += at_chunk.length;

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
			value: at_output,
		};

		// replace n chunks with 1: remove and insert
		a_chunks.splice(i_left, nl_ranges+1, h_output);

		return h_output;
	}

	// merges given chunk value with chunk to the right
	merge_left(at_value, i_left) {
		let h_chunk = this.chunks[i_left];

		let nl_add = at_value.length;
		let at_left = h_chunk.value;
		let nl_left = at_left.length;
		let at_chunk = new Uint8Array(nl_left+nl_add);
		at_chunk.set(at_left);
		at_chunk.set(at_value, nl_left);

		// merge into chunk
		h_chunk.hi += nl_add;
		h_chunk.value = at_chunk;

		return h_chunk;
	}

	// merges given chunk value with chunk to the right
	merge_right(at_value, i_right) {
		let h_chunk = this.chunks[i_right];

		let nl_add = at_value.length;
		let at_right = h_chunk.value;
		let at_chunk = new Uint8Array(nl_add+at_right.length);
		at_chunk.set(at_value);
		at_chunk.set(at_right, nl_add);

		// merge into chunk
		h_chunk.lo -= nl_add;
		h_chunk.value = at_chunk;

		return h_chunk;
	}

	// extracts the given range from a chunk
	within(h_chunk, i_ask_lo, i_ask_hi) {
		let i_lo = h_chunk.lo;
		return h_chunk.value.subarray(i_ask_lo-i_lo, i_ask_hi-i_lo);
	}

	ranges_left(i_chunk, i_ask_lo) {
		let a_chunks = this.chunks;
		let i_chunk_lo = a_chunks[i_chunk].lo;

		let a_ranges = [];
		let b_dangle = false;

		// scan leftwards
		let i_scan = i_chunk - 1;
		let h_scan = a_chunks[i_scan];
		for(;;) {
			let {
				lo: i_scan_lo,
				hi: i_scan_hi,
			} = h_scan;

			// add range to list
			a_ranges.push([i_scan_hi, i_chunk_lo]);

			// no more scans needed
			if(i_scan_lo <= i_ask_lo) {
				break;
			}
			// no more chunks left
			else if(!i_scan) {
				// still need bytes at head
				if(i_ask_lo < i_scan_lo) {
					// push last range
					a_ranges.push([i_ask_lo, i_scan_lo]);

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
			ranges: a_ranges,
			dangle: b_dangle,
			scan: i_scan,
		};
	}

	ranges_right(i_chunk, i_ask_hi) {
		let a_chunks = this.chunks;
		let nl_chunks = a_chunks.length;
		let i_chunk_hi = a_chunks[i_chunk].hi;

		let a_ranges = [];
		let b_dangle = false;

		// scan rightwards
		let i_scan = i_chunk + 1;
		let h_scan = a_chunks[i_scan];
		for(;;) {
			let {
				lo: i_scan_lo,
				hi: i_scan_hi,
			} = h_scan;

			// add range to list
			a_ranges.push([i_chunk_hi, i_scan_lo]);

			// no more scans needed
			if(i_ask_hi <= i_scan_hi) {
				break;
			}
			// no more chunks left
			else if(i_scan === nl_chunks-1) {
				// still need bytes at tail
				if(i_ask_hi > i_scan_hi) {
					// push last range
					a_ranges.push([i_scan_hi, i_ask_hi]);

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
			ranges: a_ranges,
			dangle: b_dangle,
			scan: i_scan,
		};
	}

	async scan_left(i_chunk, i_ask_lo, i_ask_hi) {
		// deduce ranges needed
		let {
			ranges: a_ranges,
			dangle: b_dangle,
			scan: i_scan,
		} = this.ranges_left(i_chunk, i_ask_lo);

		// fetch all ranges
		let a_fetched = await this.krc.fetch_ranges(a_ranges);

		// prep result after fitting chunks into place
		let h_chunk;

		// leftmost chunk merges right
		if(b_dangle) {
			// merge dangle first
			this.merge_right(a_fetched.shift(), i_scan);

			// don't wedge this chunk
			a_ranges.shift();
		}

		// // iterate backwards to avoid mutating chunk index offset
		// for(let i_fetch=a_ranges.length-1, i_wedge=i_chunk-1; i_fetch>=0; i_fetch--, i_wedge--) {
		// 	// wedge chunk into place
		// 	h_chunk = this.wedge(a_fetched[i_fetch], i_wedge);
		// }

		h_chunk = this.wedges(a_fetched, a_ranges, i_scan);

		// final chunk
		return this.within(h_chunk, i_ask_lo, i_ask_hi);
	}

	async scan_right(i_chunk, i_ask_lo, i_ask_hi) {
		// deduce ranges needed
		let {
			ranges: a_ranges,
			dangle: b_dangle,
			scan: i_scan,
		} = this.ranges_right(i_chunk, i_ask_hi);

		// fetch all ranges
		let a_fetched = await this.krc.fetch_ranges(a_ranges);

		// prep result after fitting chunks into place
		let h_chunk;

		// rightmost chunk merges left
		if(b_dangle) {
			// merge dangle first
			this.merge_left(a_fetched.pop(), i_scan);

			// don't wedge this chunk
			a_ranges.pop();
		}

		// // iterate backwards to avoid mutating chunk index offset
		// for(let i_fetch=a_ranges.length-1, i_wedge=i_chunk-1; i_fetch>=0; i_fetch--, i_wedge--) {
		// 	// wedge chunk into place
		// 	h_chunk = this.wedge(a_fetched[i_fetch], i_wedge);
		// }

		h_chunk = this.wedges(a_fetched, a_ranges, i_chunk);

		// final chunk
		return this.within(h_chunk, i_ask_lo, i_ask_hi);
	}

	async scan_both(i_chunk, i_ask_lo, i_ask_hi) {
		// deduce ranges needed on left side
		let {
			ranges: a_ranges_left,
			dangle: b_dangle_left,
			scan: i_scan_left,
		} = this.ranges_left(i_chunk, i_ask_lo);

		// deduce ranges needed on right side
		let {
			ranges: a_ranges_right,
			dangle: b_dangle_right,
			scan: i_scan_right,
		} = this.ranges_right(i_chunk, i_ask_hi);

		// fetch all ranges at once
		let a_ranges = a_ranges_left.concat(a_ranges_right);
		let a_fetched = await this.krc.fetch_ranges(a_ranges);

		// prep result after fitting chunks into place
		let h_chunk;

		// rightmost chunk merges left
		if(b_dangle_right) {
			// merge dangle first
			this.merge_left(a_fetched.pop(), i_scan_right);

			// don't wedge this chunk
			a_ranges_right.pop();
		}

		//
		let nl_ranges_left = a_ranges_left.length;

		// // iterate backwards to avoid mutating chunk index offset
		// for(let i_fetch=nl_ranges_left+a_ranges_right.length-1, i_wedge=i_chunk-1; i_fetch>=nl_ranges_left; i_fetch--, i_wedge--) {
		// 	// wedge chunk into place
		// 	h_chunk = this.wedge(a_fetched[i_fetch], i_wedge);
		// }

		// leftmost chunk merges right
		if(b_dangle_left) {
			// merge dangle first
			this.merge_right(a_fetched.shift(), i_scan_left);

			// don't wedge this chunk
			a_ranges_left.shift();
		}

		// // iterate backwards to avoid mutating chunk index offset
		// for(let i_fetch=nl_ranges_left-1, i_wedge=i_chunk-1; i_fetch>=0; i_fetch--, i_wedge--) {
		// 	// wedge chunk into place
		// 	h_chunk = this.wedge(a_fetched[i_fetch], i_wedge);
		// }

		h_chunk = this.wedges(a_fetched, a_ranges, i_scan_left);

		// final chunk
		return this.within(h_chunk, i_ask_lo, i_ask_hi);
	}

	// create a 'view' on a specific portion of the buffer
	view(i_start, nb_view) {
		return new async_view(this, i_start, nb_view);
	}

	// takes multiple slices
	async slices(a_ranges) {
		// resource not connected yet; wait for it then call this
		if(!this.krc) return await this.wait(async () => await this.slices(a_ranges));

		// mutate fetch method temporarily
		this.fetch = this.fetch_queue;

		// start to perform all slicing (in reverse)
		let adp_slices = a_ranges.reverse().map((a_range) => {
			return this.slice(a_range[0], a_range[1]);
		});

		// fetch all ranges
		let a_retrievals = this.retrievals;
		this.krc.fetch_ranges(this.fetches).forEach((at_fetch, i_fetch) => {
			// resolve promise
			a_retrievals[i_fetch](at_fetch);
		});

		// gather results
		let a_results = await Promise.all(adp_slices);

		// reset fetch method
		this.fetch = this.fetch_direct;

		// out
		return a_results.reverse();
	}

	async fetch_direct(i_ask_lo, i_ask_hi) {
		return this.krc.fetch(i_ask_lo, i_ask_hi);
	}

	async fetch_queue(i_ask_lo, i_ask_hi) {
		return new Promise((fk_fetch) => {
			this.fetches.push([i_ask_lo, i_ask_hi]);
			this.retrievals.push(fk_fetch);
		});
	}

	// takes a slice out of buffer from lo inclusive to hi exclusive
	async slice(i_ask_lo, i_ask_hi) {
		// resource not connected yet; wait for it then call this
		if(!this.krc) return await this.wait(async () => await this.slice(i_ask_lo, i_ask_hi));

		let a_chunks = this.chunks;
		let nl_chunks = a_chunks.length;

		// byte length
		let nl_buffer = this.krc.bytes;

		// lo is out of range
		if(i_ask_lo >= nl_buffer) throw new RangeError('`i_ask_lo` out of bounds');

		// put hi in range
		if(i_ask_hi > this.krc.bytes) i_ask_hi = nl_buffer;

		// no chunks
		if(!nl_chunks) {
			// fetch new part
			let at_add = await this.fetch(i_ask_lo, i_ask_hi);

			// create chunk
			let h_chunk = {
				lo: i_ask_lo,
				hi: i_ask_hi,
				value: at_add,
			};

			// insert
			a_chunks.push(h_chunk);

			// straight-up
			return h_chunk.value;
		}

		// binary search
		let i_lo = 0;
		let i_hi = nl_chunks;
		while(i_lo <= i_hi) {
			let i_mid = (i_lo + i_hi) >>> 1;
			let h_mid = a_chunks[i_mid];
			let {
				lo: i_chunk_lo,
				hi: i_chunk_hi,
			} = h_mid;

			// starts at/before chunk starts
			if(i_ask_lo <= i_chunk_lo) {
				// ends after chunk starts; chunk is a hit
				if(i_ask_hi > i_chunk_lo) {
					// ends at/before chunk ends;
					if(i_ask_hi <= i_chunk_hi) {
						// chunk contains entire target
						if(i_ask_lo === i_chunk_lo) {
							return this.within(h_mid, i_ask_lo, i_ask_hi);
						}
						// chunk is missing target's head
						else {
							// previous chunk does not contain target
							if(!i_lo || i_ask_lo >= a_chunks[i_mid-1].hi) {
								// fetch difference
								let at_add = await this.fetch(i_ask_lo, i_chunk_lo);

								// this connects previous chunk
								if(i_lo && i_ask_lo === a_chunks[i_mid-1].hi) {
									let h_chunk = this.wedge(at_add, i_mid-1);
									return this.within(h_chunk, i_ask_lo, i_ask_hi);
								}
								// merge with chunk
								else {
									let h_chunk = this.merge_right(at_add, i_mid);
									return this.within(h_chunk, i_ask_lo, i_ask_hi);
								}
							}
							// previous chunk contains part of target
							else {
								return this.scan_left(i_mid, i_ask_lo, i_ask_hi);
							}
						}
					}
					// ends after chunk ends
					else {
						// chunk contains head
						if(i_ask_lo === i_chunk_lo) {
							// no more chunks
							if(i_mid === nl_chunks-1) {
								// fetch difference
								let at_add = await this.fetch(i_chunk_hi, i_ask_hi);

								// merge with chunk
								return this.merge_left(at_add, i_mid);
							}
							// more chunks to the right
							else {
								return this.scan_right(i_mid, i_ask_lo, i_ask_hi);
							}
						}
						// missing parts at both head and tail
						else {
							return this.scan_both(i_mid, i_ask_lo, i_ask_hi);
						}
					}
				}
				// ends before chunk starts; aim left
				else {
					i_hi = i_mid;
				}
			}
			// starts after chunk starts
			else {
				// starts before chunk ends; hit
				if(i_ask_lo < i_chunk_hi) {
					// ends at/before chunk ends; chunk contains entire target
					if(i_ask_hi <= i_chunk_hi) {
						return this.within(i_mid, i_ask_lo, i_ask_hi);
					}
					// ends after chunk
					else {
						return this.scan_right(i_mid, i_ask_lo, i_ask_hi);
					}
				}
				// starts after chunk ends; aim right
				else {
					i_lo = i_mid;
				}
			}
		}
	}
}

class async_view {
	constructor(kab, i_start=0, nb_view=Infinity) {
		Object.assign(this, {
			kab: kab,
			start: i_start,
			bytes: nb_view,
		});
	}

	fresh() {
		return new async_view(this.kab.fresh(), this.start, this.bytes);
	}

	view(i_start, nb_view) {
		return new async_view(this.kab, this.start+i_start, nb_view);
	}

	next() {
		return new async_view(this.kab, this.start+this.bytes);
	}

	async slice(i_lo=0, i_hi=Infinity) {
		let {
			kab: kab,
			start: i_start,
		} = this;

		return await kab.slice(i_start+i_lo, Infinity === i_hi? kab.bytes: i_start+i_hi);
	}

	async slices(a_ranges) {
		let i_start = this.start;
		return this.kab.slices(a_ranges.map(a => [i_start+a[0], i_start+a[1]]));
	}

	// fetch given ranges and then discard bytes
	async fetch_ranges(a_ranges) {
		let i_start = this.start;
		return this.kab.resource.fetch_ranges(a_ranges.map(a => [i_start+a[0], i_start+a[1]]));
	}
}

class async_typed_array {
	constructor(kav, dc_type) {
		Object.assign(this, {
			kav: kav,
			type: dc_type,
			shifts_per_element: Math.log2(dc_type.BYTES_PER_ELEMENT),
		});
	}

	async at(i_at) {
		let i_pos = i_at << this.shifts_per_element;
		let at_slice = this.kab.slice(i_pos, i_pos+1);
		let at_element = new this.type(at_slice);
		return at_element[0];
	}

	async slice(i_lo, i_hi) {
		let ns_element = this.shifts_per_element;
		let at_slice = await this.kab.slice(i_lo<<ns_element, i_hi<<ns_element);
		return new this.type(at_slice);
	}
}

function mk_new(dc_class) {
	return function(...a_args) {
		return new dc_class(...a_args);
	};
}

class abstraction {
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
		});

		let krc = new rc.auto_switching(a_krcs);
		let kab = new async_buffer(krc);

		Object.assign(this, {
			krc,
			kab,
		});
	}

	async size() {
		return await this.kab.size();
	}

	// create a new view
	view(i_start, nb_view) {
		return this.kab.view(i_start, nb_view);
	}
}


module.exports = Object.assign((a_sources, h_options) => new abstraction(a_sources, h_options), {
	auto: mk_new(rc.auto),
	http_range: mk_new(rc.http_range),
	websocket: mk_new(rc.websocket),
	file: mk_new(rc.file),

	buffer: mk_new(async_buffer),
	view: mk_new(async_view),
	typed_array: mk_new(async_typed_array),

	resource_connections: rc,
});
