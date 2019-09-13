const {
	B_BROWSER,
} = require('../main/locals.js');

function mk_void(s_name) {
	throw new Error(`cannot create an instance of '${s_name}' in this environment`);
}

module.exports = Object.assign({
	AutoSwitching: require('./auto-switching.js'),
	HttpRange: require('./http-range.js'),
	// File: mk_void('file'),
}, B_BROWSER
	? require('../rc-browser/locals.js')
	: require('../rc-node/locals.js'));
