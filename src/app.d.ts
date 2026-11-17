// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
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
