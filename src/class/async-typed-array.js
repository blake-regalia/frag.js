const bkit = require('bkit');

const AT_EMPTY = new Uint8Array();

const NB_DEFAULT_CURSOR_CHUNK = 1 << 11;  // 2 KiB

async function AsyncTypedArrayCursor$refresh(k_self) {
	let kav = k_self._kav;

	// ref shifts per element
	let ns_element = kav._shifts_per_element;

	// how many elements to fetch
	let nt_fetch = Math.max(1, k_self._nb_chunk>>ns_element);

	// position of current cache
	let it_curr = k_self._it_curr;

	// position of next cache
	let it_next = Math.min(it_curr+nt_fetch, k_self._it_hi);

	// fetch slice
	let at_slice = await kav.slice(it_curr, it_next);

	// update cache position
	this._it_curr = it_next;

	// return slice
	return at_slice;
}

class AsyncTypedArrayCursor {
	constructor(kav, it_lo, it_hi, nb_chunk) {
		this._kav = kav;
		this._it_lo = it_lo;
		this._it_hi = it_hi;
		this._it_curr = it_lo;
		this._it_local = 0;
		this._nb_chunk = nb_chunk || NB_DEFAULT_CURSOR_CHUNK;
		this._at_cache = AT_EMPTY;
		this._b_finished = it_hi === it_lo;
	}

	get finished() {
		return this._b_finished;
	}

	async next() {
		let at_cache = this._at_cache;
		let it_local = this._it_local;

		// ran out of cache
		if(it_local >= at_cache.length-1) {
			// refresh cache
			at_cache = this._at_cache = await AsyncTypedArrayCursor$refresh(this);

			// reset read position
			it_local = 0;
		}

		// fetch value
		let x_value = at_cache[it_local];

		// update read position
		this._it_local = it_local + 1;

		// return value
		return x_value;
	}
}

/**
 * Asynchronous virtual TypedArray
 */
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

	/**
	 * Access an unsigned int element at the given position.
	 * @param  {TypedArrayIndex} it_at - position of element to access
	 * @return {Uint} the element value
	 */
	async at(it_at) {
		// ref shift-per-element
		let ns_element = this._shifts_per_element;

		// range exception
		if(it_at >= this._nl_items) {
			throw new RangeError(`cannot fetch item at out-of-bounds position ${it_at}`);
		}

		// byte index of item start
		let ib_lo = it_at << ns_element;

		// fetch slice
		let at_slice = await this._kav_items.slice(ib_lo, (ib_lo+1) << ns_element);

		// read uint
		return bkit.readUintLE(at_slice, 0, 1 << ns_element);

		// {
		// 	// create data view of slice
		// 	let av_slice = new DataView(at_slice.buffer, at_slice.byteOffset, at_slice.byteLength);

		// 	// method name
		// 	let s_get_value = H_TYPED_ARRAY_NAMES_TO_GET_METHOD[this._dc_typed_array.name];

		// 	// decode and return elemenet value
		// 	return av_slice[s_get_value](0, true);
		// }

		// // create typed array view
		// let at_element = new this._dc_typed_array(at_slice.buffer, at_slice.byteOffset, 1);

		// // return element value
		// return at_element[0];
	}

	/**
	 * Access two unsigned int elements starting at the given position.
	 * @param  {TypedArrayIndex} it_lo - position of first element to access
	 * @return {TypedArray} the element values
	 */
	async pair(it_lo) {
		// ref shift-per-element
		let ns_element = this._shifts_per_element;

		// fetch slice
		let at_slice = await this._kav_items.slice(it_lo<<ns_element, (it_lo+2)<<ns_element);

		// number of bytes per element
		let nb_element = 1 << ns_element;

		// read uints
		return new this._dc_typed_array([
			bkit.readUintLE(at_slice, 0, nb_element),
			bkit.readUintLE(at_slice, nb_element, nb_element),
		]);

		// // create data view of slice
		// let av_slice = new DataView(at_slice.buffer, at_slice.byteOffset, at_slice.byteLength);

		// // method name
		// let s_get_value = H_TYPED_ARRAY_NAMES_TO_GET_METHOD[this._dc_typed_array.name];

		// // create typed array of slice
		// return new this._dc_typed_array([
		// 	av_slice[s_get_value](0, true),
		// 	av_slice[s_get_value](1 << ns_element, true),
		// ]);
	}

	/**
	 * Access a sequence of unisgned int elements starting at the given position.
	 * @param  {TypedArrayIndex} it_lo - inclusive lower range of slice
	 * @param  {TypedArrayIndex} it_hi - exclusive upper range of slice
	 * @return {TypedArray} the sliced data
	 */
	async slice(it_lo=0, it_hi=this._nl_items-it_lo) {
		let ns_element = this._shifts_per_element;
		let at_slice = await this._kav_items.slice(it_lo<<ns_element, it_hi<<ns_element);

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

	/**
	 * Create an asynchronous cursor to read over a range of the array in chunks.
	 * @param  {TypedArrayIndex} it_lo - inclusive lower range of cursor
	 * @param  {TypedArrayIndex} [it_hi] - exclusive upper range of cursor
	 * @param  {ByteLength} [nb_chunk] - the size of chunks to fetch in bytes
	 * @return {[type]}          [description]
	 */
	cursor(it_lo=0, it_hi=this._nl_items-it_lo, nb_chunk=0) {
		return new AsyncTypedArrayCursor(this, it_lo, it_hi, nb_chunk);
	}

	next() {
		if(!Number.isFinite(this._nl_items)) throw new Error('cannot call next() method on AsyncTypedArray since size was not set');
		let ib_start = this._nl_items << this._shifts_per_element;
		let nb_view = this._kav_items.bytes;
		return this._kav_items.view(ib_start, nb_view - ib_start);
	}
}

AsyncTypedArray.Cursor = AsyncTypedArrayCursor;

module.exports = AsyncTypedArray;
