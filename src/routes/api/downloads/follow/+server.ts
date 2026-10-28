import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { followNew } from '$lib/server/downloads';

/**
 * FOLLOW's step, for the Suwayomi timer (scripts/suwayomi-import.ts): queue
 * what's new in every followed series. Behind the session like every route.
 */
export const POST: RequestHandler = async () => json(await followNew());
