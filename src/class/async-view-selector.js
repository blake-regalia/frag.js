const AsyncView = require('../class/async-view.js');

/**
 * Acts as a hub for creating AsyncView instances from a set of AsyncBuffers. This allows
 * for categorical memory management.
 */
module.exports = class AsyncViewSelector {
	/**
	 * @param  {Hash<AsyncBuffer>} h_buffers - hash of buffers to use
	 * @param  {BytePosition} ib_start - absolute byte position to start view
	 * @param  {ByteLength} nb_view - length of view in bytes
	 */
	constructor(h_buffers, ib_start=0, nb_view=Infinity) {
		this._h_buffers = h_buffers;
		this._ib_start = ib_start;

		// infinite view length; deduce byte limit from first buffer
		if(!Number.isFinite(nb_view)) {
			nb_view = h_buffers[Object.keys(h_buffers)[0]].bytes;
		}

		// set view length
		this._nb_view = nb_view;
	}

	/**
	 * Get the size of the view range in bytes
	 * @return {ByteLength} size of view range
	 */
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

	/**
	 * Skip read position forward a certain number of bytes
	 * @param  {ByteLength} nb_skip - length of skip
	 * @return {this} instance
	 */
	skip(nb_skip) {
		this._ib_start += nb_skip;
		this._nb_view -= nb_skip;
		// if(this._nb_view < 0) {
		// 	debugger;
		// }
		return this;
	}

	/**
	 * Create a new AsyncViewSelector by narrowing the current view
	 * @param  {BytePosition} ib_rel - start position relative to the current view
	 * @param  {ByteLength} nb_view - size of new view
	 * @return {AsyncViewSelector} the narrowed view selector
	 */
	view(ib_rel=0, nb_view=Infinity) {
		// infinite view length; adjust to end (cannot expand)
		if(!Number.isFinite(nb_view)) {
			nb_view = this._nb_view - ib_rel;
		}
		// negative view length is relative to end length
		else if(nb_view < 0) {
			nb_view = this._nb_view - ib_rel + nb_view;
		}

		// new view
		return new AsyncViewSelector(this._h_buffers, this._ib_start+ib_rel, nb_view);
	}

	/**
	 * Create an AsyncView by selecting a buffer by its key identifier
	 * @param  {Key} si_region - key that identifiers which buffer to select
	 * @param  {AsyncView} [kav_ref]  - optional view reference to create new view range from
	 * @return {AsyncView} the new view
	 */
	select(si_region, kav_ref=null) {
		let kab_select = this._h_buffers[si_region];
		if(!kab_select) throw new Error(`AsyncViewSelector does not have a region labeled '${si_region}'`);

		// no reference, use this
		if(!kav_ref) kav_ref = this;

		// new view
		return new AsyncView(kab_select, kav_ref._ib_start, kav_ref._nb_view);
	}

	/**
	 * Clear the cache of the given buffer
	 * @param  {string} si_buffer - the key that identifies which buffer to clear
	 * @return {[type]}          [description]
	 */
	clear(si_buffer) {
		return this._h_buffers[si_buffer].clear();
	}
};
