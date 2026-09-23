/**
 * What the search field can say. Most input is a query; a few exact strings
 * are commands, and they are exact on purpose -- reveal must never be one
 * accidental keystroke away, so `reveal` without the slash is just a query.
 */
export type SearchInput =
	{ type: 'empty' } | { type: 'query'; text: string } | { type: 'command'; command: Command };

export type Command = 'reveal' | 'hide' | 'light' | 'dark' | 'incognito' | 'scan';

const COMMANDS: Record<string, Command> = {
	'/reveal': 'reveal',
	'/hide': 'hide',
	'/light': 'light',
	'/dark': 'dark',
	'/incognito': 'incognito',
	'/scan': 'scan'
};

export function parseSearch(raw: string): SearchInput {
	const text = raw.trim();
	if (text === '') return { type: 'empty' };
	const command = COMMANDS[text.toLowerCase()];
	if (command) return { type: 'command', command };
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
