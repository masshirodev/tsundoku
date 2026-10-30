import { describe, expect, it } from 'vitest';
import { pathsFor } from '../src/lib/server/fspath.ts';
import { isUnder, commonDir } from '../src/lib/server/paths.ts';

describe('fspath on Windows (c183)', () => {
	const w = pathsFor('win32');

	it('writes what it builds with /', () => {
		expect(w.join('C:\\Users\\Ami\\AppData\\Local\\tsundoku', 'library', 'Mihon')).toBe(
			'C:/Users/Ami/AppData/Local/tsundoku/library/Mihon'
		);
		expect(w.join('C:/data', 'a\\b', '..', 'c')).toBe('C:/data/a/c');
		expect(w.dirname('C:\\a\\b\\c.cbz')).toBe('C:/a/b');
		expect(w.relative('C:/lib/Mihon', 'C:\\lib\\Mihon\\x\\y.cbz')).toBe('x/y.cbz');
		expect(w.resolve('D:\\Manga', 'one')).toBe('D:/Manga/one');
		expect(w.normalize('C:\\a\\.\\b')).toBe('C:/a/b');
		expect(w.slash('E:\\Syncthing\\Mihon')).toBe('E:/Syncthing/Mihon');
	});

	it('reads either spelling', () => {
		expect(w.basename('C:\\a\\Chapter 1.cbz', '.cbz')).toBe('Chapter 1');
		expect(w.extname('C:/a/b.epub')).toBe('.epub');
		expect(w.isAbsolute('C:/a')).toBe(true);
		expect(w.isAbsolute('C:\\a')).toBe(true);
	});

	it('so the library’s own comparisons hold for what the importer builds', () => {
		const library = w.join('C:\\Users\\Ami\\AppData\\Local\\tsundoku', 'library');
		const file = w.join(library, 'Mihon', 'downloads', 'Src (EN)', 'Title', 'Ch 1.cbz');
		expect(isUnder(file, library)).toBe(true);
		expect(commonDir([w.dirname(file), w.join(library, 'Mihon', 'local')])).toBe(
			`${library}/Mihon`
		);
	});
});

describe('fspath elsewhere', () => {
	const l = pathsFor('linux');

	it('is node:path, and a backslash stays a character in a name', () => {
		expect(l.join('/data', 'a\\b.cbz')).toBe('/data/a\\b.cbz');
		expect(l.slash('/x/a\\b')).toBe('/x/a\\b');
		expect(l.dirname('/a/b/c')).toBe('/a/b');
	});
});
