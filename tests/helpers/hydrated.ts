/**
 * `tests/fixtures.ts` under the name eighteen spec files import it by.
 *
 * This file added the hydration wait to `goto`, `reload`, `goBack` and
 * `goForward` for the specs that imported it (c439, wave 19), while the
 * fixtures were another slot's. Since wave 21 the fixtures do that for every
 * spec (c477), so what is left here is a pass-through: the same `test`, the
 * same `hydrated()` and the same helpers, kept so no importer has to change.
 * A new spec imports from `./fixtures`.
 */
export { expect, hydrated, readerReady, screenSettled, test } from '../fixtures';
