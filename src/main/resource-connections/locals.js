const {
	B_BROWSER,
} = require('../locals.js');

function mk_void(s_name) {
	throw new Error(`cannot create an instance of '${s_name}' in this environment`);
}

module.exports = Object.assign({
	auto_switching: require('./auto-switching.js'),
	file: mk_void('file'),
}, require('./isomorphic/locals.js'), B_BROWSER
	? require('./browser/locals.js')
	: require('./node/locals.js'));
