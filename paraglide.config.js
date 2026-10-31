// Paraglide's compiler options, once (doc/I18N.md): vite.config.ts and
// vitest.config.ts hand them to the plugin, `yarn run i18n` to the compiler.
//
// No `cookie` strategy: Paraglide's client writes its cookie on the first
// getLocale(), which would pin AUTO to whatever the browser said on day one.
// The server decides instead (`custom-choice`, the device's own choice, then
// Accept-Language), and the client reads what it decided off <html lang>
// (src/hooks.client.ts).
/** @type {import('@inlang/paraglide-js').CompilerOptions} */
export const paraglide = {
	project: './project.inlang',
	outdir: './src/lib/paraglide',
	emitTsDeclarations: true,
	strategy: ['custom-choice', 'preferredLanguage', 'baseLocale']
};
