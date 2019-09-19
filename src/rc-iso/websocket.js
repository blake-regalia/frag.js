const bkit = require('bkit');
const ResourceConnection = require('../class/resource-connection.js');

const X_REQUEST_SIZE = 0x01;
const X_REQUEST_RANGES = 0x02;
const X_RESPONSE_RANGES = 0xff - X_REQUEST_RANGES;
const X_RESPONSE_SIZE = 0xff - X_REQUEST_SIZE;

module.exports = class ResourceConnection_Websocket extends ResourceConnection {
	constructor(p_src) {
		super();

		Object.assign(this, {
			_p_src: p_src,
			_nb_src: Infinity,
			_d_socket: null,
		});
	}

	// async init() {
	// 	let p_src = this._p_src;

	// 	// create websocket
	// 	let d_socket = this._d_socket = new WebSocket(p_src, 'chunk.bat-rdf.link');

	// 	// keep incoming data in memory
	// 	d_socket.binaryType = 'arraybuffer';

	// 	// socket events
	// 	let h_events = {
	// 		// socket connected
	// 		open() {
	// 			// request size
	// 			d_socket.send(new Uint8Array([X_REQUEST_SIZE]));
	// 		},

	// 		// message received
	// 		message: (h_msg) => {
	// 			// response data
	// 			let at_res = h_msg.data;

	// 			// prep decoder
	// 			let kbd_msg = new bkit.BufferDecoder(at_res);

	// 			// message type
	// 			let x_type = kbd_msg.byte();

	// 			// route response
	// 			switch(x_type) {
	// 				// successfully initialized; save size
	// 				case X_RESPONSE_SIZE: {
	// 					this._nb_src = kbd_msg.vuint();
	// 					break;
	// 				}

	// 				// range
	// 				case X_RESPONSE_RANGES: {
	// 					for(;;) {
	// 						// index of first byte
	// 						let i_start = kbd_msg.vuint();

	// 						// size of range
	// 						let nb_range = kbd_msg.vuint();

	// 						// push range
	// 						let at_range = kbd_msg.sub(nb_range);

	// 						// create hash
	// 						a_parts.push(new Uint8Array([i_start, 0, nb_range]));

	// 						// continue
	// 					}
	// 				}

	// 				// other
	// 				default: {
	// 					throw ResourceConnection.raw(`Custom Websocket protocol error; unexpected control byte ${x_type}`);
	// 				}
	// 			}
	// 		},

	// 		// error occurred
	// 		error(e_socket) {

	// 		},

	// 		// socket closed
	// 		close() {

	// 		},
	// 	};

	// 	// bind events
	// 	for(let s_event in h_events) {
	// 		d_socket.addEventListener(s_event, h_events[s_event]);
	// 	}
	// }
};
