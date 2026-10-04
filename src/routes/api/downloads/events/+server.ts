import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { configured } from '$lib/server/suwayomi';
import { listen } from '$lib/server/suwayomi-watch';

/**
 * The queue's changes as server-sent events (doc/DOWNLOADING.md, "Live"):
 * the chapter downloading and a version. Hidden means hidden here too: what
 * a viewer is sent is computed from what reveal lets them see.
 */
export const GET: RequestHandler = ({ cookies, request }) => {
	if (!configured()) error(404, 'not found');
	const reveal = isRevealed(cookies);
	let stop = () => {};
	const stream = new ReadableStream<string>({
		start(controller) {
			stop = listen(reveal, (m) => controller.enqueue(`data: ${JSON.stringify(m)}\n\n`));
			request.signal.addEventListener('abort', () => {
				stop();
				try {
					controller.close();
				} catch {
					// Closed already.
				}
			});
		},
		cancel() {
			stop();
		}
	});
	return new Response(stream.pipeThrough(new TextEncoderStream()), {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-store',
			connection: 'keep-alive'
		}
	});
};
