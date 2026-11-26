// A build plugin for the web edition's server worker (doc/WEB-EDITION.md):
// every Node built-in the server code imports becomes a module with the same
// export names, read from Node itself at build time, each of which throws
// "not in the web edition" when called. Importing never fails, so the whole
// server bundles and loads; only a code path that really needs the machine
// (a file, a process, a socket) fails, and says which call it was.
//
// A few modules are not stubbed but replaced: `path` is pure string work, and
// a handful of calls that run while modules load must not throw.
import { readFileSync } from 'node:fs';
import { createRequire, isBuiltin as nodeIsBuiltin } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = (/** @type {string} */ f) => fileURLToPath(new URL(f, import.meta.url));

const require = createRequire(import.meta.url);

/** @type {Record<string, string>} */
const REPLACED = {
	path: here('./node-path.js'),
	'path/posix': here('./node-path.js'),
	// The npm package is Node's Buffer for browsers.
	buffer: require.resolve('buffer/'),
	async_hooks: here('./async-hooks.js')
};

// Calls made at module load somewhere in the server bundle; they answer
// something harmless instead of throwing.
/**
 * Built-ins the web edition implements in part (doc/WEB-EDITION.md, "Files"):
 * every name the file exports is the real call; every other name of the
 * module stays a stub that throws, naming the call.
 * @type {Record<string, string>}
 */
const IMPLEMENTED = {
	fs: here('./fs.js'),
	'fs/promises': here('./fs-promises.js')
};

/** The names a file of ours exports, read from its text (`export const name`). @param {string} file */
const exportsOf = (file) =>
	new Set([...readFileSync(file, 'utf8').matchAll(/^export const (\w+)/gm)].map((m) => m[1]));

/** @type {Record<string, Record<string, string>>} */
const AT_LOAD = {
	util: {
		promisify: '(fn) => (...a) => Promise.resolve().then(() => fn(...a))',
		inspect: '(v) => String(v)',
		format: '(...a) => a.join(" ")',
		deprecate: '(fn) => fn',
		debuglog: '() => Object.assign(() => {}, { enabled: false })',
		inherits:
			'(c, p) => { Object.setPrototypeOf(c.prototype, p.prototype); Object.setPrototypeOf(c, p); }',
		TextEncoder: 'globalThis.TextEncoder',
		TextDecoder: 'globalThis.TextDecoder',
		types: '({})'
	},
	os: {
		EOL: '"\\n"',
		platform: '() => "browser"',
		homedir: '() => "/"',
		tmpdir: '() => "/tmp"',
		hostname: '() => "tsundoku-web"',
		networkInterfaces: '() => ({})'
	},
	crypto: {
		randomUUID: '() => globalThis.crypto.randomUUID()',
		getRandomValues: '(a) => globalThis.crypto.getRandomValues(a)'
	}
};

const bare = (/** @type {string} */ id) => (id.startsWith('node:') ? id.slice(5) : id);
const isBuiltin = (/** @type {string} */ id) => nodeIsBuiltin(id) && !id.startsWith('\0');

export function nodeStubs() {
	return {
		name: 'tsundoku-web-node-stubs',
		enforce: 'pre',
		/** @param {string} id */
		resolveId(id) {
			if (!isBuiltin(id)) return null;
			const name = bare(id);
			return REPLACED[name] ?? `\0node-stub:${name}`;
		},
		/** @param {string} id */
		async load(id) {
			if (!id.startsWith('\0node-stub:')) return null;
			const name = id.slice('\0node-stub:'.length);
			// Deliberately dynamic: which built-in is only known per import.
			const real = await import(/* @vite-ignore */ `node:${name}`);
			const keys = Object.keys(real).filter((k) => k !== 'default' && /^[A-Za-z_$][\w$]*$/.test(k));
			const given = AT_LOAD[name] ?? {};
			const file = IMPLEMENTED[name];
			const implemented = file ? exportsOf(file) : new Set();
			const lines = [
				`const missing = (what) => function () { throw new Error('node:${name}.' + what + ' is not in the web edition'); };`
			];
			if (file) lines.push(`import * as impl from ${JSON.stringify(file)};`);
			for (const k of keys)
				lines.push(
					`export const ${k} = ${implemented.has(k) ? `impl.${k}` : (given[k] ?? `missing(${JSON.stringify(k)})`)};`
				);
			// A name the module never had still says which call it was; then
			// and symbols answer undefined, or the default would look like a
			// promise to anything that awaits it.
			lines.push(
				`export default new Proxy({ ${keys.map((k) => `${k}`).join(', ')} }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && k !== 'then' ? missing(k) : undefined) });`
			);
			return lines.join('\n');
		}
	};
}
