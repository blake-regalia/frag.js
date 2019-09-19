const Initable = require('../class/initable.js');

module.exports = class ResourceConnection extends Initable {
	get bytes() {
		return this._nb_src;
	}

	fetch() {  // eslint-disable-line class-methods-use-this
		throw new Error('ResourceConnection#fetch() not implemented by subclass');
	}

	batch(a_ranges) {
		return Promise.all(a_ranges.map(a => this.fetch(a[0], a[1])));
	}
};
