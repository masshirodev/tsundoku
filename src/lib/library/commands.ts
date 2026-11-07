import { goto, invalidateAll } from '$app/navigation';
import { resolve } from '$app/paths';
import { TV } from '../device.svelte.ts';
import { parseBar } from './search.ts';

/**
 * A command typed into any top search bar (card c697). The library's `/search`
 * bar is the source of truth: this runs the same parse (`parseBar`) and the
 * same server door (`/api/command`, which calls `runCommand`), so `/reveal`,
 * `/incognito` and the rest mean the same thing everywhere. The screen the bar
 * is on stays where it is -- the loads are re-read and the reveal or incognito
 * band appears -- unless the command itself opens somewhere (`/settings`,
 * `/help`, `/lock`, `/words`).
 *
 * `filter` is the bar's own list: the caller lets its form submit as it
 * always did. `refused` is shown by the bar, never swallowed.
 */
export type CommandOutcome =
	{ type: 'filter' } | { type: 'ran' } | { type: 'refused'; message: string };

type Answer = {
	ok?: boolean;
	message?: string;
	href?: string;
	/** Navigation state for `href`: `/lock`'s and `/unlock`'s `go` intent. */
	state?: Record<string, unknown>;
};

/**
 * Whether the bar must stop its own form. Asked and answered synchronously:
 * `preventDefault` after an `await` is too late, so the caller decides before
 * it awaits `runSearchCommand`.
 */
export const isSearchCommand = (raw: string): boolean => parseBar(raw).type !== 'filter';

export async function runSearchCommand(raw: string): Promise<CommandOutcome> {
	const input = parseBar(raw);
	if (input.type === 'filter') return { type: 'filter' };
	if (input.type === 'unknown') {
		return {
			type: 'refused',
			message: `UNKNOWN COMMAND · ${input.text.toUpperCase()} · NOTHING CHANGED`
		};
	}
	if (input.type === 'page') {
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- a page's own path, from parseSearch
		await goto(input.href);
		return { type: 'ran' };
	}
	// A TV has no fingerprint and no screen lock, so it cannot turn reveal on
	// (owner, 2026-11-01; doc/TV.md). The server cannot tell a TV apart, so the
	// refusal is here, in the same words `/search` uses.
	if (input.command === 'reveal' && typeof window !== 'undefined' && matchMedia(TV).matches) {
		return { type: 'refused', message: 'NOT ON A TV · TURN REVEAL ON FROM THE COMPUTER' };
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
		};
	}
	if (answer.href) {
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- built by the server's own route table
		await goto(answer.href, { state: answer.state });
		return { type: 'ran' };
	}
	await invalidateAll();
	return { type: 'ran' };
}
