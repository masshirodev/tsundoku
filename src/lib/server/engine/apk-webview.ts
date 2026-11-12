import { readMember, withZip } from '../zip.ts';

/**
 * Whether an extension's code uses a WebView, read from its APK the way the
 * engine reads it (tsundoku-engine's `WebViewSupport.usesWebView`): a dex file
 * keeps every type it refers to as a descriptor string, minified or not, so
 * `Landroid/webkit/WebView;` appearing in any `classes*.dex` means the code
 * names the class. The engine says the same as `extensionInfo.usesWebView`;
 * this reads an APK installed before tsundoku asked (doc/BROWSE.md,
 * "Extensions that need a WebView").
 */

const DESCRIPTOR = Buffer.from('Landroid/webkit/WebView;', 'latin1');
const DEX = /^classes\d*\.dex$/;

/** Whether one dex file's bytes name android.webkit.WebView. */
export const dexNamesWebView = (dex: Uint8Array): boolean =>
	Buffer.from(dex.buffer, dex.byteOffset, dex.byteLength).includes(DESCRIPTOR);

/** Whether any dex file in the APK at [path] names android.webkit.WebView. */
export async function apkUsesWebView(path: string): Promise<boolean> {
	return withZip(path, async (fh, members) => {
		for (const m of members.filter((x) => DEX.test(x.name)))
			if (dexNamesWebView(await readMember(fh, m))) return true;
		return false;
	});
}
