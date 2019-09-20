const AsyncBuffer = require('../class/async-buffer.js');
const AsyncDecoder = require('../class/async-decoder.js');

/**
 * A class for accessing specific ranges of a resource, allowing the same AsyncBuffer instance
 * to be reused accross different views for better memory management. AsyncViews provide means
 * to access the resource relative to some starting position and limited to some byte span.
 */
module.exports = class AsyncView {
	/**
	 * Create a new (empty) AsyncView from an existing one by reusing it's AsyncBuffer's ResourceConnection
	 *   (i.e., cache is not preserved)
	 * @param  {AsyncView} kav_from - the existing AsyncView
	 * @return {AsyncView} the new instance
	 */
	static fromAsyncView(kav_from, ...a_args) {
		return new this(AsyncBuffer.fromAsyncBuffer(kav_from._kab), kav_from._ib_start, kav_from._nb_view, ...a_args);
	}

	/**
	 * @param  {AsyncBuffer} kab - the AsyncBuffer instance to use for this view
	 * @param  {BytePosition} ib_start - inclusive lower range of view
	 * @param  {ByteLength} nb_view - number of bytes this view will span
	 */
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

	/**
	 * Create a new AsyncDecoder from this view
	 * @param  {...spreadArgs} a_args - additional arguments to AsyncDecoder constructor
	 * @return {AsyncDecoder} the new decoder
	 */
	decoder(...a_args) {
		return new AsyncDecoder(this, ...a_args);
	}

	/**
	 * Deduce the number of bytes available in the cached chunk starting at the given position.
	 * @param  {BytePosition} ib_rel - starting position to inquire about  (relative to this instance's current view range)
	 * @return {ByteLength} number of contiguous bytes available in cached chunk following starting position
	 */
	cached(ib_rel) {
		// ask buffer for size of chunk cache
		let nb_cached = this._kab.cached(this._ib_start+ib_rel);

		// clamp to remaining size of view
		return Math.min(nb_cached, this._nb_view-ib_rel);
	}

	/**
	 * Extract a range of bytes spanning at least the given minimum byte length,
	 *   returning the longest contiguous chunk remainder if already cached.
	 * @param  {BytePosition} ib_lo - inclusive lower range of slice (relative to this instance's current view range)
	 * @param  {ByteLength} nb_min - minimum span of slice
	 * @return {Uint8Array} the sliced data buffer
	 */
	pluck(ib_lo, nb_min) {
		// set minimum fetch size, opting for longer cache if available
		let nb_fetch = Math.max(nb_min, this.cached(ib_lo));

		// fetch chunk for testing
		return this.slice(ib_lo, ib_lo+nb_fetch);
	}

	/**
	 * Create a new AsyncView by selecting a subregion of the current view.
	 *   Reuses this instance's AsyncBuffer (i.e., cache is preserved)
	 * @param  {BytePosition} ib_rel - the position to start the new view relative to this instance's current view range
	 * @param  {ByteLength} nb_view - number of bytes the new view will span
	 * @return {AsyncView} the new instance
	 */
	view(ib_rel, nb_view=-1) {
		if(nb_view < 0) nb_view = this._nb_view - ib_rel;
		let ib_view = this._ib_start + ib_rel;
		return new AsyncView(this._kab, ib_view, nb_view);
	}

	/**
	 * Extract a range of bytes from this instance's AsyncBuffer.
	 * @param  {BytePosition} ib_lo - inclusive lower range of slice (relative to this instance's current view range)
	 * @param  {BytePosition} ib_hi - exclusive upper range of slice (relative to this instance's current view range)
	 * @return {Uint8Array} the sliced data buffer
	 */
	async slice(ib_lo=0, ib_hi=Infinity) {
		let {
			_kab: kab,
			_ib_start: ib_start,
		} = this;

		return await kab.slice(ib_start+ib_lo, Infinity === ib_hi? kab.bytes: ib_start+ib_hi);
	}

	/**
	 * Extract a list of byte ranges from this instance's AsyncBuffer.
	 * @param  {Array<BytePositionRange>} a_ranges - list of byte ranges (relative to this instance's current view range)
	 * @return {Array<Uint8Array>} corresponding list of sliced data buffers
	 */
	async slices(a_ranges) {
		let ib_start = this._ib_start;
		return await this._kab.slices(a_ranges.map(a => [ib_start+a[0], ib_start+a[1]]));
	}

	/**
	 * Create a new AsyncView that starts at the current read position of this instance
	 * @return {AsyncView} the narrowed view
	 */
	remainder() {
		return new AsyncView(this._kab, this._ib_start+this._nb_view);
	}

	// // fetch given ranges and then discard bytes
	// async fetch(a_ranges) {
	// 	let ib_start = this._ib_start;
	// 	return await this._kab._krc.fetch_ranges(a_ranges.map(a => [ib_start+a[0], ib_start+a[1]]));
	// }
};
