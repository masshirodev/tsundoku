# AGENTS.md

tsundoku is a personal reading library served from the workstation over
Tailscale. Read `README.md` and `doc/ARCHITECTURE.md` before changing anything.

- **Never commit anything from `/mnt/hdd2/tsundoku/samples`.** It is real,
  copyrighted, partly explicit data. Fixtures are synthesised from the shapes in
  `doc/IMPORT-FORMATS.md`.
- Library files live on `/mnt/hdd2`, never under `/`.
- Exposure rules are kirisute's: tailnet bind only, cookie auth, `ORIGIN`
  derived from the bound address.
- Screens are built from a design handoff. Briefs live in `doc/briefs/`.
- Rating is an integer 0–5 with `NULL` meaning unrated; never collapse the two.
- Push to `main`.
