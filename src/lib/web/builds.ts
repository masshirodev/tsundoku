/**
 * Which build the web edition's service worker serves, and which builds' files
 * it keeps (doc/WEB-EDITION.md, "A new build"; c1138).
 *
 * The web edition has one server, in the leading tab, and it runs the build
 * that tab loaded. A deploy brings a new service worker, which takes over at
 * once (it must: a first visit cannot start until a worker controls it). Two
 * things then broke an open tab:
 *
 * - the new worker deleted the old build's files, and the old server loads
 *   its route chunks lazily: the next one it needed was gone from the cache
 *   and from the host;
 * - a tab opened afterwards ran the new client against the old leader's
 *   server, two builds talking to each other.
 *
 * So every build's files are kept while any open tab runs it, each tab says
 * which build it runs, and while the leader runs an older build the worker
 * serves that build to every tab: one build at a time. Moving to the new one
 * is every tab's together (`move`), the next time the reader goes somewhere.
 *
 * Pure state, one per service worker; `src/service-worker.ts` uses it.
 */

/** The cache holding one build's shell (its scripts, styles, server and engine). */
export const SHELL_PREFIX = 'tsundoku-shell-';
export const shellName = (build: string) => `${SHELL_PREFIX}${build}`;

export function builds(own: string) {
	/** The build each open tab said it runs, by its client id. */
	const ran = new Map<string, string>();
	/** The leading tab's build, once it said; its server is the one answering. */
	let leaderBuild: string | null = null;
	/** Every tab is moving to this worker's build: nobody is held to an older one. */
	let moving = false;

	return {
		/** A tab said which build it runs. */
		report(clientId: string, build: string) {
			ran.set(clientId, build);
		},

		/** A tab's server took the requests, running `build` (null: a tab too old to say). */
		leader(build: string | null) {
			// Mid-move, an older tab can still answer for a moment before its
			// reload: it holds nobody back.
			if (moving && build !== own) return;
			leaderBuild = build;
			if (build === own) moving = false;
		},

		/** Every tab goes to this worker's build now (a tab asked, about to go itself). */
		move() {
			moving = true;
			leaderBuild = null;
		},

		/**
		 * The build whose files a tab is given: the leader's while its server
		 * runs another, so a tab opened meanwhile talks to a server of its own
		 * build; otherwise this worker's.
		 */
		serving(): string {
			return !moving && leaderBuild ? leaderBuild : own;
		},

		/**
		 * The builds whose files must stay, given the tabs open now: theirs and
		 * this worker's. Null while any open tab has not said, since deleting
		 * its build could break it (a worker started again forgets what it was
		 * told, and asks).
		 */
		keep(openIds: readonly string[]): Set<string> | null {
			const keep = new Set([own]);
			for (const id of openIds) {
				const build = ran.get(id);
				if (!build) return null;
				keep.add(build);
			}
			// A closed tab's word is no longer needed.
			for (const id of [...ran.keys()]) if (!openIds.includes(id)) ran.delete(id);
			return keep;
		}
	};
}

export type Builds = ReturnType<typeof builds>;

/**
 * The shell caches to delete: every build's but those kept. Not the other
 * caches (kept chapters, episodes), which belong to no build.
 */
export const stale = (names: readonly string[], keep: Set<string>) =>
	names.filter((n) => n.startsWith(SHELL_PREFIX) && !keep.has(n.slice(SHELL_PREFIX.length)));
