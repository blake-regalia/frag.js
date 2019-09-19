const {
	B_BROWSER,
} = require('../main/locals.js');

module.exports = Object.assign({
	AutoSwitching: require('./auto-switching.js'),
	HttpRange: require('./http-range.js'),
}, B_BROWSER
	? require('../rc-browser/locals.js')
	: require('../rc-node/locals.js'));
