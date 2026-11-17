import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

/** node:path writes \ on Windows (c183): server code imports fspath.ts instead. */
const fsPaths = [
	{
		name: 'node:path',
		message:
			'Import path functions from src/lib/server/fspath.ts: it writes / on Windows too (doc/DISTRIBUTION.md, "Windows paths").'
	},
	{ name: 'path', message: 'Use src/lib/server/fspath.ts (c183).' }
];

/**
 * The scripts (`yarn run import`, `links`, the timers) load src/lib/server,
 * src/lib/library and src/lib/import under Node's type stripping, which knows
 * no `$lib` and resolves no extensionless specifier (doc/I18N.md, "Imports";
 * tests/strip-types-db.spec.ts). Any module there can join a script's closure
 * through one new import (c389 pulled in works.ts, c471), so the whole tree
 * imports relatively, with the extension.
 */
const closure = [
	{
		group: ['$lib', '$lib/**'],
		message:
			'Import relatively with the extension (../library/kinds.ts): the scripts run this under Node type stripping, which knows no $lib (doc/I18N.md, c471).'
	},
	{
		regex: String.raw`^\.{1,2}(/(?!.*\.(ts|js|json|cjs|mjs)$).*)?$`,
		message:
			'Give a relative import its extension (./db.ts): Node type stripping resolves none (doc/I18N.md, c471).'
	}
];

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	// The LNReader fixtures are written as plugins are, not as tsundoku is.
	{
		ignores: ['tests/fixtures/lnreader/**', 'android/**/build/**']
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: { 'no-undef': 'off' }
	},
	{
		// CommonJS on purpose: the LNReader plugin host is started as a file, never bundled.
		files: ['**/*.cjs'],
		rules: { '@typescript-eslint/no-require-imports': 'off' }
	},
	{
		// Server paths are written with / on every platform (c183): node:path writes
		// backslashes on Windows, and the library's comparisons then fail quietly.
		files: ['src/routes/**/*.ts', 'src/hooks.server.ts', 'scripts/**/*.ts'],
		rules: { 'no-restricted-imports': ['error', { paths: fsPaths }] }
	},
	{
		// The same rule, and the scripts' closure (below): one block, since a later
		// block's options for a rule replace an earlier one's.
		files: ['src/lib/server/**/*.ts'],
		ignores: ['src/lib/server/fspath.ts'],
		rules: { 'no-restricted-imports': ['error', { paths: fsPaths, patterns: closure }] }
	},
	{
		files: ['src/lib/library/**/*.ts', 'src/lib/import/**/*.ts', 'src/lib/server/fspath.ts'],
		rules: { 'no-restricted-imports': ['error', { patterns: closure }] }
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	}
);
