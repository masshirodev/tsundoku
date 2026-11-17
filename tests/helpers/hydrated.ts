/**
 * `tests/fixtures.ts` under the old name some spec files still import it by
 * (count them with `rg -l "from '\./helpers/hydrated'" tests/*.e2e.ts | wc -l`,
 * doc/TESTING.md's command; a typed count goes stale with the next new file).
 *
 * The fixtures add the hydration wait to `goto`, `reload`, `goBack` and
 * `goForward` for every spec that takes their `test` (not every spec does:
 * doc/TESTING.md, "E2E specs", has the generated count), so this file is a
 * pass-through: the same `test`, the same `hydrated()` and the same helpers,
 * kept so no importer has to change. A new spec imports from `./fixtures`.
 */
export { expect, hydrated, readerReady, screenSettled, test } from '../fixtures';
