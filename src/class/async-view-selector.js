const AsyncView = require('../class/async-view.js');

/**
 * Acts as a hub for creating AsyncView instances from a set of AsyncBuffers. This allows
 * for categorical memory management.
 */
module.exports = class AsyncViewSelector {
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

		// new view
		return new AsyncViewSelector(this._h_buffers, this._ib_start+ib_rel, nb_view);
	}

	select(s_region, kav_ref=null) {
		let kab_select = this._h_buffers[s_region];
		if(!kab_select) throw new Error(`AsyncViewSelector does not have a region labeled '${s_region}'`);

		if(!kav_ref) kav_ref = this;

		return new AsyncView(kab_select, kav_ref._ib_start, kav_ref._nb_view);
	}

	free(s_region) {
		return this._h_buffers[s_region].free();
	}
};
