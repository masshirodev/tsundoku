import type { PageServerLoad } from './$types';
import { CHUNK_BYTES, MAX_BACKUP_BYTES } from '$lib/server/import/backup';

/** IMPORT A BACKUP's pick screen (c438; Import-Pick, Import-Phone-Pick). */
export const load: PageServerLoad = () => ({ chunk: CHUNK_BYTES, max: MAX_BACKUP_BYTES });
