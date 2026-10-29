# AGENTS.md

tsundoku is a personal reading library served from the workstation over
Tailscale. Read `README.md` and `doc/ARCHITECTURE.md` before changing anything.

- **Never commit anything from `/mnt/hdd2/tsundoku/samples`.** It is real,
  copyrighted, partly explicit data. Fixtures are synthesised from the shapes in
  `doc/IMPORT-FORMATS.md`.
- Library files live on `/mnt/hdd2`, never under `/`.
- Exposure rules are kirisute's: tailnet bind only, cookie auth, `ORIGIN`
  derived from the bound address.
- Screens are built from a design handoff. Briefs live in `doc/briefs/`; the
  design system is `doc/design/` (read its README before touching a component),
  and `doc/design/handoff/` is a verbatim mirror: never edit it. The system as
  shipped is published at `https://claude.ai/artifact/HFPS3mJVpRM9WjuzvYy92T`;
  a new brief points the designer there (`doc/design/README.md`).
- Colours come from tokens in `src/lib/styles/`, never literals. `--reveal`
  (magenta) is reserved for reveal mode: the banner, the frame, HIDDEN badges.
- Device layout is CSS media queries, not script, so the first paint is right.
- Hidden means hidden: filter in SQL (`src/lib/server/library.ts`), never in the
  page.
- Before committing: `yarn run check && yarn run lint && yarn run test`, plus
  `yarn run test:e2e` when the UI changed. See `doc/TESTING.md`.
- Rating is an integer 0–5 and **0 means unrated**. Never write `NULL`.
- Push to `main`.
