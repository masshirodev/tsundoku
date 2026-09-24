import { describe, expect, it } from 'vitest';
import { BookZip, MemberUnavailable, RemoteZip } from '$lib/epub/remote';
import type { ZipReader } from '$lib/epub/unzip';

/** A workstation that answers from a map, counting what it was asked. */
function workstation(files: Record<string, string>) {
	const asked: string[] = [];
	const fetcher = (async (url: string | URL | Request) => {
		const name = decodeURIComponent(String(url).split('p=')[1]);
		asked.push(name);
		if (name === 'down.xhtml') throw new TypeError('offline');
		return name in files ? new Response(files[name]) : new Response('no', { status: 404 });
	}) as typeof fetch;
	return { asked, fetcher };
}

describe('a book read file by file', () => {
	const list = [
		{ name: 'META-INF/container.xml', size: 10 },
		{ name: 'OEBPS/ch1.xhtml', size: 20 },
		{ name: 'down.xhtml', size: 5 }
	];

	it('knows its files and their sizes without asking', () => {
		const { asked, fetcher } = workstation({});
		const zip = new RemoteZip(list, (n) => `/f?p=${encodeURIComponent(n)}`, fetcher);
		expect(zip.names).toEqual(list.map((f) => f.name));
		expect(zip.has('OEBPS/ch1.xhtml')).toBe(true);
		expect(zip.has('OEBPS/ch9.xhtml')).toBe(false);
		expect(zip.sizeOf('META-INF/container.xml')).toBe(10);
		expect(asked).toEqual([]);
	});

	it('asks for a file once, and keeps it for the session', async () => {
		const { asked, fetcher } = workstation({ 'OEBPS/ch1.xhtml': '<p>一</p>' });
		const zip = new RemoteZip(list, (n) => `/f?p=${encodeURIComponent(n)}`, fetcher);
		expect(await zip.textOf('OEBPS/ch1.xhtml')).toBe('<p>一</p>');
		await zip.bytesOf('OEBPS/ch1.xhtml');
		expect(asked).toEqual(['OEBPS/ch1.xhtml']);
	});

	it('says a file is unavailable offline or missing, and asks again next time', async () => {
		const { asked, fetcher } = workstation({});
		const zip = new RemoteZip(list, (n) => `/f?p=${encodeURIComponent(n)}`, fetcher);
		await expect(zip.bytesOf('down.xhtml')).rejects.toBeInstanceOf(MemberUnavailable);
		await expect(zip.bytesOf('OEBPS/ch1.xhtml')).rejects.toBeInstanceOf(MemberUnavailable);
		await expect(zip.bytesOf('down.xhtml')).rejects.toBeInstanceOf(MemberUnavailable);
		expect(asked).toEqual(['down.xhtml', 'OEBPS/ch1.xhtml', 'down.xhtml']);
	});
});

describe('the whole book, arriving behind the first chapter', () => {
	it('reads from the workstation until the book is here, then from memory', async () => {
		const { asked, fetcher } = workstation({ 'OEBPS/ch1.xhtml': 'remote' });
		const zip = new BookZip(
			new RemoteZip([{ name: 'OEBPS/ch1.xhtml', size: 6 }], (n) => `/f?p=${n}`, fetcher)
		);
		expect(zip.complete).toBe(false);
		expect(await zip.textOf('OEBPS/ch1.xhtml')).toBe('remote');
		const whole: ZipReader = {
			names: ['OEBPS/ch1.xhtml'],
			has: () => true,
			bytesOf: async () => new TextEncoder().encode('whole'),
			textOf: async () => 'whole'
		};
		zip.arrived(whole);
		expect(zip.complete).toBe(true);
		expect(await zip.textOf('OEBPS/ch1.xhtml')).toBe('whole');
		expect(asked).toEqual(['OEBPS/ch1.xhtml']);
	});
});
