const Initable = require('../class/initable.js');

module.exports = class ResourceConnection extends Initable {
	fetch() {  // eslint-disable-line class-methods-use-this
		throw new Error('ResourceConnection#fetch() not implemented by subclass');
	}

	async fetch_ranges(a_ranges) {
		return await Promise.all(a_ranges.map(a => this.fetch(a[0], a[1])));
	}
};
