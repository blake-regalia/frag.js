const fs = require('fs');
const resource_connection = require('./abstract.js');

module.exports = class resource_connection_file extends resource_connection {
	constructor(p_file) {
		super();

		Object.assign(this, {
			path: p_file,
			bytes: Infinity,
			fd: null,
		});
	}

	init() {
		return new Promise((fk_init, fe_init) => {
			fs.open(this.path, 'r', (e_open, if_file) => {
				if(e_open) return fe_init(e_open);

				fs.fstat(if_file, (e_stat, d_stats) => {
					if(e_stat) return fe_init(e_stat);

					// save file descriptor
					this.fd = if_file;

					// save file size
					this.bytes = d_stats.size;

					// initialization complete
					fk_init();
				});
			});
		});
	}

	fetch(i_lo, i_hi) {
		return new Promise((fk_fetch, fe_fetch) => {
			// size of fetch
			let nb_fetch = i_hi - i_lo;

			// create new buffer
			let ab_fetch = Buffer.allocUnsafe(nb_fetch);

			// read into buffer
			fs.read(this.fd, ab_fetch, 0, nb_fetch, i_lo, (e_read, nb_read) => {
				if(e_read) return fe_fetch(e_read);

				// return buffer
				fk_fetch(ab_fetch);
			});
		});
	}
};
