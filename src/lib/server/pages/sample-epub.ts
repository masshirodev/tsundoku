import { zip } from '../zip-write.ts';
import { samplePage } from './sample.ts';

/**
 * The seed library's novels have no files, like its manga: their EPUB is
 * generated here, deterministic, from the series' own entries, so the text
 * reader is developed and tested against a book that turns (doc/TEXT-READER.md).
 *
 * Each entry is a chapter document `OEBPS/ch<n>.xhtml`, which is the locator
 * the seed gives it. Chapter 1 has an illustration, chapter 2 a listing and a
 * table wider than the column, so every kind of block is on hand. A Cover and
 * an Afterword frame the chapters as front and back matter.
 */

const LINES = [
	'The steward did not sit down. He stood in the doorway with his hat against his chest, as if the smell of ink might get into his coat if he came any further in.',
	'"How large?" he asked.',
	'Life size meant a full sheet of the good paper, the heavy kind the stationers on Weaver Street only sold by the quire. It meant four days of line work at least, and another two for the tone.',
	'Mira, who had been pretending to sort brushes at the back of the room, dropped one. It rolled under the drying rack and neither of them went after it.',
	'It was more than the workshop had earned since spring. He looked at the stack of unpaid invoices under the inkstone, then at the half-finished page on his desk, where a knight on horseback was still waiting for a face.',
	'"Then I will need to see that."',
	'For a moment he thought he had spoken out of turn, and that the man would put his hat back on and leave. Instead the steward took a small card from his breast pocket and laid it on the corner of the desk, well away from the wet ink.',
	'The corridor beyond was lined with portraits, and every one of them was of the same man at a different age.'
];

const esc = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const doc = (title: string, body: string) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${esc(title)}</title></head>
<body>
${body}
</body>
</html>`;

/** Paragraphs for chapter `n`: the same lines, rotated, and marked with where they are. */
function paragraphs(n: number, count: number): string {
	const out: string[] = [];
	for (let i = 0; i < count; i++)
		out.push(`<p>${esc(LINES[(n + i) % LINES.length])} (${n}.${i + 1})</p>`);
	return out.join('\n');
}

const LISTING = [
	'; walk the import descriptors of a mapped PE image (esi = image base), a line wider than any column',
	'mov     eax, [esi+3Ch]              ; e_lfanew: offset of the NT headers',
	'lea     eax, [esi+eax]              ; eax -> IMAGE_NT_HEADERS',
	'mov     ebx, [eax+80h]              ; DataDirectory[1].VirtualAddress (imports)'
].join('\n');

const TABLE = `<table>
<tr><th>FLAG</th><th>VALUE</th><th>MEANING</th><th>USUALLY ON</th></tr>
<tr><td>IMAGE_SCN_CNT_INITIALIZED_DATA</td><td>0x00000040</td><td>Section contains initialized data</td><td>.data, .rdata</td></tr>
<tr><td>IMAGE_SCN_MEM_EXECUTE</td><td>0x20000000</td><td>Pages can be executed</td><td>.text</td></tr>
</table>`;

export function sampleEpub(o: {
	title: string;
	hue: number;
	/** The entries' own labels, in order: one chapter each. */
	chapters: string[];
	language?: string;
}): Buffer {
	const files: { name: string; data: string | Buffer; deflate?: boolean }[] = [
		{ name: 'mimetype', data: 'application/epub+zip' },
		{
			name: 'META-INF/container.xml',
			data: `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
		}
	];
	const chapter = (n: number, label: string) => {
		let body = `<h1>${esc(label)}</h1>\n${paragraphs(n, 14)}`;
		if (n === 1)
			body =
				`<h1>${esc(label)}</h1>\n${paragraphs(n, 3)}\n<p><img src="images/plate.png" alt="Plate"/></p>\n` +
				paragraphs(n + 3, 10);
		if (n === 2)
			body =
				`<h1>${esc(label)}</h1>\n${paragraphs(n, 2)}\n<pre><code>${esc(LISTING)}</code></pre>\n` +
				`${TABLE}\n${paragraphs(n + 2, 10)}`;
		return doc(label, body);
	};
	o.chapters.forEach((label, i) =>
		files.push({ name: `OEBPS/ch${i + 1}.xhtml`, data: chapter(i + 1, label), deflate: true })
	);
	files.push(
		{
			name: 'OEBPS/cover.xhtml',
			data: doc('Cover', `<p><img src="images/plate.png" alt="Cover"/></p>`)
		},
		{
			name: 'OEBPS/afterword.xhtml',
			data: doc('Afterword', `<h1>Afterword</h1>\n${paragraphs(0, 3)}`),
			deflate: true
		},
		{ name: 'OEBPS/images/plate.png', data: samplePage(o.hue, 1) }
	);
	const items = [
		`<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
		...o.chapters.map(
			(_, i) => `<item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`
		),
		`<item id="afterword" href="afterword.xhtml" media-type="application/xhtml+xml"/>`,
		`<item id="plate" href="images/plate.png" media-type="image/png" properties="cover-image"/>`,
		`<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`
	];
	const spine = ['cover', ...o.chapters.map((_, i) => `ch${i + 1}`), 'afterword'];
	files.push({
		name: 'OEBPS/content.opf',
		data: `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">sample:${esc(o.title)}</dc:identifier>
<dc:title>${esc(o.title)}</dc:title>
<dc:creator>Development Sample</dc:creator>
<dc:language>${o.language ?? 'en'}</dc:language>
</metadata>
<manifest>
${items.join('\n')}
</manifest>
<spine toc="ncx">
${spine.map((id) => `<itemref idref="${id}"/>`).join('\n')}
</spine>
</package>`
	});
	const points = [
		['Cover', 'cover.xhtml'],
		...o.chapters.map((label, i) => [label, `ch${i + 1}.xhtml`]),
		['Afterword', 'afterword.xhtml']
	];
	files.push({
		name: 'OEBPS/toc.ncx',
		data: `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<navMap>
${points.map(([label, src], i) => `<navPoint id="p${i}" playOrder="${i + 1}"><navLabel><text>${esc(label)}</text></navLabel><content src="${src}"/></navPoint>`).join('\n')}
</navMap>
</ncx>`
	});
	return zip(files);
}
