import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	// The handoff is a mirror; the LNReader fixtures are written as plugins are, not as tsundoku is.
	{
		ignores: [
			'doc/design/handoff/**',
			'doc/handoffs/**',
			'tests/fixtures/lnreader/**',
			'android/tv/**/build/**'
		]
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
		files: [
			'src/lib/server/**/*.ts',
			'src/routes/**/*.ts',
			'src/hooks.server.ts',
			'scripts/**/*.ts'
		],
		ignores: ['src/lib/server/fspath.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: 'node:path',
							message:
								'Import path functions from src/lib/server/fspath.ts: it writes / on Windows too (doc/DISTRIBUTION.md, "Windows paths").'
						},
						{ name: 'path', message: 'Use src/lib/server/fspath.ts (c183).' }
					]
				}
			]
		}
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
