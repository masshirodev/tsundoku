/**
 * Extension repositories' indexes, read into one shape (doc/DOWNLOADER.md,
 * "Extensions"). Pure: what was fetched goes in, listings come out.
 *
 * A repository is a folder: `repo.json` (its name and signing key, required,
 * since the key is what an APK is trusted by), and an index beside it. Mihon
 * reads the protobuf `index.pb`; Keiyoushi and Yuzono both publish the same
 * index as JSON (`index.json`), which is read here, and older repositories
 * only `index.min.json`, read as a fallback. Keiyoushi's `index.min.json` is
 * now a stub telling old apps to update: never trust a min index whose repo
 * has a v2 one.
 */

export type Kind = 'manga' | 'anime';

export type Listing = {
	pkg: string;
	name: string;
	kind: Kind;
	versionCode: number;
	versionName: string;
	/** The extension API it's built for: "1.6" (Mihon), "14" or "16" (Aniyomi). */
	lib: string;
	/** Marked NSFW or MIXED: listed only with reveal on (c126, decided 2026-10-28). */
	adult: boolean;
	apkUrl: string;
	jarUrl: string | null;
	iconUrl: string | null;
	sources: { id: string; name: string; lang: string; baseUrl: string }[];
};

export type RepoMeta = { name: string; fingerprint: string; website: string };

export class RepoError extends Error {}

/**
 * The folder a pasted address names: people paste a repo's `index.min.json`
 * (what Mihon asks for), its `repo.json`, or the folder itself.
 */
export function repoBase(address: string): string {
	let url: URL;
	try {
		url = new URL(address.trim());
	} catch {
		throw new RepoError('That isn’t an address');
	}
	if (url.protocol !== 'https:') throw new RepoError('A repository is served over https');
	url.search = '';
	url.hash = '';
	url.pathname = url.pathname.replace(
		/\/(?:index\.min\.json|index\.json|index\.pb|repo\.json)$/,
		'/'
	);
	if (!url.pathname.endsWith('/')) url.pathname += '/';
	return url.toString();
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const hex64 = (v: string) =>
	/^[0-9a-f]{64}$/i.test(v.replaceAll(':', '')) ? v.replaceAll(':', '').toLowerCase() : '';

export function parseRepoJson(json: unknown): RepoMeta {
	const meta = isRecord(json) && isRecord(json.meta) ? json.meta : null;
	const fingerprint = hex64(str(meta?.signingKeyFingerprint));
	if (!meta || !fingerprint)
		throw new RepoError('Not an extension repository (no repo.json with a signing key)');
	return { name: str(meta.name) || 'Unnamed repository', fingerprint, website: str(meta.website) };
}

const kindOf = (pkg: string): Kind | null =>
	pkg.includes('.animeextension.') ? 'anime' : pkg.includes('.extension.') ? 'manga' : null;

/** Keiyoushi's and Yuzono's index.json. */
export function parseIndexV2(json: unknown): { fingerprint: string; listings: Listing[] } {
	const list =
		isRecord(json) && isRecord(json.extensionList) ? json.extensionList.extensions : null;
	if (!Array.isArray(list)) throw new RepoError('Not an extension index');
	const listings: Listing[] = [];
	for (const e of list) {
		if (!isRecord(e) || !isRecord(e.resources)) continue;
		const pkg = str(e.packageName);
		const kind = kindOf(pkg);
		const apkUrl = str(e.resources.apkUrl);
		if (!kind || !apkUrl) continue;
		const warning = str(e.contentWarning);
		listings.push({
			pkg,
			name: str(e.name),
			kind,
			versionCode: Number(e.versionCode) || 0,
			versionName: str(e.versionName),
			lib: str(e.extensionLib),
			adult: warning === 'CONTENT_WARNING_NSFW' || warning === 'CONTENT_WARNING_MIXED',
			apkUrl,
			jarUrl: str(e.resources.jarUrl) || null,
			iconUrl: str(e.resources.iconUrl) || null,
			sources: (Array.isArray(e.sources) ? e.sources : []).filter(isRecord).map((s) => ({
				id: String(s.id ?? ''),
				name: str(s.name),
				lang: str(s.language),
				baseUrl: str(s.homeUrl)
			}))
		});
	}
	return { fingerprint: isRecord(json) ? hex64(str(json.signingKey)) : '', listings };
}

/** The older index.min.json: files beside it under apk/ and icon/. */
export function parseIndexLegacy(json: unknown, base: string): Listing[] {
	if (!Array.isArray(json)) throw new RepoError('Not an extension index');
	const listings: Listing[] = [];
	for (const e of json) {
		if (!isRecord(e)) continue;
		const pkg = str(e.pkg);
		const kind = kindOf(pkg);
		const apk = str(e.apk);
		if (!kind || !apk) continue;
		const version = str(e.version);
		listings.push({
			pkg,
			name: str(e.name).replace(/^(?:Tachiyomi|Aniyomi): /, ''),
			kind,
			versionCode: Number(e.code) || 0,
			versionName: version,
			lib: version.replace(/\.\d+$/, ''),
			adult: Number(e.nsfw) === 1,
			apkUrl: new URL(`apk/${apk}`, base).toString(),
			jarUrl: null,
			iconUrl: new URL(`icon/${pkg}.png`, base).toString(),
			sources: (Array.isArray(e.sources) ? e.sources : []).filter(isRecord).map((s) => ({
				id: String(s.id ?? ''),
				name: str(s.name),
				lang: str(s.lang),
				baseUrl: str(s.baseUrl)
			}))
		});
	}
	return listings;
}

/** A newer version than [installedCode]: what UPDATE offers. */
export const hasUpdate = (listing: Listing, installedCode: number) =>
	listing.versionCode > installedCode;
