
// deduce the runtime environment
const [B_BROWSER, B_BROWSERIFY] = (() => 'undefined' === typeof process
	? [true, false]
	: (process.browser
		? [true, true]
		: ('undefined' === process.versions || 'undefined' === process.versions.node
			? [true, false]
			: [false, false])))();

class ResourceConnectionError extends Error {
	static raw(s_message) {
		return new this(new Error(s_message));
	}

	constructor(e_src) {
		super(e_src.message);
		this._e_src = e_src;
	}
}

class ResourceConnectionError_HttpStatus extends ResourceConnectionError {
	constructor(d_res, s_message) {
		super(new Error(`${d_res.status} HTTP/S response from <${d_res.url}>${s_message? `; ${s_message}`: ''}`));
		this._d_res = d_res;
	}

	text() {
		return this._d_res.text();
	}
}

class ResourceConnectionError_HttpHeader extends ResourceConnectionError {
	constructor(d_res, s_message) {
		super(new Error(`Invalid HTTP/S header(s) from <${d_res.url}>; ${s_message}`));
		this._d_res = d_res;
	}

	headers() {
		return this._d_res.headers;
	}
}

class ResourceConnectionError_Cache extends ResourceConnectionError {
	constructor(s_message) {
		super(new Error(`Cache invalid. ${s_message}`));
	}
}

class ResourceConnectionError_Range extends ResourceConnectionError {
	constructor(s_message) {
		super(new Error(`Invalid request range. ${s_message}`));
	}
}

Object.assign(ResourceConnectionError, {
	HttpStatus: ResourceConnectionError_HttpStatus,
	HttpHeader: ResourceConnectionError_HttpHeader,
	Cache: ResourceConnectionError_Cache,
	Range: ResourceConnectionError_Range,
});

module.exports = {
	B_BROWSER,
	ResourceConnectionError,
};
