import { afterEach, describe, expect, it } from 'vitest';
import { overwriteGetLocale } from '$lib/paraglide/runtime';
import { markedWords, putBackWords } from '../src/routes/series/[id]/through-words';

// MARK READ THROUGH's two bands (src/routes/series/[id]/through-words.ts): an
// episode row's long press reaches them as a chapter row's does, so an anime
// says EPISODES and WATCHED, in both languages.
afterEach(() => overwriteGetLocale(() => 'en'));

describe('MARKED READ THROUGH', () => {
	it('counts chapters and says READ on a manga, and a novel', () => {
		for (const kind of ['manga', 'novel'] as const)
			expect(markedWords(kind, 3, 'Ch. 5')).toEqual({
				title: 'MARKED READ THROUGH CH. 5',
				detail: '3 CHAPTERS'
			});
		expect(markedWords('manga', 1, 'Ch. 1').detail).toBe('1 CHAPTER');
	});

	it('counts episodes and says WATCHED on an anime', () => {
		expect(markedWords('anime', 3, 'Ep. 5')).toEqual({
			title: 'MARKED WATCHED THROUGH EP. 5',
			detail: '3 EPISODES'
		});
		expect(markedWords('anime', 1, 'Ep. 1').detail).toBe('1 EPISODE');
	});

	it('with nothing to mark, says so and counts nothing', () => {
		expect(markedWords('manga', 0, 'Ch. 5')).toEqual({
			title: 'NOTHING TO MARK · ALL READ THROUGH CH. 5',
			detail: undefined
		});
		expect(markedWords('anime', 0, 'Ep. 5').title).toBe(
			'NOTHING TO MARK · ALL WATCHED THROUGH EP. 5'
		);
	});

	it('is Portuguese in Portuguese, with the number as the language writes it', () => {
		overwriteGetLocale(() => 'pt-BR');
		expect(markedWords('anime', 1200, 'Ep. 5')).toEqual({
			title: 'MARCADO COMO ASSISTIDO ATÉ EP. 5',
			detail: '1.200 EPISÓDIOS'
		});
		expect(markedWords('manga', 1, 'Cap. 2')).toEqual({
			title: 'MARCADO COMO LIDO ATÉ CAP. 2',
			detail: '1 CAPÍTULO'
		});
		expect(markedWords('anime', 0, 'Ep. 5').title).toBe('NADA A MARCAR · TUDO ASSISTIDO ATÉ EP. 5');
	});
});

describe("UNDO's band, with some read or marked since", () => {
	it('puts chapters back, and leaves the rest as they are', () => {
		expect(putBackWords('manga', 4, 1)).toEqual({
			title: 'PUT BACK 4 CHAPTERS',
			detail: '1 READ OR MARKED SINCE · LEFT AS IT IS'
		});
		expect(putBackWords('manga', 1, 2)).toEqual({
			title: 'PUT BACK 1 CHAPTER',
			detail: '2 READ OR MARKED SINCE · LEFT AS THEY ARE'
		});
	});

	it('puts episodes back on an anime, watched or marked since', () => {
		expect(putBackWords('anime', 4, 2)).toEqual({
			title: 'PUT BACK 4 EPISODES',
			detail: '2 WATCHED OR MARKED SINCE · LEFT AS THEY ARE'
		});
	});

	it('is Portuguese in Portuguese', () => {
		overwriteGetLocale(() => 'pt-BR');
		expect(putBackWords('anime', 4, 1)).toEqual({
			title: 'DESFEITO EM 4 EPISÓDIOS',
			detail: '1 ASSISTIDO OU MARCADO DEPOIS · FICA COMO ESTÁ'
		});
		expect(putBackWords('manga', 1, 3)).toEqual({
			title: 'DESFEITO EM 1 CAPÍTULO',
			detail: '3 LIDOS OU MARCADOS DEPOIS · FICAM COMO ESTÃO'
		});
	});
});
