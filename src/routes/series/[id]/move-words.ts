import { kindUnit, moveKindOf, type Kind, type MoveKind } from '$lib/library/kinds';
import { movesVideo } from '$lib/library/move';

/*
 * The words MOVE's screens print for a series' kind (doc/MOVE.md), asked of
 * the registry rather than spelled from a kind's name (Kinds K4, c304). Each
 * says what the comparison it replaced said, for every kind:
 * tests/move-domain.spec.ts asserts all five.
 */

/** The sources SEARCH asks on a hidden series' empty pane: `anime` or `manga`. */
export const searchedSources = (kind: Kind): MoveKind => moveKindOf(kind);

/** What the MOVED band counts: EPISODE on video, CHAPTER on everything else (a novel's too). */
export const movedUnit = (kind: Kind): string => kindUnit(moveKindOf(kind)).long;

/** The comparison head's kind: ANIME for a video move, else the series' own kind. */
export const comparedKind = (move: MoveKind, kind: Kind): string =>
	movesVideo(move) ? 'ANIME' : kind.toUpperCase();
