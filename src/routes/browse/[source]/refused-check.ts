/**
 * Whether a novel source's trouble is a site's check that could not be passed
 * (`plugin-host.cjs`): the one trouble the source page's
 * TRY AGAIN forgets both memos for, and says so (`again=1`). Every other
 * sentence, a page this app could not look up the end of included, is asked
 * again as it stands.
 */
export const isRefusedCheck = (error: string): boolean =>
	error.includes('(its check could not be passed)');
