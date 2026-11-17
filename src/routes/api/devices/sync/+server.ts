import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cleanStamped, isDeviceId, syncDevice } from '$lib/server/devices';
import { adoptLegacy } from '$lib/server/anime/choices';
import { DEVICE_KINDS, deviceLabel, isTvApp, type DeviceKind } from '$lib/settings/catalog';
import { linkPaired, pairedToken } from '$lib/server/pairing';

/**
 * A browser checking in (doc/SETTINGS.md, "Devices"): its stamped
 * settings in, what's newer here back. What an older browser kept of the
 * player's choices locally comes along once, and the computer takes it.
 */
export const POST: RequestHandler = async ({ request, cookies, locals, url }) => {
	const body = (await request.json().catch(() => null)) as {
		id?: unknown;
		kind?: unknown;
		settings?: unknown;
		legacy?: unknown;
		register?: unknown;
	} | null;
	const ua = request.headers.get('user-agent') ?? '';
	// The app's user agent is the one sure sign of a TV (doc/ANDROID.md): a page
	// can only say its screen, so the workstation decides the kind from the
	// header rather than trusting a page's guess.
	const kind = (isTvApp(ua) ? 'tv' : body?.kind) as DeviceKind;
	if (!body || !isDeviceId(body.id) || !DEVICE_KINDS.includes(kind)) error(400, 'not a device');
	if (body.legacy && typeof body.legacy === 'object')
		adoptLegacy(body.legacy as Record<string, unknown>);
	const { newer } = syncDevice({
		id: body.id,
		kind,
		// The row's words, from the same header: "Android TV · Chrome" for the app.
		label: deviceLabel(ua, kind),
		settings: cleanStamped(body.settings),
		// A phone paired over Wi-Fi is a device from its first visit, so the
		// computer's DEVICES lists it with SIGN OUT (doc/WIFI.md).
		register: body.register === true || locals.paired !== null
	});
	const token = pairedToken(url, (n) => cookies.get(n));
	if (locals.paired && token) linkPaired(token, body.id);
	return json({ newer });
};
