import { json } from '@sveltejs/kit';
import { goneFromDevice, idsOf } from '$lib/server/device-cache';
import type { RequestHandler } from './$types';

/**
 * Which of the series and entries a device's caches hold it should let go
 * (src/lib/cache/sweep.ts; doc/OFFLINE.md, "Hiding takes it off the device").
 * A POST because the list can be long; it changes nothing here.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as {
		series?: unknown;
		entries?: unknown;
	} | null;
	return json(goneFromDevice({ series: idsOf(body?.series), entries: idsOf(body?.entries) }));
};
