// release the lock
function AsyncLock$_release() {
	// at least one promise waiting for lock
	if(this._a_awaits.length) {
		// queue behind current tick
		setTimeout(() => {
			// resolve promise
			this._a_awaits.shift()(this._f_release);
		}, 0);
	}
	// otherwise, unlock
	else {
		this._b_locked = false;
	}
}

/**
 * Semaphore mechanism for async/await locking
 */
class AsyncLock {
	constructor() {
		this._b_locked = false;
		this._a_awaits = [];
		this._f_release = AsyncLock$_release.bind(this);
	}

	/**
	 * Acquire the exclusive lock. Returns a promise that resolves to a function which
	 * needs to be called in order to release the lock
	 * @return {Promise<ReleaseFunction>} resolves once lock is acquired
	 */
	acquire() {
		// not locked
		if(!this._b_locked) {
			// lock
			this._b_locked = true;

			// done
			return Promise.resolve(this._f_release);
		}

		// wait for lock
		return new Promise((fk_acquire) => {
			this._a_awaits.push(fk_acquire);
		});
	}
}

module.exports = AsyncLock;
