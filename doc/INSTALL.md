# Installing on the tablet

tsundoku is a PWA: installed to the home screen, it opens **fullscreen**, with
no browser bar and no status bar. The page is the interface there too.

## Once, on the tablet

1. Open **https://workstation.example.ts.net:8443** in Chrome. Tailscale has
   to be on, and the workstation serving (`yarn run serve`, see
   [`SERVING.md`](SERVING.md)).
2. Sign in with `TSUNDOKU_TOKEN` from the workstation's `.env`. The session
   cookie lasts, so this is once per device.
3. Chrome's menu → **Install app** (or the install prompt, if it offers one).
4. In the installed app, type **`/lock`** in search to put `/reveal` behind this
   tablet's fingerprint ([`PRIVACY.md`](PRIVACY.md)).

The home-screen shortcuts (long-press the icon) open **History** and **Search**.

## What makes it installable

- `static/manifest.webmanifest`: name, `fullscreen` (falling back to
  `standalone`), `start_url` and `scope` `/`, graphite theme and background, the
  icons and the two shortcuts.
- The service worker ([`OFFLINE.md`](OFFLINE.md)), which also makes the
  installed app open without the workstation.
- HTTPS, which Chrome requires for both.

The manifest and icons are static files, served before authentication, so the
browser can fetch them the way it does: without the session cookie.
`tests/install.e2e.ts` asks Chromium itself (`Page.getInstallabilityErrors`)
and expects no errors.

## The icon

The design has no logo and says not to draw one. Every icon in the system is a
set glyph. So the app icon is typeset too: **積**, the first character of
積ん読, in IBM Plex Sans JP 500, ink (`#e8e8e6`) on graphite (`#0e0f10`).
`scripts/icons.mjs` renders it with Chromium from the same font files the app
ships, and refuses to render if the font didn't load, so a fallback glyph can
never slip in:

- `icon-192.png` and `icon-512.png`: purpose `any`;
- `maskable-512.png`: the glyph inside the central 80% that launchers may crop;
- `apple-touch-icon.png` and `favicon-32.png`.

The PNGs are committed, so a build never depends on the script.
`node scripts/icons.mjs` re-renders them.
