import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** The phone, just paired (doc/WIFI.md, 3A): only over Wi-Fi, only signed in. */
export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.via !== 'lan' || !locals.paired) redirect(303, '/');
	return { address: url.host };
};
