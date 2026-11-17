/**
 * What the pre-commit hook formats and lints, per staged file.
 *
 * The extension lists have to cover everything `yarn run lint` checks in CI,
 * which is `prettier --check .` over the whole tree. They did not: `.mjs` was
 * missing, so every build script under `scripts/` was formatted by nobody and
 * checked by CI — a commit that touched one passed the hook and failed the
 * pipeline eight minutes later, having spent a runner to say "add a newline".
 *
 * `.cjs` is here for the same reason rather than because anything uses it
 * today. A list that has to match another list is only safe if it is the wider
 * one.
 *
 * **Code extensions get one key, not two.** `eslint --fix` and
 * `prettier --write` both rewrite the file, and lint-staged runs *different
 * keys concurrently* — so registering `.ts` and `.svelte` under a lint glob and
 * again under a format glob had two processes writing one path at the same
 * time. Non-deterministic, last writer wins, and it could leave a file that
 * passed the hook and then failed `yarn run lint` on formatting alone. Commands
 * within a single key run in order, which is the property this depends on.
 */

const CODE = '*.{js,cjs,mjs,ts,svelte}';
const TEXT = '*.{json,css,md,yml,yaml}';

const codeSteps = [];
if (!process.env.SKIP_LINT) codeSteps.push('eslint --fix');
if (!process.env.SKIP_FORMAT) codeSteps.push('prettier --write');

const config = {};
if (codeSteps.length) config[CODE] = codeSteps;
if (!process.env.SKIP_FORMAT) config[TEXT] = 'prettier --write';

export default config;
