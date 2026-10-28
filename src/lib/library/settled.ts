/**
 * A server answer that never rejects, so a page can draw "didn't answer" as
 * one of its states. A load hands it over as a promise when the browser runs
 * script (it streams) and as the value when it doesn't (server/prefs.ts,
 * SCRIPT_COOKIE): Svelte's server render draws an {#await}'s pending branch
 * even for a promise already settled, so a page without script needs the value.
 */
export type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

export const isSettled = <T>(v: Settled<T> | Promise<Settled<T>>): v is Settled<T> =>
	!(v instanceof Promise) && typeof (v as Settled<T>).ok === 'boolean';
