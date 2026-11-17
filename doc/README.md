# Documentation

One document per feature, screen or piece of the system. Start with
[`ARCHITECTURE.md`](ARCHITECTURE.md), the map of the whole.

## Using

- [`INSTALL.md`](INSTALL.md): installing tsundoku to a phone's or tablet's home screen as a fullscreen app.
- [`SIGN-IN.md`](SIGN-IN.md): the one shared secret every browser signs in with, and the two kinds of install.
- [`ONBOARDING.md`](ONBOARDING.md): what an empty install shows, SET UP's steps and FIRST READ's walk-through.
- [`HELP.md`](HELP.md): the help topics and the "?" on the rows people ask about.
- [`SETTINGS.md`](SETTINGS.md): `/settings`, every setting on one page.
- [`NAVIGATION.md`](NAVIGATION.md): going back returns to the screen as it was left.
- [`I18N.md`](I18N.md): the app's words in English and Brazilian Portuguese, per device.

## Features

- [`LIBRARY.md`](LIBRARY.md): the screen tsundoku opens on: shelves, CONTINUE, the KIND band, hidden series.
- [`SERIES.md`](SERIES.md): one series and the list of what can be read or watched in it.
- [`KINDS.md`](KINDS.md): the seven kinds of series and the registry that states what each can do.
- [`FILMS-SHOWS.md`](FILMS-SHOWS.md): films and TV shows, their sources, files and TMDB links.
- [`ANIME.md`](ANIME.md): anime from Aniyomi extensions, streamed, downloaded and watched.
- [`NOVELS.md`](NOVELS.md): light and web novels through LNReader's plugins.
- [`BOOKS.md`](BOOKS.md): gathering singletons into a series of books.
- [`EDITIONS.md`](EDITIONS.md): one book in several languages, with a language switch.
- [`WORKS.md`](WORKS.md): a Work groups series, so finishing one leads into the next.
- [`FILTERS.md`](FILTERS.md): the library's FILTER panel and the rules behind each row.
- [`RATINGS.md`](RATINGS.md): ratings out of 10, where 0 means unrated.
- [`COVERS.md`](COVERS.md): how each series gets its cover thumbnail.
- [`HIGHLIGHTS.md`](HIGHLIGHTS.md): kept passages, pages and clips: a copy and a pointer.
- [`HISTORY.md`](HISTORY.md): the dated log of what was read.
- [`READING-LOG.md`](READING-LOG.md): `reading_events`, the append-only record of reading.
- [`DUPLICATE-BOOKS.md`](DUPLICATE-BOOKS.md): the same book downloaded twice, found by its cover.
- [`DUPLICATE-CHAPTERS.md`](DUPLICATE-CHAPTERS.md): one chapter from several scanlators.
- [`DELETING.md`](DELETING.md): deleting a book, a series or a selection.
- [`PRIVACY.md`](PRIVACY.md): incognito, leaving the app, and the fingerprint gate on `/reveal`.
- [`BANDS.md`](BANDS.md): the strips under a screen's bar, and which of them can be dismissed.
- [`WAITING.md`](WAITING.md): what every screen shows between a tap and its result.
- [`MOTION.md`](MOTION.md): how tsundoku moves, and when it doesn't.
- [`TOUCH.md`](TOUCH.md): why a long press on an image opens no browser menu.

## Reading

- [`READER.md`](READER.md): the image reader for manga, manhwa and doujinshi.
- [`TEXT-READER.md`](TEXT-READER.md): the text reader for novels and EPUBs.
- [`READING-ONLINE.md`](READING-ONLINE.md): reading or watching straight from a source, without adding it.
- [`OFFLINE.md`](OFFLINE.md): chapters kept on the device to read without the server.
- [`JAPANESE.md`](JAPANESE.md): OCR, word lookup and flashcards for reading raw Japanese.
- [`LANGUAGES.md`](LANGUAGES.md): language packs, the word-splitting rules and dictionary behind lookup.

## Importing and sources

- [`IMPORT.md`](IMPORT.md): the importers, and which document covers each.
- [`IMPORT-BACKUP.md`](IMPORT-BACKUP.md): uploading a phone app's backup at `/import`.
- [`IMPORT-MIHON.md`](IMPORT-MIHON.md): reading a Mihon backup and its downloads.
- [`IMPORT-HENTOID.md`](IMPORT-HENTOID.md): reading a Hentoid folder into a hidden root.
- [`IMPORT-EPUB.md`](IMPORT-EPUB.md): reading EPUB files from the library folder.
- [`IMPORT-FORMATS.md`](IMPORT-FORMATS.md): the shapes of the files each importer reads.
- [`BROWSE.md`](BROWSE.md): finding a series in a source's lists, filters and search.
- [`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md): tsundoku-engine, which runs Mihon and Aniyomi extensions.
- [`DOWNLOADS.md`](DOWNLOADS.md): how manga, novels and video are downloaded and where the files go.
- [`MOVE.md`](MOVE.md): moving a series to another source and keeping everything attached to it.
- [`LINKS.md`](LINKS.md): linking a series to MyAnimeList and AniList.
- [`TRACKING.md`](TRACKING.md): moving AniList and MyAnimeList lists forward from what is read.
- [`RANOBE.md`](RANOBE.md): keeping a Ranobe catalogue up to date from what is read and watched.
- [`SYNC.md`](SYNC.md): what other devices download, reaching the server through Syncthing.

## Devices

- [`ANDROID.md`](ANDROID.md): the Android app for TVs, phones and tablets: pairing, servers, updates.
- [`TV.md`](TV.md): the ten-foot layout and the remote's keys.
- [`FOCUS.md`](FOCUS.md): D-pad focus, the mark, and how arrows move between things.
- [`WIFI.md`](WIFI.md): letting a phone on the same Wi-Fi in with a code.
- [`TRAY.md`](TRAY.md): the tray icon that runs tsundoku in the background.

## Running and releasing

- [`SERVING.md`](SERVING.md): how a served copy runs and who can reach it.
- [`DISTRIBUTION.md`](DISTRIBUTION.md): the native bundle, its data directory, and the licences.
- [`RELEASE.md`](RELEASE.md): how a release is built, what is in it, and how it is tested.
- [`UPDATES.md`](UPDATES.md): how an install learns of a new version and installs it.
- [`BACKUPS.md`](BACKUPS.md): backing up the database and the highlights' copies, and restoring them.
- [`LOGS.md`](LOGS.md): what an install writes down, and how a report reaches the developer.
- [`WEBSITE.md`](WEBSITE.md): the static page that presents tsundoku and its downloads.
- [`SECRETS.md`](SECRETS.md): where the live `.env` comes from.
- [`WINDOWS-VM.md`](WINDOWS-VM.md): the Windows machine releases are tested on.

## Developing

- [`ARCHITECTURE.md`](ARCHITECTURE.md): the map of the system and where each part is documented.
- [`design/README.md`](design/README.md): the Index design system: tokens, terms and components.
- [`TESTING.md`](TESTING.md): the two test runners and what to run before a commit.
- [`../scripts/probes/`](../scripts/probes/): scripts that drive the real novel plugins against live sources and print what they measure.
