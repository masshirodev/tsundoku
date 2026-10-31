#!/usr/bin/env node
// Compiles messages/*.json into src/lib/paraglide (doc/I18N.md). The vite
// plugin does the same on dev, build and the unit suite; svelte-check runs
// without vite, so `check` runs this first.
import { compile } from '@inlang/paraglide-js';
import { paraglide } from '../paraglide.config.js';

await compile(paraglide);
