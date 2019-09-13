const fsp = require('fs').promises;
const ResourceConnection = require('../class/resource-connection.js');

module.exports = class ResourceConnection_File extends ResourceConnection {
	constructor(p_src) {
		super();

		Object.assign(this, {
			_p_src: p_src,
			_df_src: null,
			_nb_src: Infinity,
		});
	}

	get bytes() {
		return this._nb_src;
	}

	async init() {
		// open file handle
		let df_src = this._df_src = await fsp.open(this._p_src, 'r');

		// stat file for size
		this._nb_src = (await df_src.stat()).size;

		// done
		return await super.init();
	}

	async fetch(i_lo, i_hi) {
		// resource must be ready first
		await this.until_ready();

		// size of fetch
		let nb_fetch = i_hi - i_lo;

		// create new buffer
		let ab_fetch = Buffer.allocUnsafe(nb_fetch);

		// read into buffer
		let nb_read = (await this._df_src.read(ab_fetch, 0, nb_fetch, i_lo)).bytesRead;

		// read and fetch mismatch; trim buffer
		if(nb_read !== nb_fetch) {
			return ab_fetch.slice(0, nb_read);
		}

		// return as-is
		return ab_fetch;
	}
};
