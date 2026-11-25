// node:path's posix half, for the web edition's server worker: pure string
// work over "/" paths, which is what every path tsundoku stores already is
// (doc/DISTRIBUTION.md, "Windows paths").
export const sep = '/';
export const delimiter = ':';

/** @param {string} p */
export function normalize(p) {
	if (p === '') return '.';
	const abs = p.startsWith('/');
	const out = [];
	for (const part of p.split('/')) {
		if (part === '' || part === '.') continue;
		if (part === '..') {
			if (out.length && out[out.length - 1] !== '..') out.pop();
			else if (!abs) out.push('..');
		} else out.push(part);
	}
	const body = out.join('/');
	const trail = p.endsWith('/') && body ? '/' : '';
	return (abs ? '/' : '') + body + trail || (abs ? '/' : '.');
}

export const isAbsolute = (/** @type {string} */ p) => p.startsWith('/');
export const join = (/** @type {string[]} */ ...parts) =>
	normalize(parts.filter((x) => x !== '').join('/') || '.');

/** @param {...string} parts */
export function resolve(...parts) {
	let out = '';
	for (let i = parts.length - 1; i >= 0 && !out.startsWith('/'); i--)
		out = parts[i] + (out ? `/${out}` : '');
	return normalize(out.startsWith('/') ? out : `/${out}`).replace(/(.)\/$/, '$1');
}

/** @param {string} p */
export function dirname(p) {
	const n = p.replace(/\/+$/, '');
	if (n === '') return p.startsWith('/') ? '/' : '.';
	const i = n.lastIndexOf('/');
	if (i < 0) return '.';
	return i === 0 ? '/' : n.slice(0, i);
}

/** @param {string} p @param {string} [ext] */
export function basename(p, ext = '') {
	const b = p.replace(/\/+$/, '').split('/').pop() ?? '';
	return ext && b.endsWith(ext) && b !== ext ? b.slice(0, -ext.length) : b;
}

/** @param {string} p */
export function extname(p) {
	const b = basename(p);
	const i = b.lastIndexOf('.');
	return i <= 0 ? '' : b.slice(i);
}

/** @param {string} from @param {string} to */
export function relative(from, to) {
	const a = resolve(from).split('/').filter(Boolean);
	const b = resolve(to).split('/').filter(Boolean);
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i++;
	return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

/** @param {string} p */
export function parse(p) {
	const base = basename(p);
	const ext = extname(p);
	return {
		root: p.startsWith('/') ? '/' : '',
		dir: dirname(p),
		base,
		ext,
		name: ext ? base.slice(0, -ext.length) : base
	};
}

/** @param {{ dir?: string, root?: string, base?: string, name?: string, ext?: string }} parts */
export const format = ({ dir = '', root = '', base, name = '', ext = '' }) =>
	(dir || root ? `${dir || root}${dir && dir !== '/' ? '/' : ''}` : '') + (base ?? name + ext);

export const toNamespacedPath = (/** @type {string} */ p) => p;
/** @type {Record<string, unknown> & { posix?: unknown }} */
const path = {
	sep,
	delimiter,
	normalize,
	isAbsolute,
	join,
	resolve,
	dirname,
	basename,
	extname,
	relative,
	parse,
	format,
	toNamespacedPath
};
path.posix = path;
export const posix = path;
export default path;
