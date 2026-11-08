import { describe, expect, it } from 'vitest';

/**
 * No spec inherits a git hook's GIT_* variables (tests/vitest.global-setup.ts).
 * pre-push runs the unit specs with GIT_DIR pointing at the repository being
 * pushed, and a spec that runs `git` in a scratch folder would act on that
 * repository instead: on 2026-11-07 a spec's `git init` turned the main
 * checkout into `core.bare = true`. Falsify with
 * `GIT_DIR=$PWD/.git yarn run test:unit tests/git-env.spec.ts` after removing
 * the loop in the global setup.
 */
describe("a git hook's environment never reaches a spec", () => {
	it('has no GIT_* variable', () => {
		expect(Object.keys(process.env).filter((k) => k.startsWith('GIT_'))).toEqual([]);
	});
});
