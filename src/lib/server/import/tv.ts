import { isTvApp } from '../../settings/catalog.ts';

/**
 * The TV never imports (doc/IMPORT-BACKUP.md, "Where it is reached from"): SETTINGS' row has
 * no button there, and the server refuses too, so a TV that reaches the pages
 * by an address typed or kept is told so and nothing is written. The TV is
 * told apart by its app's user agent (`TsundokuTV/<version>`, `isTvApp`),
 * which pairing and device sync already read; the phone app
 * (`TsundokuApp/<version>`, doc/ANDROID.md) may import, and so may any
 * browser. A TV's browser without the app sends no such signal and is not
 * refused: the server has nothing else to tell it by.
 */
export const TV_REFUSED = 'THE TV NEVER IMPORTS';
export const TV_REFUSAL = `${TV_REFUSED} · CHOOSE THE FILE ON THE COMPUTER OR A PHONE · NOTHING CHANGED`;

/** Whether this request comes from the TV app. */
export const fromTv = (request: Request) => isTvApp(request.headers.get('user-agent') ?? '');
