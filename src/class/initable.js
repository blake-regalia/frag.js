
module.exports = class Initable {
	static async new(...a_args) {
		// construct new instance using exact args
		let k_self = new this(...a_args);

		// await for instance to init (from inst to supers)
		await k_self.init();

		// super.init() was not called
		console.assert(k_self._b_init_ready, `Implementing subclass of Initable never called super.init(): ${k_self}`);

		// return instance
		return k_self;
	}

	constructor() {
		this._a_init_await = [];
		this._b_init_ready = false;
	}

	init() {
		// init already called
		if(this._b_init_ready) {
			console.error((new Error('Initable#init() was called more than once. Check stack for caller')).stack);
			return;
		}

		// init completed
		this._b_init_ready = true;

		// empty wait ready queue
		while(this._a_init_await.length) {
			this._a_init_await.shift()();
		}
	}

	async until_ready() {
		// ready; return
		if(this._b_init_ready) return;

		// go async
		return await new Promise((fk_resolve) => {
			// push to await queue
			this._a_init_await.push(fk_resolve);
		});
	}
};
