
module.exports = class AsyncLock {
	constructor() {
		this._b_locked = false;
		this._a_awaits = [];
	}

	acquire() {
		// not locked
		if(!this._b_locked) {
			// lock
			this._b_locked = true;

			// done
			return;
		}

		// wait for lock
		return new Promise((fk_acquire) => {
			this._a_awaits.push(fk_acquire);
		});
	}

	release() {
		// at least one promise waiting for lock
		if(this._a_awaits.length) {
			// queue behind current tick
			setTimeout(() => {
				// resolve promise
				this._a_awaits.shift()();
			}, 0);
		}
		// otherwise, unlock
		else {
			this._b_locked = false;
		}
	}
};
