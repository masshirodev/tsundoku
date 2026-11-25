// The text frame the engine and the app speak across JavaScript and Java
// (doc/WEB-EDITION.md, "The engine"). Kept as text because a string is the one
// value that crosses CheerpJ's boundary cheaply and exactly; bodies ride along
// as base64. The same frame goes both ways:
//
//   the app asks the engine     (web/engine-port.js → BrowserEngine.handle)
//   the engine asks a website   (BrowserTransport.fetchNative → the fetcher)
//
// A request:  head = "METHOD\nURL\nName: value\n...", body = base64 or ""
// An answer:  "STATUS\nName: value\n...\n\nBASE64", or "ERR <message>"

/**
 * @param {string} method
 * @param {string} url
 * @param {[string, string][]} headers
 */
export function encodeHead(method, url, headers) {
	return [method, url, ...headers.map(([k, v]) => `${k}: ${v}`)].join('\n') + '\n';
}

/** @param {string} head */
export function decodeHead(head) {
	const [method = '', url = '', ...rest] = head.split('\n');
	return { method, url, headers: parseHeaders(rest) };
}

/**
 * @param {number} status
 * @param {[string, string][]} headers
 * @param {Uint8Array} body
 */
export function encodeAnswer(status, headers, body) {
	return `${status}\n${headers.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${toBase64(body)}`;
}

/**
 * @param {string} answer
 * @returns {{ status: number, headers: [string, string][], body: Uint8Array<ArrayBuffer> } | { error: string }}
 */
export function decodeAnswer(answer) {
	if (answer.startsWith('ERR ')) return { error: answer.slice(4) };
	const blank = answer.indexOf('\n\n');
	if (blank < 0) return { error: `not an engine answer: ${answer.slice(0, 80)}` };
	const [status, ...rest] = answer.slice(0, blank).split('\n');
	const code = Number.parseInt(status, 10);
	if (!Number.isInteger(code) || code < 100 || code > 599)
		return { error: `not an engine status: ${status.slice(0, 40)}` };
	return { status: code, headers: parseHeaders(rest), body: fromBase64(answer.slice(blank + 2)) };
}

/** @param {string[]} lines @returns {[string, string][]} */
function parseHeaders(lines) {
	/** @type {[string, string][]} */
	const out = [];
	for (const line of lines) {
		const colon = line.indexOf(':');
		if (colon > 0) out.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
	}
	return out;
}

// Chunked, so a body of megabytes does not overflow the argument list.
/** @param {Uint8Array} bytes */
export function toBase64(bytes) {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000)
		s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}

/** @param {string} text @returns {Uint8Array<ArrayBuffer>} */
export function fromBase64(text) {
	if (!text) return new Uint8Array(0);
	const s = atob(text);
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}
