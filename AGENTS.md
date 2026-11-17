# AGENTS.md

tsundoku is a self-hosted reading library: one household's manga, novels and
video, served from one computer to its devices. Read `README.md` and
`doc/ARCHITECTURE.md` before changing anything. **Open `AGENTS.local.md` too
when it exists**: it is gitignored and says what is true of this checkout on
this machine (where the library and samples live, how the live copy runs).

- **Never commit real library data** (pages, covers, backups, or a real
  series' or gallery's title and id). It is copyrighted and partly explicit.
  Fixtures are synthesised from the shapes in `doc/IMPORT-FORMATS.md`, with
  invented titles.
- Exposure: bind to the tailnet or the configured address only, cookie auth,
  `ORIGIN` derived from the bound address (`doc/SERVING.md`).
- Screens are built from a design handoff. Briefs live in `doc/briefs/`; the
  design system is `doc/design/` (read its README before touching a component),
  and `doc/design/handoff/` is a verbatim mirror: never edit it.
- Colours come from tokens in `src/lib/styles/`, never literals. `--reveal`
  (magenta) is reserved for reveal mode: the banner, the frame, HIDDEN badges.
- Device layout is CSS media queries, not script, so the first paint is right.
- Motion follows `doc/MOTION.md`: its tokens only, every tap drawn by the press
  layer (`src/lib/press.ts`), and a new overlay gets both halves, an entrance
  class (`.appear`, `.rise`, `.pop`) and `out:leave`. Page turns never animate for
  style: a paged turn follows the finger and slides (doc/MOTION.md, "Page
  turns").
- Hidden means hidden: filter in SQL (`src/lib/server/library.ts`), never in the
  page.
- **A served copy runs a released bundle, not a checkout** (`doc/SERVING.md`):
  a change reaches it only in a release (`doc/RELEASE.md`).
- Before committing: `yarn run check && yarn run lint && yarn run test --changed
origin/main`, plus
  the e2e files of what you changed when the UI changed (`yarn run test:e2e
tests/<file>.e2e.ts`). Nothing runs the whole e2e suite on its own any more, so
  run it by hand when a change worries you. See `doc/TESTING.md`.
- Rating is an integer 0–10 and **0 means unrated** (`doc/RATINGS.md`). Never write `NULL`.
- **A kind's facts live in `src/lib/library/kinds.ts`** (`doc/KINDS.md`): ask
  `kindFacts(kind)` — `medium`, `unit`, `catalogue`, `matches` — never
  `kind === 'anime'`; `tests/kinds.spec.ts` counts the checks left.
- Comments say why, in the present tense. No ticket ids, dates or names of
  who asked: those belong in the commit message.
- Push to `main`.
