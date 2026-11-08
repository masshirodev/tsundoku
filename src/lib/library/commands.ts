import { goto, invalidateAll } from '$app/navigation';
import { resolve } from '$app/paths';
import { TV } from '../device.svelte.ts';
import { parseBar, type BarInput } from './search.ts';

/**
 * A command typed into any top search bar (card c697). The library's `/search`
 * bar is the source of truth: this runs the same parse (`parseBar`) and the
 * same server door (`/api/command`, which calls `runCommand`), so `/reveal`,
 * `/incognito` and the rest mean the same thing everywhere. The screen the bar
 * is on stays where it is -- the loads are re-read and the reveal or incognito
 * band appears -- unless the command itself opens somewhere (`/settings`,
 * `/help`, `/lock`, `/words`, and `/reveal` behind the fingerprint gate, whose
 * device prompt is `/search`'s).
 *
 * `filter` is the bar's own list: the caller lets its form submit as it
 * always did. `refused` is shown by the bar, never swallowed. `busy` is a press
 * dropped because a command is already running.
 */
export type CommandOutcome =
	{ type: 'filter' } | { type: 'ran' } | { type: 'busy' } | { type: 'refused'; message: string };

type Answer = {
	ok?: boolean;
	message?: string;
	href?: string;
	/** Navigation state for `href`: the `go` intent of `/lock`, `/unlock` and a gated `/reveal`. */
	state?: Record<string, unknown>;
};

/**
 * Whether the bar must stop its own form. Asked and answered synchronously:
 * `preventDefault` after an `await` is too late, so the caller decides before
 * it awaits `runSearchCommand`.
 */
export const isSearchCommand = (raw: string): boolean => parseBar(raw).type !== 'filter';

/**
 * One command at a time, across every bar. Without it a double Enter gets two
 * answers, and the second `goto` lands on a `/search` already mounted: a new
 * entry on the same route, so no `onMount` empties its `go`, and a later back
 * onto it would run the command with no key pressed.
 */
let running = false;

export async function runSearchCommand(raw: string): Promise<CommandOutcome> {
	const input = parseBar(raw);
	if (input.type === 'filter') return { type: 'filter' };
	if (input.type === 'unknown') {
		return {
			type: 'refused',
			message: `UNKNOWN COMMAND · ${input.text.toUpperCase()} · NOTHING CHANGED`
		};
	}
	// A TV has no fingerprint and no screen lock, so it cannot turn reveal on
	// (owner, 2026-11-01; doc/TV.md). The server cannot tell a TV apart, so the
	// refusal is here, in the same words `/search` uses.
	if (
		input.type === 'command' &&
		input.command === 'reveal' &&
		typeof window !== 'undefined' &&
		matchMedia(TV).matches
	) {
		return { type: 'refused', message: 'NOT ON A TV · TURN REVEAL ON FROM THE COMPUTER' };
	}
	// After the refusals, which ask nothing and must still say so mid-run.
	if (running) return { type: 'busy' };
	running = true;
	try {
		return await run(input);
	} finally {
		running = false;
	}
}

async function run(input: Exclude<BarInput, { type: 'filter' | 'unknown' }>) {
	if (input.type === 'page') {
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- a page's own path, from parseSearch
		await goto(input.href);
		return { type: 'ran' } as const;
	}
	let answer: Answer | null;
	try {
		const res = await fetch(resolve('/api/command'), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ command: input.command })
		});
		answer = (await res.json()) as Answer;
	} catch {
		answer = null;
	}
	if (!answer?.ok) {
		return {
			type: 'refused',
			message: String(
				answer?.message ?? 'THE WORKSTATION DID NOT ANSWER · NOTHING CHANGED'
			).toUpperCase()
		} as const;
	}
	if (answer.href) {
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- built by the server's own route table
		await goto(answer.href, { state: answer.state });
		return { type: 'ran' } as const;
	}
	await invalidateAll();
	return { type: 'ran' } as const;
}
