import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cleanStamped, isDeviceId, syncDevice } from '$lib/server/devices';
import { adoptLegacy } from '$lib/server/anime/choices';
import { deviceLabel, type DeviceKind } from '$lib/settings/catalog';

/**
 * A browser checking in (doc/SETTINGS.md, "Devices"; card c171): its stamped
 * settings in, what's newer here back. What it kept of the player's choices
 * before c171 comes along once, and the workstation takes it.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as {
		id?: unknown;
		kind?: unknown;
		settings?: unknown;
		legacy?: unknown;
	} | null;
	const kind = body?.kind as DeviceKind;
	if (!body || !isDeviceId(body.id) || !['phone', 'tablet', 'desktop'].includes(kind))
		error(400, 'not a device');
	if (body.legacy && typeof body.legacy === 'object')
		adoptLegacy(body.legacy as Record<string, unknown>);
	const { newer } = syncDevice({
		id: body.id,
		kind,
		label: deviceLabel(request.headers.get('user-agent') ?? '', kind),
		settings: cleanStamped(body.settings)
	});
	return json({ newer });
};
