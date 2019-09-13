const composite_resource_connection = require('./composite.js');

module.exports = class auto_switching_composite_resource_connection extends composite_resource_connection {
	constructor(a_krcs=[]) {
		super();

		// let a_validations = [];
		// for(let i_range=0; i_range<n_validations; i_range++) {

		// 	a_validations.push();
		// }

		let a_ready = [];

		Object.assign(this, {
			krc: null,
			krcs: a_krcs,
			ready: a_ready,
			// validations: a_validations,
		});

		// this.add(a_krcs).then((krc) => {
		// 	this.krc = krc;
		// 	while(a_ready.length) {
		// 		a_ready.shift()();
		// 	}
		// });
	}

	init() {
		let b_first = true;

		// wait for each resource to initialize
		return Promise.all(this.krcs.map(async (krc) => {
			// wait for it to initialize
			await krc.init();

			// this was first
			if(b_first) {
				// set as primary resource connection
				this.krc = krc;

				// no longer first
				b_first = false;
			}
		}));
	}

	// async add(a_krcs_add) {
	// 	let a_krcs = this.krcs;
	// 	if(!a_krcs.length) {
	// 	}
	// }

	async validate(krc) {
		Promise.race([
			krc.size(),
		]);
	}

	async fetch(i_lo, i_hi) {
		return this.krc.fetch(i_lo, i_hi);
	}

	// size() {
	// 	return new Promise((f_resolve) => {
	// 		if(this.krc) return f_resolve(this.krc.bytes);

	// 		this.ready.push(() => {
	// 			f_resolve(this.krc.bytes);
	// 		});
	// 	});
	// }
};
