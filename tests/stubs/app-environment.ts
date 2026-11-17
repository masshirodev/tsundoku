// Stands in for SvelteKit's `$app/environment` virtual module, which only
// exists inside a Kit build (as app-paths.ts does for `$app/paths`). A unit
// spec runs server code as a built bundle would: not the dev server, so
// nothing that `dev` turns on (the no-token sign-in bypass, auth.ts) is on
// here, and not a browser. A spec that needs another answer mocks the module.
export const dev = false;
export const browser = false;
export const building = false;
export const version = 'test';
