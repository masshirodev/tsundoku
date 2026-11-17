import { topics } from '../help/topics.ts';

/**
 * What the search field can say. Most input is a query; a few exact strings
 * are commands, and they are exact on purpose -- reveal must never be one
 * accidental keystroke away, so `reveal` without the slash is just a query.
 */
export type SearchInput =
	| { type: 'empty' }
	| { type: 'query'; text: string }
	| { type: 'command'; command: Command }
	/** A page, offered as a result rather than run blind: `/settings`, `/settings watching`. */
	| { type: 'page'; label: string; href: string };

export type Command =
	'reveal' | 'hide' | 'light' | 'dark' | 'incognito' | 'scan' | 'lock' | 'unlock' | 'words';

const COMMANDS: Record<string, Command> = {
	'/reveal': 'reveal',
	'/hide': 'hide',
	'/light': 'light',
	'/dark': 'dark',
	'/incognito': 'incognito',
	'/scan': 'scan',
	// The fingerprint gate: enrol this device, or take the gate away.
	'/lock': 'lock',
	'/unlock': 'unlock',
	// The words looked up in Japanese, waiting for review (doc/JAPANESE.md).
	'/words': 'words'
};

export function parseSearch(raw: string): SearchInput {
	const text = raw.trim();
	if (text === '') return { type: 'empty' };
	const command = COMMANDS[text.toLowerCase()];
	if (command) return { type: 'command', command };
	// SETTINGS, and a section by its name (doc/SETTINGS.md, "Getting there").
	const settings = /^\/settings(?:\s+(\S.*))?$/i.exec(text);
	if (settings) {
		const word = (settings[1] ?? '').trim().toLowerCase();
		return {
			type: 'page',
			label: word ? `SETTINGS · ${word.toUpperCase()}` : 'SETTINGS',
			href: word ? `/settings?section=${encodeURIComponent(word)}` : '/settings'
		};
	}
	// HELP, and a topic by a word of it (doc/HELP.md): `/help`, `/help phone`.
	const help = /^\/help(?:\s+(\S.*))?$/i.exec(text);
	if (help) {
		const word = (help[1] ?? '').trim().toLowerCase();
		const topic = word ? helpTopicFor(word) : null;
		return {
			type: 'page',
			label: topic ? `HELP · ${topic.title.toUpperCase()}` : 'HELP',
			href: topic ? (topic.slug === 'start' ? '/start' : `/help/${topic.slug}`) : '/help'
		};
	}
	// HIGHLIGHTS (doc/HIGHLIGHTS.md): `/highlights`, and `/highlights lamp`
	// lands there with the word in its search.
	const highlights = /^\/highlights(?:\s+(\S.*))?$/i.exec(text);
	if (highlights) {
		const words = (highlights[1] ?? '').trim();
		return {
			type: 'page',
			label: words ? `HIGHLIGHTS · ${words.toUpperCase()}` : 'HIGHLIGHTS',
			href: words ? `/highlights?q=${encodeURIComponent(words)}` : '/highlights'
		};
	}
	return { type: 'query', text };
}

/**
 * What a top search bar's text means. Every bar draws a leading
 * `/` as its prompt, so only `filter` is the bar's own list: a command runs on
 * the screen the bar is on, a page opens, and a `/`-led string naming neither
 * is `unknown` and is said plainly rather than filtered for. A query that
 * never starts with `/` is always `filter`.
 */
export type BarInput =
	| { type: 'filter' }
	| { type: 'command'; command: Command }
	| { type: 'page'; label: string; href: string }
	| { type: 'unknown'; text: string };

export function parseBar(raw: string): BarInput {
	const parsed = parseSearch(raw);
	if (parsed.type === 'empty') return { type: 'filter' };
	if (parsed.type === 'query') {
		const text = raw.trim();
		return text.startsWith('/') ? { type: 'unknown', text } : { type: 'filter' };
	}
	return parsed;
}

/** A topic by a word of its title or its parts: "phone", "download", "update". */
function helpTopicFor(word: string) {
	const all = topics();
	return (
		all.find((t) => t.slug.startsWith(word)) ??
		all.find((t) => `${t.title} ${t.meta}`.toLowerCase().includes(word)) ??
		null
	);
}

/**
 * Split a title around the first case-insensitive match, so the match can be
 * highlighted without the title's own casing being changed.
 */
export function splitMatch(
	title: string,
	query: string
): { pre: string; mid: string; post: string } {
	const q = query.trim().toLowerCase();
	const at = q === '' ? -1 : title.toLowerCase().indexOf(q);
	if (at < 0) return { pre: title, mid: '', post: '' };
	return {
		pre: title.slice(0, at),
		mid: title.slice(at, at + q.length),
		post: title.slice(at + q.length)
	};
}

/** Escape a user query for a SQLite LIKE with `ESCAPE '\'`. */
export function likePattern(query: string): string {
	return `%${query.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
