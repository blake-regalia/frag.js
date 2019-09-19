const {
	B_BROWSER,
} = require('./locals.js');

const rc = require('../rc-iso/locals.js');

const AsyncBuffer = require('../class/async-buffer.js');

class Abstraction {
	constructor(a_sources, h_options={}) {
		let a_krcs = a_sources.map((z_source) => {
			// path
			if('string' === typeof z_source) {
				let p_source = z_source;

				// file
				if('/' === p_source[0] || p_source.startsWith('./') || p_source.startsWith('../')) {
					// in browser
					if(B_BROWSER) {
						return new rc.http_range(p_source);
					}
					// in node.js
					else {
						return new rc.file(p_source);
					}
				}
				// http(s)
				else if(p_source.startsWith('http://') || p_source.startsWith('https://') || p_source.startsWith('file://')) {
					return new rc.http_range(p_source);
				}
				// websocket
				else if(p_source.startsWith('ws://')) {
					return new rc.websocket(p_source);
				}
				// torrent
				else if(p_source.startsWith('magnet:?') || p_source.endsWith('.torrent')) {
					throw new Error('not yet implemented');
				}
				// unknown
				else {
					throw new Error('not sure how to handle the string: '+p_source);
				}
			}
			// object
			else if('object' === typeof z_source) {
				// http(s)
				if(z_source instanceof rc.http_range) {
					return rc.http_range(z_source);
				}
				// websocket
				else if(z_source instanceof rc.websocket) {
					return rc.websocket(z_source);
				}
				// // torrent
				// else if(z_source instanceof )
				// plain object
				// if(Object === p_source.constructor)
			}

			return null;
		});

		let krc = new rc.auto_switching(a_krcs);
		let kab = new AsyncBuffer(krc);

		Object.assign(this, {
			krc,
			kab,
		});
	}

	get bytes() {
		return this._kab.bytes;
	}

	// create a new view
	view(i_start, nb_view) {
		return this.kab.view(i_start, nb_view);
	}
}


/* eslint-disable global-require */
module.exports = Object.assign((a_sources, h_options) => new Abstraction(a_sources, h_options), {
	AsyncBuffer: require('../class/async-buffer.js'),
	AsyncView: require('../class/async-view.js'),
	AsyncDecoder: require('../class/async-decoder.js'),
	AsyncTypedArray: require('../class/async-typed-array.js'),
	AsyncViewSelector: require('../class/async-view-selector.js'),

	Initable: require('../class/initable.js'),
	AsyncLock: require('../class/async-lock.js'),

	rc,
	resourceConnections: rc,
});
