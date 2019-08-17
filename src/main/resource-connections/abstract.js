
module.exports = class resource_connection {
	constructor() {}

	async init() {
		throw new Error('resource_connection#init() not implemented by subclass');
	}

	async fetch() {
		throw new Error('resource_connection#fetch() not implemented by subclass');
	}

	async fetch_ranges(a_ranges) {
		return await Promise.all(a_ranges.map((a) => this.fetch(a[0], a[1])));
	}
};
