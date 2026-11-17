/**
 * The series being added right now, by their result's id (`sourceMangaId`,
 * the preview's key): a preview's ADD or ADD AND DOWNLOAD while its request
 * runs, and each series of a SELECT press while it is asked (doc/BROWSE.md,
 * "What can be ticked"). A source's page draws such a result
 * ADDING and does not let it be ticked, and a press skips one that another
 * request is adding, so a series is never added twice at once and UNDO never
 * takes out a series another press made.
 *
 * In this process's memory only: an add is one request, so a restart ends it
 * anyway, and nothing here outlives the add it marks.
 */
const adding = new Set<string>();

/** Whether a result is being added now. */
export const isAdding = (id: string) => adding.has(id);

/**
 * Runs an add while marking its result as being added. The mark is set
 * synchronously, before `add` first waits, so a caller that asked `isAdding`
 * and then calls this cannot be overtaken by another request in between.
 */
export async function whileAdding<T>(id: string, add: () => Promise<T>): Promise<T> {
	adding.add(id);
	try {
		return await add();
	} finally {
		adding.delete(id);
	}
}
