import { describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { load } = await import('../src/routes/+page.server');

type Scan = { finishedAt: number | null } | null;
const sortOf = async (query: string, scan: Scan = null) => {
	const data = (await load({
		url: new URL(`http://tsundoku.test/${query}`),
		cookies: { get: () => undefined },
		parent: async () => ({ scan })
	} as never)) as { sort: string };
	return data.sort;
};

/** Which sort the library opens on when the link names none (doc/LIBRARY.md). */
describe('the default sort', () => {
	it('is NEWEST on NEW, where it means newest arrival', async () => {
		expect(await sortOf('?shelf=new')).toBe('added');
	});

	it('is NEWEST while a scan runs', async () => {
		expect(await sortOf('', { finishedAt: null })).toBe('added');
	});

	it('is the library’s own anywhere else', async () => {
		expect(await sortOf('')).toBe('recent');
		expect(await sortOf('?shelf=all')).toBe('recent');
	});

	it('gives way to a sort the link names', async () => {
		expect(await sortOf('?shelf=new&sort=title')).toBe('title');
	});
});
