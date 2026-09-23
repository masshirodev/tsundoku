// Stands in for SvelteKit's `$app/paths` virtual module, which only exists
// inside a Kit build. Aliased in vitest.config.ts so a unit spec can import a
// module that reaches for the base path without pulling `sveltekit()` into the
// test config. Empty is what an app served from the root resolves it to anyway.
export const base = '';
export const assets = '';
export const resolve = (path: string) => path;
