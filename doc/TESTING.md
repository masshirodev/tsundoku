# Testing

Two runners with exactly complementary file globs, the same split Kumiko uses:

| Runner     | Files                | What it covers                                                                 |
| ---------- | -------------------- | ------------------------------------------------------------------------------ |
| Vitest     | `tests/**/*.spec.ts` | Pure domain (`$lib/library`) and the SQL (`$lib/server`), on in-memory SQLite. |
| Playwright | `tests/**/*.e2e.ts`  | The real app in a real browser, against a production build.                    |

A file collected by both would be run twice against different databases. Keep
the names apart.

## What to run

```sh
yarn run check && yarn run lint && yarn run test   # before every commit
yarn run test:e2e                                  # when the UI changed
```

Always spelled `yarn run`: Yarn 1's builtin `check` shadows the script and exits
0 having typechecked nothing.

The hooks are copied from Kumiko. `pre-commit` runs lint-staged. `pre-push` runs
the hook-arming check, `check`, `lint` and the unit suite. That last one is
affordable because this repository lives only on the workstation, never on the
throttled VPS. The e2e suite stays manual because it builds the app.

## Unit specs

Each spec file gets its own process (`pool: 'forks'`, `isolate: true`), and
`tests/vitest.setup.ts` fails loudly if two ever share one. That matters because
`getDb()` memoises the first `DATABASE_PATH` it sees. A spec that touches the
database sets `process.env.DATABASE_PATH = ':memory:'` **before** importing
anything from `$lib/server`, then seeds it with `seedSample()`.

**Importer specs never read real data.** The samples on `/mnt/hdd2` are the
owner's, copyrighted and partly explicit. `tests/helpers/` holds a protobuf
encoder and a zip writer, and `mihon-fixture.ts` uses them to synthesise a
`Mihon/` folder of the same shape in a temp directory: a backup with the
rating categories, and CBZs whose ComicInfo matches by URL, by number, or not at
all. `hentoid-fixture.ts` does the same for `H/.Hentoid/`: a finished book, one
read partway, a three-chapter book, and a folder with no JSON. `import-db.spec.ts` runs the real importer over it. The e2e server gets an
empty `LIBRARY_ROOT`, so START SCAN there can never import into the database the
suite asserts against.

## E2E specs

`playwright.config.ts` builds the app, seeds a fresh database under the system
temp directory (never the development one), and serves it with `vite preview`
under a throwaway `TSUNDOKU_TOKEN`. Every test starts signed in with the session
cookie that token derives, except `auth.e2e.ts`, which starts signed out on
purpose.

The projects are the devices the design draws: `tablet-portrait` (800×1280),
`tablet-landscape` (1280×800), `phone` (Pixel 7) and `desktop` (1440×900).

| Spec                    | Runs on         | Why                                                                                                                              |
| ----------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `auth.e2e.ts`           | all             | Read-only.                                                                                                                       |
| `library-layout.e2e.ts` | all             | The frame on each device, including with JavaScript switched off.                                                                |
| `library-frame.e2e.ts`  | tablet-portrait | **Generated.** Pins the tablet measurements the handoff was extracted at.                                                        |
| `library-flow.e2e.ts`   | tablet-portrait | Writes to the shared seeded database, so it runs serially, on one device, and each test restores what it changed.                |
| `series-layout.e2e.ts`  | all             | The series frame per device: header or 440px panel, row and rail sizes; doujin and novel shapes.                                 |
| `series-flow.e2e.ts`    | tablet-portrait | Writes, like `library-flow`: rating, FAV, direction, tags, range select, `#`, hide.                                              |
| `books-flow.e2e.ts`     | tablet-portrait | Writes: person pages and FAV, a book's own rating, TAKE OUT, grouping, suggestions.                                              |
| `history-flow.e2e.ts`   | tablet-portrait | Writes: REMOVE and UNDO on history rows.                                                                                         |
| `reader-layout.e2e.ts`  | all             | The reader's frame per device: the page on true black, the 64 / 56 / 64px controls. Reads in incognito, so it writes nothing.    |
| `reader-flow.e2e.ts`    | tablet-portrait | Writes: tap zones, the boundary, progress and resume, the READING sheet, vertical crossing, the end-of-series rating, incognito. |
| `privacy-flow.e2e.ts`   | tablet-portrait | Writes: `/incognito`, `/api/reading`, leaving and returning, and that a reload isn't leaving.                                    |

**Every e2e spec imports `test` from `tests/fixtures.ts`,** whose
`page.goto` also waits for the network to settle: SvelteKit hydrates after
`load`, and a click that lands before hydration opens nothing. That was the
suite's recurring flake. A client-side navigation into the reader doesn't
change the document, so no load state covers it; `readerReady(page)` waits
for the reader's own stylesheet instead (its ground turns true black).

**Read-only specs read series no flow file owns.** They run on the other
devices at the same time as the flows, against the same database: the phone's
layout spec once read Hoshi no Umi no Tabibito's rating in the moment
`library-flow` had it set to 5.

**Each flow file owns its series.** Flow files run serially inside themselves
but in parallel with each other, against the one seeded database. Two files
writing the same series will race. That happened once: both rated "Kusuriya no
Hitorigoto", and one saw the other's rating. So `library-flow` owns Kusuriya and
the three it multi-selects, `books-flow` owns every Kaori Mama title and the
Hakka Kousha / Aoi Rin people, `history-flow` owns Mushoku Tensei's history
rows, `privacy-flow` owns Yofukashi no Uta, `reader-flow` owns Hikaru ga Shinda Natsu,
The Greatest Estate Developer and Chainsaw Man, `reader-layout` reads Sousou no Frieren, and `series-flow` owns Mount Hua, Tower of God, Ame
no Hi and Lookism. Pick an unused series for a new flow, and say which in the
file's header.

### Regenerating the frame spec

`library-frame.e2e.ts` is written by the design tools. Don't hand-edit it,
because regenerating overwrites it. Hand-written layout assertions go in
`library-layout.e2e.ts`.

```sh
T=~/.config/myconf/design-tools
node $T/extract-spec.mjs "doc/design/handoff/Index Library.dc.html" --out temp/design/spec.json
node $T/gen-conformance.mjs temp/design/spec.json --init --screen 0 --out temp/design/map.json
# fill in "app" selectors: continueList .cont, continueRow .cont > .row:nth-child(1),
# grid .grid, tile .grid > .tile:nth-child(1); baseUrl http://localhost:4183
node $T/gen-conformance.mjs temp/design/spec.json --map temp/design/map.json --out tests/library-frame.e2e.ts
```
