import { EN_PACK_PATH } from './helpers/en-pack-path';
import { writeEnglishPack } from './helpers/en-pack';

/**
 * The e2e run's English pack (c198), written once per run before the preview
 * server starts: the suite never downloads 300 MB, and the preview is told
 * where this file is (`playwright.config.ts`).
 */
export default function setup(): void {
	writeEnglishPack(EN_PACK_PATH);
}
