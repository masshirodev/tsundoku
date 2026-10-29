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
	// SETTINGS, and a section by its name (doc/SETTINGS.md, "Getting there"; card c171).
	const settings = /^\/settings(?:\s+(\S.*))?$/i.exec(text);
	if (settings) {
		const word = (settings[1] ?? '').trim().toLowerCase();
		return {
			type: 'page',
			label: word ? `SETTINGS · ${word.toUpperCase()}` : 'SETTINGS',
			href: word ? `/settings?section=${encodeURIComponent(word)}` : '/settings'
		};
	}
	return { type: 'query', text };
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
