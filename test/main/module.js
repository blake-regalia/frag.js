const frag = require('../../lib/main/module.js');
const worker = require('worker');

worker.dedicated({

	async load_hdt(a_sources) {
		let kf_hdt = frag(a_sources);

		let nb_hdt = await kf_hdt.size();
		this.emit('size', nb_hdt);

		let kav_header = kf_hdt.view();
		kav_header.slice(0, 10);
	},

	async load_bat(a_sources) {
		let kf_bat = frag(a_sources);

		let nb_bat = await kf_bat.size();

		
	},

});
