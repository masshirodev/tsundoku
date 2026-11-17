/**
 * An episode's picture, where the source gives none (doc/ANIME.md, "Episode
 * pictures"): a frame of the episode, made on the workstation. The
 * decisions here are pure; src/lib/server/anime/pictures.ts takes the frames.
 */

/** The picture's size: the episode list draws it at 96×54, the player's UP NEXT at 72×40. */
export const PICTURE_W = 320;
export const PICTURE_H = 180;

/**
 * Where to take a frame, by attempt: a quarter in is past the opening and
 * before the ending; a frame that comes out blank (a fade, a black card) is
 * taken again further on. Without a length, fixed seconds that clear an
 * opening sequence.
 */
export function frameAt(durationS: number | null, attempt: number): number | null {
	const shares = [0.25, 0.4, 0.6];
	const seconds = [150, 300, 480];
	if (attempt < 0 || attempt >= shares.length) return null;
	if (durationS && durationS > 0) return Math.round(durationS * shares[attempt] * 10) / 10;
	return seconds[attempt];
}

/**
 * Whether a frame is too dark or too flat to show (a fade, a title card on
 * black): from its channels' means and standard deviations, 0–255.
 */
export function isBlankFrame(channels: { mean: number; stdev: number }[]): boolean {
	if (!channels.length) return true;
	const brightest = Math.max(...channels.map((c) => c.mean));
	const spread = channels.reduce((n, c) => n + c.stdev, 0) / channels.length;
	return brightest < 20 || spread < 8;
}
