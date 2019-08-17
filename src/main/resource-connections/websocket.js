const resource_connection = require('./abstract.js');

const X_REQUEST_SIZE = 0x01;
const X_REQUEST_RANGES = 0x02;
const X_RESPONSE_RANGES = 0xff - X_REQUEST_RANGES;
const X_RESPONSE_SIZE = 0xff - X_REQUEST_SIZE;

module.exports = class resource_connection_websocket extends resource_connection {
	constructor(p_url) {
		super();

		// create websocket
		let d_socket = new WebSocket(p_url, 'chunk.bat-rdf.link');

		// keep incoming data in memory
		d_socket.binaryType = 'arraybuffer';

		// socket events
		let h_events = {
			// socket connected
			open: () => {
				// request size
				d_socket.send(new Uint8Array([X_REQUEST_SIZE]));
			},

			// message received
			message: (h_msg) => {
				// response data
				let at_res = h_msg.data;

				// message type
				let x_type = at_res[0];

				// prep decoder
				let kbd_msg = new bkit.buffer_decoder(at_res);

				// skip first byte
				kbd_msg.read = 1;

				// route response
				switch(x_type) {
					// successfully initialized; save size
					case X_RESPONSE_SIZE: this.size = kbd_msg.vuint(); break;

					// range
					case X_RESPONSE_RANGES: {
						for(;;) {
							// index of first byte
							let i_start = kbd_msg.vuint();

							// size of range
							let nb_range = kbd_msg.vuint();

							// extract range
							let at_range = kbd_msg.sub(nb_range);

							// create hash
							new Uint8Array([i_start, 0, nb_range]);

							// callback

							// repeat
						}
					}
				}
			},

			// error occurred
			error: (e_socket) => {

			},

			// socket closed
			close: () => {

			},
		};

		// bind events
		for(let s_event in h_events) {
			d_socket.addEventListener(s_event, h_events[s_event]);
		}

		Object.assign(this, {
			url: p_url,
			socket: d_socket,
			size: null,
			error: null,
			ready_init: [],
		});
	}

	init() {
		return new Promise((fk_init, fe_init) => {
			// already initialized
			if(this.size) {
				fk_init({
					size: this.size,
				});
			}
			// error while connecting
			else if(this.error) {
				fe_init(this.error);
			}
			// not yet ready
			else {
				this.ready_init.push([fk_init, fe_init]);
			}
		});
	}
};
