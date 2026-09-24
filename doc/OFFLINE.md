# Offline

The tablet keeps the chapters it is about to read, so reading goes on when the
workstation can't be reached: on the train, with the Wi-Fi down, or with the
workstation asleep. It's Mihon's download-ahead and delete-after-read, done in
the browser. All of it needs a secure context, so it arrived with HTTPS
([`SERVING.md`](SERVING.md)).

## What is kept

**While a chapter is open,** the reader keeps it and the next two available
chapters of the series (`keepFor` in `src/lib/cache/policy.ts`):

- a chapter already read is let go, and so is anything of the series that no
  longer belongs in that window: delete-after-read;
- chapters that aren't downloaded (`available = 0`) are skipped;
- the whole cache stays under **2 GB**, and the oldest-cached entries go first,
  never the ones being read now (`evict`).

A kept chapter keeps its OCR'd text too (`/api/entries/<id>/text`), fetched
again on every visit, so a Japanese chapter's lookups work offline
([`JAPANESE.md`](JAPANESE.md)).

**By hand,** the series screen's SELECT has **↓ CACHE** and **REMOVE CACHE**,
each showing how many of the selection it would change.

**Never cached:** a hidden series (hidden directly or by its root), anything
while reveal is on, and anything while incognito. The cache is something left
on the tablet, and those modes leave nothing behind.

## How an entry is cached

`src/lib/cache/device.ts` writes into the `tsundoku-entries` bucket:

- the manifest (`/api/entries/<id>/pages`);
- every page image;
- the reader's page and its data (`/read/<id>`, `/read/<id>/__data.json`);
- **last, a marker** at `/__cache/series/<series>/entries/<entry>`, carrying
  the size and manifest version.

The screens count markers, so an entry cut off half-way (offline mid-copy, the
page closed) is never counted as cached, and the next open finishes it. An
entry already cached at the same version is skipped.

The offline state (`src/lib/offline.svelte.ts`) reads the markers. From them
come the library's CACHED shelf and dimmed uncached tiles, CONTINUE's "N OF M
CACHED", the series screen's `↓` column and "↓ N CACHED" on FILE, and the
reader's "↓ CACHED" on the next chapter.

## Novels are kept whole

A novel's EPUB is the unit, not its chapters ([`TEXT-READER.md`](TEXT-READER.md)).
The reader downloads the whole book on first open, and `cacheBook` puts that
same download in `tsundoku-entries`, with the open entry's reader page and data
and a marker for every entry. The book's size goes on the first marker, so the
budget weighs it once. The service worker answers
`/api/series/<id>/epub?v=…` from the cache first, but never writes it: only
the reader does, and it doesn't while a series is hidden, during reveal or in
incognito.

## The service worker

`src/service-worker.ts` answers from three caches:

| Cache                    | What                                         | How                                                                                                |
| ------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `tsundoku-shell-<build>` | this build's scripts, styles, fonts, statics | cache first; old builds' shells deleted                                                            |
| `tsundoku-entries`       | cached chapters                              | page images **cache first**; manifests and the reader's page network first, the cache when offline |
| `tsundoku-screens`       | the last copy of each screen and its data    | network first; used only when the network fails                                                    |

Offline, a screen never seen falls back to the library's last copy. Writes
(POSTs) always go to the network. The reader reads `?p` from the URL itself,
because a cached reader page was rendered for whatever page it was cached at.

**Nothing rendered while reveal is on is kept.** The server marks those
responses `cache-control: no-store` (`src/hooks.server.ts`), and the service
worker never stores a `no-store` response. So the offline library can't show a
hidden title, even when reveal was on the last time the library loaded.

## Reading offline doesn't lose stats

A progress event that can't reach the workstation is kept in this browser's
`localStorage` (`tsundoku.pending`, up to 2000 events), with the time it
happened. It's sent when the workstation answers again: after the reader's next
successful event, or when the browser comes back online. `/api/reading` logs it
at its own time (clamped to the last 30 days, never in the future), so history
puts it on the day it was read. Replayed events **never move progress
backwards**: position and last-opened only advance in time, so an old event
arriving late can't undo something read since.

## Tests

- `tests/cache-policy.spec.ts`: the policy.
- `tests/series-db.spec.ts`: the forward-only replay rule.
- `tests/offline-flow.e2e.ts`: the production service worker end to end. It
  caches ahead, reads the next chapter with the network cut, queues the
  events, replays them when back online, and checks ↓ CACHE / REMOVE CACHE
  and the `no-store` rule.

## Not yet

- **Installing the PWA** (a web manifest and icons) is its own small step.
- **Offline history, series and library screens** show the last copy seen.
  Changes made offline (a rating, FAV) need the network: writes aren't queued,
  only reading progress.
- **Hidden series can't be read offline,** by design.
