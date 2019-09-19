const frag = require('../../src/main/module.js');

function map_tree(h_tree, {node:f_node, leaf:f_leaf}) {
	for(let s_key in h_tree) {
		let z_value = h_tree[s_key];

		if('function' === typeof z_value) {
			f_leaf(s_key, z_value);
		}
		else {
			f_node(s_key, z_value);
		}
	}
}

function describes(s_root, h_tree) {
	map_tree(h_tree, {
		node(s_node, f_leafs) {
			describe(s_node, () => {
				f_leafs();
			});
		},

		leaf(s_leaf, f_leaf) {
			it(s_leaf, f_leaf);
		},
	});
}

describes('frag', {
	from: {},

	Initable: {},

	AsyncLock: {},

	AsyncBuffer: {},

	AsyncView: {},

	AsyncTypedArray: {},
	AsyncTypedArrayCursor: {},

	AsyncViewSelector: {},

	ResourceConnection: {
		HttpRange: {},

		AutoSwitching: {},

		Websocket: {},

		FileHandle: {},
	},
});

