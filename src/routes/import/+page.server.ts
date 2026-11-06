import type { PageServerLoad } from './$types';
import { CHUNK_BYTES, MAX_BACKUP_BYTES } from '$lib/server/import/backup';
import { fromTv, TV_REFUSAL } from '$lib/server/import/tv';

/**
 * IMPORT A BACKUP's pick screen (c438; Import-Pick, Import-Phone-Pick). On a
 * TV it is the TV's refusal instead (c511): the TV never imports.
 */
export const load: PageServerLoad = ({ request }) => ({
	chunk: CHUNK_BYTES,
	max: MAX_BACKUP_BYTES,
	tv: fromTv(request) ? TV_REFUSAL : null
});
