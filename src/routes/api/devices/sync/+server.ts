import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cleanStamped, isDeviceId, syncDevice } from '$lib/server/devices';
import { adoptLegacy } from '$lib/server/anime/choices';
import { deviceLabel, isTvApp, type DeviceKind } from '$lib/settings/catalog';
import { PAIRED_COOKIE, linkPaired } from '$lib/server/pairing';

/**
 * A browser checking in (doc/SETTINGS.md, "Devices"; card c171): its stamped
 * settings in, what's newer here back. What it kept of the player's choices
 * before c171 comes along once, and the workstation takes it.
 */
export const POST: RequestHandler = async ({ request, cookies, locals }) => {
	const body = (await request.json().catch(() => null)) as {
		id?: unknown;
		kind?: unknown;
		settings?: unknown;
		legacy?: unknown;
		register?: unknown;
	} | null;
	const kind = body?.kind as DeviceKind;
	const ua = request.headers.get('user-agent') ?? '';
	if (!body || !isDeviceId(body.id) || !['phone', 'tablet', 'desktop'].includes(kind))
		error(400, 'not a device');
	if (body.legacy && typeof body.legacy === 'object')
		adoptLegacy(body.legacy as Record<string, unknown>);
	const { newer } = syncDevice({
		id: body.id,
		kind,
		// The TV app syncs as a desktop (DeviceKind has no TV yet), but its row
		// should still say TV: the label is what DEVICES shows (doc/TV-APP.md).
		label: deviceLabel(ua, isTvApp(ua) ? 'tv' : kind),
		settings: cleanStamped(body.settings),
		// A phone paired over Wi-Fi is a device from its first visit, so the
		// computer's DEVICES lists it with SIGN OUT (doc/WIFI.md).
		register: body.register === true || locals.paired !== null
	});
	const token = cookies.get(PAIRED_COOKIE);
	if (locals.paired && token) linkPaired(token, body.id);
	return json({ newer });
};
