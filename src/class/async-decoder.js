const bkit = require('bkit');

const AsyncLock = require('../class/async-lock.js');
const AsyncTypedArray = require('../class/async-typed-array.js');

// an empty buffer
const AT_EMPTY = new Uint8Array();

// default buffer chunk size in bytes
const NB_DEFAULT_BUFFER_CHUNK = 1 << 9;


// concatenate two buffers
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


// refresh the internal cache
async function AsyncDecoder$refresh(k_self, nb_need=1) {
	let ib_read = k_self._ib_read;

	// cache lower than need
	if(nb_need > k_self._at_cache.length) {
		let kav = k_self._kav;
		let nb_chunk = k_self._nb_chunk;

		// lock before going async
		k_self._at_cache = null;

		// fetch size
		let nb_fetch = Math.min(kav.cached(ib_read) || nb_chunk, nb_chunk);

		// advance read pointer
		let ib_advance = ib_read + Math.max(nb_fetch, nb_need);

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

// read a single byte from view
async function AsyncDecoder$byte(k_self) {
	// refresh cache
	let at_cache = await AsyncDecoder$refresh(k_self);

	// read byte
	let xb_value = at_cache[0];

	// adjust cache
	k_self._at_cache = at_cache.subarray(1);  // eslint-disable-line require-atomic-updates

	// return value
	return xb_value;
}

/* eslint-disable require-atomic-updates */
// decode a variable-width unsigned int
async function AsyncDecoder$vuint(k_self) {
	let at_cache = await AsyncDecoder$refresh(k_self);
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
		at_cache = concat_2(at_cache, await AsyncDecoder$refresh(k_self));
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
		at_cache = concat_2(at_cache, await AsyncDecoder$refresh(k_self));
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
		at_cache = concat_2(at_cache, await AsyncDecoder$refresh(k_self));
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
		at_cache = concat_2(at_cache, await AsyncDecoder$refresh(k_self));
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


/**
 * Asynchronously decode reserved datatypes from an AsyncView
 */
module.exports = class AsyncDecoder {
	/**
	 * @param  {AsyncView} kav - view to create the decoder from
	 * @param  {ByteLength} nb_chunk - size of chunk buffer in bytes
	 */
	constructor(kav, nb_chunk=NB_DEFAULT_BUFFER_CHUNK) {
		this._kav = kav;
		this._ib_read = 0;
		this._nb_chunk = nb_chunk || NB_DEFAULT_BUFFER_CHUNK;
		this._at_cache = AT_EMPTY;
		this._kl_cache = new AsyncLock();
	}

	/**
	 * The current read position within the view. Useful for determining how
	 * many bytes some variable-width data value occupied after decoding it.
	 * @return {BytePosition} the current read position relative to the view
	 */
	get read() {
		return this._ib_read-this._at_cache.length;
	}

	/**
	 * Create a new AsyncView on the remaining portion of data that has yet
	 * to be read. Accepts optional offset and length.
	 * @param  {BytePosition} ib_view - relative offset to start view
	 * @param  {ByteLength} nb_view - how many bytes to limit the view to
	 * @return {AsyncView} the new view
	 */
	view(ib_view=0, nb_view=this._kav.bytes-this.read-ib_view) {
		return this._kav.view(this.read+ib_view, nb_view);
	}

	/**
	 * Read a single byte from the view. Advances read position by 1.
	 * @return {ByteValue} the value of the byte
	 */
	async byte() {
		// acquire cache lock
		let f_release = await this._kl_cache.acquire();

		// read byte
		let xb_value = await AsyncDecoder$byte(this);

		// release cache lock
		f_release();

		// return value
		return xb_value;
	}

	/**
	 * Decode a variable-width unsigned int.
	 * @return {int} the decoded int value
	 */
	async vuint() {
		// acquire cache lock
		let f_release = await this._kl_cache.acquire();

		// read vuint
		let x_value = await AsyncDecoder$vuint(this);

		// relase cache lock
		f_release();

		// return value
		return x_value;
	}

	/**
	 * Decode a null-terminated UTF-8 string.
	 * @return {string} the decoded string
	 */
	async ntu8String() {
		// acquire cache lock
		let f_release = await this._kl_cache.acquire();

		// renew cache
		let at_cache = AT_EMPTY;

		// while missing null-terminator
		let ib_nt = -1;
		do {
			// refresh cache
			at_cache = concat_2(at_cache, await AsyncDecoder$refresh(this));

			// update null-terminator index
			ib_nt = at_cache.indexOf(0);
		} while(ib_nt < 0);

		// extract string
		let at_string = at_cache.subarray(0, ib_nt);

		// update cache
		this._at_cache = at_cache.slice(ib_nt+1);

		// relase cache lock
		f_release();

		// decode string
		return bkit.decodeUtf8(at_string);
	}

	/**
	 * Decode a length-prefixed UTF-8 string.
	 * @return {string} the decoded string
	 */
	async lpu8String() {
		// acquire cache lock
		let f_release = await this._kl_cache.acquire();

		// string length
		let nb_string = await AsyncDecoder$vuint(this);

		// bytes needed
		let nb_refresh = nb_string - this._at_cache.length;

		// refresh cache
		let at_cache = await AsyncDecoder$refresh(this, nb_refresh);

		// update cache
		this._at_cache = at_cache.slice(nb_string);

		// relase cache lock
		f_release();

		// decode string
		return bkit.decodeUtf8(at_cache.slice(0, nb_string));
	}

	/**
	 * Create a new AsyncTypedArray by decoding the type and length from the view.
	 * @return {AsyncTypedArray} the asynchronous typed array
	 */
	async typedArray() {
		// acquire cache lock
		let f_release = await this._kl_cache.acquire();

		// typed array type
		let x_type = await AsyncDecoder$byte(this);

		// nubmer of elements in array
		let nl_items = await AsyncDecoder$vuint(this);

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
		f_release();

		return kat_array;
	}
};
