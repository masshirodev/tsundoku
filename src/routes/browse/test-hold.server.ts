/**
 * The browse world's hold on one form post (card c636; tests/browse-setup.ts).
 *
 * A case must be able to leave a write in flight **on the server** past its own
 * end, so that `browse-extensions.e2e.ts`' afterEach -- which waits for the
 * page's unanswered writes before it puts anything back (c569) -- can be
 * falsified. Playwright can hold a request only in the browser, and a held
 * request dies with the page, so the hold has to be here, on the server.
 *
 * The door exists only when the browse world's preview is started with
 * `TSUNDOKU_TEST_HOLD=1`; nothing but tests/browse-setup.ts does that, so a
 * build the owner runs never reads the header. A request asks for it with
 * `x-tsundoku-hold: <action>:<ms>`, and only the action it names is held.
 *
 * The hold delays the write, not the answer: a held post's row lands after the
 * wait, which is exactly the state a put-back that did not wait races.
 */

/** The longest a forgotten hold can last: a case holds 3 s, and no door may hang a later file. */
export const HOLD_MAX_MS = 5000;

/** Whether the browse world turned the door on. Read per call, so a spec's own server can set it. */
const enabled = () => process.env.TSUNDOKU_TEST_HOLD === '1';

/** Hold [action]'s write for the milliseconds the request asks, if it asks for this one. */
export async function holdPost(action: string, request: Request): Promise<void> {
	if (!enabled()) return;
	const [what, ms] = (request.headers.get('x-tsundoku-hold') ?? '').split(':');
	if (what !== action) return;
	const wait = Math.min(Math.max(Math.trunc(Number(ms)) || 0, 0), HOLD_MAX_MS);
	if (wait > 0) await new Promise((done) => setTimeout(done, wait));
}
