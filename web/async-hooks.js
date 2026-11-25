// node:async_hooks for the web edition's server worker (doc/WEB-EDITION.md).
// Paraglide's middleware keeps each request's language in an
// AsyncLocalStorage. A browser has no such thing (AsyncContext is still a
// proposal), so this one holds one store at a time: what run() was given is
// what getStore() answers until the next run(). Requests that interleave would
// see each other's store; in the web edition every request is the same
// reader's, in the same language, so the answer is the same either way. Any
// use that needs a real per-request store must not rely on this.
export class AsyncLocalStorage {
	/** @type {unknown} */
	#store;
	getStore() {
		return this.#store;
	}
	/** @param {unknown} store @param {(...a: any[]) => any} fn @param {...any} args */
	run(store, fn, ...args) {
		this.#store = store;
		return fn(...args);
	}
	/** @param {unknown} store */
	enterWith(store) {
		this.#store = store;
	}
	/** @param {(...a: any[]) => any} fn @param {...any} args */
	exit(fn, ...args) {
		return fn(...args);
	}
	disable() {
		this.#store = undefined;
	}
}
export class AsyncResource {
	/** @param {(...a: any[]) => any} fn @param {unknown} thisArg @param {...any} args */
	runInAsyncScope(fn, thisArg, ...args) {
		return fn.apply(thisArg, args);
	}
	/** @param {Function} fn */
	bind(fn) {
		return fn;
	}
	/** @param {Function} fn */
	static bind(fn) {
		return fn;
	}
}
export const createHook = () => ({ enable() {}, disable() {} });
export const executionAsyncId = () => 0;
export default { AsyncLocalStorage, AsyncResource, createHook, executionAsyncId };
