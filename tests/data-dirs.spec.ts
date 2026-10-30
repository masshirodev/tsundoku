import { describe, expect, it } from 'vitest';
import { dataPaths, defaultHome } from '../src/lib/server/data-dirs.ts';

describe('defaultHome', () => {
	it('is LOCALAPPDATA on Windows, with forward slashes', () => {
		expect(
			defaultHome('win32', { LOCALAPPDATA: 'C:\\Users\\Ami\\AppData\\Local' }, 'C:\\Users\\Ami')
		).toBe('C:/Users/Ami/AppData/Local/tsundoku');
	});

	it('falls back to the profile folder when LOCALAPPDATA is unset', () => {
		expect(defaultHome('win32', {}, 'C:\\Users\\Ami')).toBe('C:/Users/Ami/AppData/Local/tsundoku');
	});

	it('is Application Support on macOS', () => {
		expect(defaultHome('darwin', {}, '/Users/ami')).toBe(
			'/Users/ami/Library/Application Support/tsundoku'
		);
	});

	it('is XDG_DATA_HOME on Linux, or ~/.local/share', () => {
		expect(defaultHome('linux', { XDG_DATA_HOME: '/data' }, '/home/ami')).toBe('/data/tsundoku');
		expect(defaultHome('linux', {}, '/home/ami')).toBe('/home/ami/.local/share/tsundoku');
	});
});

describe('dataPaths', () => {
	it('derives every folder from TSUNDOKU_HOME', () => {
		// The workstation's one line reproduces the paths it always had.
		expect(dataPaths({ TSUNDOKU_HOME: '/mnt/hdd2/tsundoku' }, 'linux', '/home/x')).toEqual({
			home: '/mnt/hdd2/tsundoku',
			library: '/mnt/hdd2/tsundoku/library',
			covers: '/mnt/hdd2/tsundoku/covers',
			trash: '/mnt/hdd2/tsundoku/trash',
			backups: '/mnt/hdd2/tsundoku/backups',
			engineStore: '/mnt/hdd2/tsundoku/engine/store',
			novelStore: '/mnt/hdd2/tsundoku/engine/store/novels',
			ocrScratch: '/mnt/hdd2/tsundoku/ocr-scratch',
			mokuro: '/mnt/hdd2/tsundoku/mokuro/venv/bin/mokuro'
		});
	});

	it('lets each folder’s own variable win', () => {
		const p = dataPaths(
			{
				TSUNDOKU_HOME: '/h',
				LIBRARY_ROOT: '/lib',
				BACKUP_DIR: '/mnt/backup/tsundoku',
				ENGINE_STORE: '/store'
			},
			'linux',
			'/home/x'
		);
		expect(p.library).toBe('/lib');
		expect(p.backups).toBe('/mnt/backup/tsundoku');
		expect(p.novelStore).toBe('/store/novels');
		expect(p.covers).toBe('/h/covers');
	});

	it('treats an empty variable as unset', () => {
		expect(dataPaths({ TSUNDOKU_HOME: '/h', LIBRARY_ROOT: '' }, 'linux', '/x').library).toBe(
			'/h/library'
		);
	});

	it('defaults to the platform folder when TSUNDOKU_HOME is unset', () => {
		expect(dataPaths({}, 'linux', '/home/ami').library).toBe(
			'/home/ami/.local/share/tsundoku/library'
		);
	});

	it('writes Windows paths with forward slashes, given or derived', () => {
		const p = dataPaths(
			{ LOCALAPPDATA: 'C:\\Users\\Ami\\AppData\\Local', LIBRARY_ROOT: 'D:\\Manga' },
			'win32',
			'C:\\Users\\Ami'
		);
		expect(p.library).toBe('D:/Manga');
		expect(p.covers).toBe('C:/Users/Ami/AppData/Local/tsundoku/covers');
		expect(p.mokuro).toBe('C:/Users/Ami/AppData/Local/tsundoku/mokuro/venv/Scripts/mokuro.exe');
	});
});
