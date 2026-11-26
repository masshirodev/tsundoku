// The web edition's `node:net` (doc/WEB-EDITION.md, "The stand-ins"): the
// pure calls only. A tab has no sockets; what the server code needs from
// `node:net` without one is telling an address from a name (`isIP`, which
// net-guard.ts asks before it checks an address). Every other name of
// `node:net` stays a stub that throws (web/node-stubs.js). Each answer is held
// to Node's own in tests/web-edition.spec.ts.

const V4_PART = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)';
const V4 = new RegExp(`^${V4_PART}(?:\\.${V4_PART}){3}$`);

/** @param {unknown} input */
export function isIPv4(input) {
	return typeof input === 'string' && V4.test(input);
}

/** @param {unknown} input */
export function isIPv6(input) {
	if (typeof input !== 'string' || !input.includes(':')) return false;
	// A zone (`fe80::1%eth0`) is Node's to accept and the URL parser's to refuse.
	const at = input.indexOf('%');
	const bare = at < 0 ? input : input.slice(0, at);
	if (at >= 0 && (at === input.length - 1 || /[\s/[\]]/.test(input.slice(at + 1)))) return false;
	if (!/^[0-9a-fA-F:.]+$/.test(bare)) return false;
	// Groups of one to four hex digits, at most one '::', a dotted IPv4 tail only last.
	const tail = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/.exec(bare);
	if (tail && !isIPv4(tail[1])) return false;
	const head = tail ? bare.slice(0, bare.length - tail[1].length) : bare;
	if (/:::/.test(head) || (head.match(/::/g) ?? []).length > 1) return false;
	const groups = head.split(':');
	if (groups.some((g) => g.length > 4)) return false;
	const filled = groups.filter((g) => g !== '').length + (tail ? 2 : 0);
	const compressed = head.includes('::');
	if (compressed ? filled > 7 : filled !== 8) return false;
	if (!compressed) {
		// No empty group except where '::' made one.
		const inner = tail ? groups.slice(0, -1) : groups;
		if (inner.some((g) => g === '')) return false;
	} else {
		// A lone ':' at either end is not '::'.
		if (head.startsWith(':') && !head.startsWith('::')) return false;
		if (!tail && head.endsWith(':') && !head.endsWith('::')) return false;
	}
	return true;
}

/** 4, 6, or 0 for anything that is not an address, as Node's `net.isIP`. @param {unknown} input */
export function isIP(input) {
	if (isIPv4(input)) return 4;
	if (isIPv6(input)) return 6;
	return 0;
}
