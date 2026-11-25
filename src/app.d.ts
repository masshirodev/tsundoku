// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	/** True only in the web edition's build (vite.config.ts, doc/WEB-EDITION.md). */
	const __WEB_EDITION__: boolean;
	namespace App {
		interface Locals {
			authed: boolean;
			/** Which listener it came in by: `lan` only over Wi-Fi (doc/WIFI.md). */
			via: 'local' | 'lan';
			/** The phone paired over Wi-Fi this request is from, if it is one. */
			paired: import('$lib/server/pairing').Paired | null;
		}
	}
}

export {};
