const ResourceConnection = require('../class/resource-connection.js');

module.exports = class ResourceConnection_FileBlob extends ResourceConnection {
	constructor(db_src) {
		super();

		Object.assign(this, {
			_db_src: db_src,
			_nb_src: db_src.size,
		});
	}

	// direct fetch of single range
	async fetch(ib_lo, ib_hi) {
		// create blob slice
		let db_slice = this._db_src.slice(ib_lo, ib_hi, this._db_src.type);

		// return array buffer
		return new Uint8Array(await db_slice.arrayBuffer());
	}

	// // 
	// async stream(ib_lo, ib_hi) {
	// 	// create blob slice
	// 	let db_slice = this._db_src.slice(ib_lo, ib_hi, this._db_src.type);

	// 	// return stream
	// 	return await db_slice.stream();
	// }
};
