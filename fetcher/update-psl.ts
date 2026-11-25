// Refreshes the fetcher's copy of the Public Suffix List
// (src/lib/fetcher/public_suffix_list.dat): `yarn run fetcher:psl`, then
// commit the file. The extension is built with no network, so the list is
// vendored rather than fetched at build time; doc/WEB-EDITION.md, "The
// fetcher", says why and how often.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://publicsuffix.org/list/public_suffix_list.dat';
const target = fileURLToPath(new URL('../src/lib/fetcher/public_suffix_list.dat', import.meta.url));

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`${SOURCE} answered ${response.status}`);
const text = await response.text();

// A truncated or replaced download would silently rename every site, so the
// file must look like the list: both sections, and thousands of rules.
for (const marker of ['===BEGIN ICANN DOMAINS===', '===BEGIN PRIVATE DOMAINS===']) {
	if (!text.includes(marker)) throw new Error(`the download has no ${marker}`);
}
const rules = text.split('\n').filter((line) => line.trim() && !line.startsWith('//')).length;
if (rules < 5000) throw new Error(`the download has only ${rules} rules`);

let previous = '';
try {
	previous = readFileSync(target, 'utf8');
} catch {
	// First run: nothing to compare against.
}
writeFileSync(target, text);
const version = /^\/\/ VERSION: (.*)$/m.exec(text)?.[1] ?? 'unversioned';
console.log(
	previous === text
		? `public_suffix_list.dat is current (${version}, ${rules} rules)`
		: `public_suffix_list.dat updated to ${version} (${rules} rules)`
);
