const fsp = require('fs').promises;
const ResourceConnection = require('../class/resource-connection.js');

module.exports = class ResourceConnection_FileHandle extends ResourceConnection {
	static async fromPath(p_src) {
		// open file handle
		let df_src = await fsp.open(p_src, 'r');

		// create instance
		return new this(df_src);
	}

	constructor(df_src) {
		super();

		Object.assign(this, {
			_nb_src: Infinity,
			_df_src: df_src,
		});
	}

	async init() {
		// stat file for size
		this._nb_src = (await this._df_src.stat()).size;

		// done
		return await super.init();
	}

	// direct fetch of single range
	async fetch(ib_lo, ib_hi) {
		// resource must be ready first
		await this.until_ready();

		// size of fetch
		let nb_fetch = ib_hi - ib_lo;

		// create new buffer
		let ab_fetch = Buffer.allocUnsafe(nb_fetch);

		// read into buffer
		let nb_read = (await this._df_src.read(ab_fetch, 0, nb_fetch, ib_lo)).bytesRead;

		// read and fetch mismatch; trim buffer
		if(nb_read !== nb_fetch) {
			return ab_fetch.slice(0, nb_read);
		}

		// return as-is
		return ab_fetch;
	}
};
