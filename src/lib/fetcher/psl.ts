// Names a URL's site the way a browser names a cookie partition: scheme plus
// registrable domain ("eTLD+1"), by the Public Suffix List. The last two labels
// are wrong for every host under a multi-label suffix (`example.co.uk` would
// become `co.uk`), and a wrong partition finds no cookies at all.
//
// The list is vendored (public_suffix_list.dat, refreshed by
// `yarn run fetcher:psl`) and read with the algorithm at
// https://github.com/publicsuffix/list/wiki/Format. Both its sections count:
// Chromium and Firefox name sites with the private domains included, so
// `a.github.io` is a site of its own.

export interface SuffixRules {
	/** `com`, `co.uk`: a public suffix as written. */
	exact: Set<string>;
	/** `*.ck` stored as `ck`: every label under it is a public suffix. */
	wildcard: Set<string>;
	/** `!www.ck` stored as `www.ck`: not a suffix, despite a wildcard. */
	exception: Set<string>;
}

/** Parses the list's text. Rules are stored in ASCII (punycode), as URLs carry hosts. */
export function parseSuffixList(text: string): SuffixRules {
	const rules: SuffixRules = { exact: new Set(), wildcard: new Set(), exception: new Set() };
	for (const raw of text.split('\n')) {
		const line = raw.trim();
		if (!line || line.startsWith('//')) continue;
		// A rule is the line's first word; the format allows text after it.
		let rule = line.split(/\s/, 1)[0].toLowerCase();
		let into = rules.exact;
		if (rule.startsWith('!')) {
			into = rules.exception;
			rule = rule.slice(1);
		} else if (rule.startsWith('*.')) {
			into = rules.wildcard;
			rule = rule.slice(2);
		}
		into.add(toAscii(rule));
	}
	return rules;
}

/**
 * A host's registrable domain, or null when it has none: an IP address, or a
 * host that is itself a public suffix (`localhost`, `co.uk`). A browser then
 * uses the host itself as the site.
 */
export function registrableDomain(host: string, rules: SuffixRules): string | null {
	const name = host.toLowerCase().replace(/\.$/, '');
	if (!name || isIpAddress(name)) return null;
	const labels = name.split('.');
	const suffixLength = publicSuffixLength(labels, rules);
	if (labels.length <= suffixLength) return null;
	return labels.slice(labels.length - suffixLength - 1).join('.');
}

/** `https://a.b.example.co.uk/x` → `https://example.co.uk`: a cookie partition's `topLevelSite`. */
export function siteOf(url: string, rules: SuffixRules): string {
	const { protocol, hostname } = new URL(url);
	return `${protocol}//${registrableDomain(hostname, rules) ?? hostname}`;
}

function publicSuffixLength(labels: string[], rules: SuffixRules): number {
	// An exception rule prevails over every other match; its suffix is the
	// rule without its leftmost label.
	for (let i = 0; i < labels.length; i++) {
		if (rules.exception.has(labels.slice(i).join('.'))) return labels.length - i - 1;
	}
	// Otherwise the longest match, exact or wildcard, so the first one found
	// walking from the left.
	for (let i = 0; i < labels.length; i++) {
		const candidate = labels.slice(i).join('.');
		if (rules.exact.has(candidate)) return labels.length - i;
		if (i + 1 < labels.length && rules.wildcard.has(labels.slice(i + 1).join('.'))) {
			return labels.length - i;
		}
	}
	// The default rule, `*`: an unlisted top-level label is a suffix.
	return 1;
}

function isIpAddress(host: string): boolean {
	return host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host);
}

/** One rule in ASCII, label by label, through the URL parser's own IDNA. */
function toAscii(rule: string): string {
	// eslint-disable-next-line no-control-regex
	if (/^[\x00-\x7f]*$/.test(rule)) return rule;
	return new URL(`http://${rule}/`).hostname;
}
