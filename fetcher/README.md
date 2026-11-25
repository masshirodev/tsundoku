# The fetcher

The browser extension that carries the web edition's network requests:
Manifest V3, one build for Chromium and Firefox. What it does, its protocol,
how to load it by hand and how it is tested are in `doc/WEB-EDITION.md`, "The
fetcher"; its browser test in `doc/TESTING.md`, "The fetcher extension".

```sh
yarn run build:fetcher         # the store build, build-fetcher/store/: https://tsundoku.lt only
yarn run build:fetcher --dev   # the development build, build-fetcher/development/: loopback too, never publish it
yarn run test:fetcher          # build both, lint for Firefox, test in Chromium and Firefox
yarn run fetcher:psl     # refresh the Public Suffix List, then commit it
```

This folder holds only the extension's glue (`background.ts`, `content.ts`),
its manifest and its build. Everything it decides lives in `src/lib/fetcher/`,
shared with the page's client in `src/lib/web/fetcher-client.ts`.
