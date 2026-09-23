// Runs once per spec file, before that file's module graph is evaluated.
//
// If two spec files ever share a process, this is the first thing that notices.
// The invariant is set by `pool` and `isolate` in vitest.config.ts; this asserts
// it rather than trusting it to stay the default. Ported from Kumiko, where the
// failure it prevents is two specs silently sharing one SQLite database.
const sentinel = '__tsundokuSuiteLoaded';
const globals = globalThis as Record<string, unknown>;
if (globals[sentinel]) {
	throw new Error(
		'Two spec files shared a process, so they would share one database. ' +
			'Check `pool` and `isolate` in vitest.config.ts.'
	);
}
globals[sentinel] = true;
