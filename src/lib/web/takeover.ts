/**
 * A write lost in a takeover (doc/WEB-EDITION.md, "One tab leads"): the tab
 * running the server closed while it held a request, and the tab that took
 * over never saw it. The relay answers it rather than leave it hanging, and
 * never sends it twice, since it may have been a write.
 *
 * A form action is answered as SvelteKit's own refusal, an ActionResult of
 * type `failure`, so `use:enhance` keeps the screen and puts the answer in
 * `page.form`, where the layout draws the system's refusal band with TRY
 * AGAIN (handoff `web-edition-start`, Takeover). Anything else gets a plain
 * 503, as before.
 *
 * The relay (service worker) and the layout (page) both use this file.
 */

/** What `page.form` holds after a lost action: `action` is its name, `newShelf`. */
export type Lost = { lost: 'takeover'; action: string };

/** The text a lost request that is not a form action is answered with. */
export const LOST_TEXT = 'the tab that ran the server closed; try again';

/** A form action, as `use:enhance` sends one: a POST that asks for an ActionResult. */
export function isAction(request: Request): boolean {
	return request.method === 'POST' && request.headers.get('x-sveltekit-action') === 'true';
}

/** The action's name from its URL, `?/newShelf`: empty for a page's default action. */
export function actionName(url: string): string {
	const search = new URL(url).search;
	return search.startsWith('?/') ? decodeURIComponent(search.slice(2).split('&')[0]) : '';
}

/**
 * The answer to a request a takeover lost. The failure's `data` is in
 * devalue's form, which SvelteKit's `deserialize` reads: a flat object is an
 * array whose first entry maps each key to the index of its value.
 */
export function lostAnswer(request: Request): Response {
	if (!isAction(request))
		return new Response(LOST_TEXT, {
			status: 503,
			headers: { 'content-type': 'text/plain; charset=utf-8' }
		});
	const data: Lost = { lost: 'takeover', action: actionName(request.url) };
	const result = {
		type: 'failure',
		status: 503,
		data: JSON.stringify([{ lost: 1, action: 2 }, data.lost, data.action])
	};
	return new Response(JSON.stringify(result), {
		status: 503,
		headers: { 'content-type': 'application/json' }
	});
}

/** The lost action in `page.form`, or null when the answer is anything else. */
export function takenOver(form: unknown): Lost | null {
	const f = form as Partial<Lost> | null | undefined;
	return f && f.lost === 'takeover' && typeof f.action === 'string'
		? { lost: 'takeover', action: f.action }
		: null;
}

/** An action's name as the band says it: `newShelf` → `NEW SHELF`. */
export function actionWords(action: string): string {
	return action
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[-_]+/g, ' ')
		.trim()
		.toUpperCase();
}
