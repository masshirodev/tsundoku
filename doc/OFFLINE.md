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
The reader downloads the whole book in the background on first open (it reads the first chapter file by file meanwhile, doc/TEXT-READER.md, "Opening"), and `cacheBook` puts that
same download in `tsundoku-entries`, with the open entry's reader page and data
and a marker for every entry. The book's size goes on the first marker, so the
budget weighs it once. The service worker answers
`/api/series/<id>/epub?v=…` from the cache first, but never writes it: only
the reader does, and it doesn't while a series is hidden, during reveal or in
incognito.

## Anime's episodes are a bucket of their own

A downloaded episode is kept in `tsundoku-episodes`, with its own **3 GB**
beside the chapters' 2 GB, so anime never pushes chapters out
([`ANIME.md`](ANIME.md), "Offline"). While an episode plays, the next one
downloaded on the workstation is kept, and this series' watched ones are let
go; ↓ CACHE in SELECT keeps more. The file streams into the cache, never into
memory, and the service worker slices it for the player's Range requests.
Never for a hidden series, while reveal is on, or incognito.

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

## Writes that wait

Reading progress waits in `localStorage` (above). **A highlight kept offline is
the first other write that waits, and `src/lib/cache/pending-highlights.ts` is
the mechanism for any like it** (c842): an item names its own address and body,
so a page (H3) and a quote (H2) go through it; a rating or FAV could later, and
doesn't yet. It is in IndexedDB, so it outlives the app being closed,
and it's sent by the layout (`+layout.svelte`, on opening and whenever the
device's connection comes back), so it doesn't need a reader open, where
`flushPending` does.

A quote's item holds the book's words, so a hidden series' reader and reveal never
queue one, and a refused one is stripped to its key and label. Each reader tells
only its own: a quote refused is the text reader's to say, a page's the image
reader's, by the `quote:` key prefix.

**Offline here is what the top of this page says: the workstation can't be
reached.** The device may still report that it's online (the workstation
asleep, the tunnel down), so a press also waits when its POST comes back with
no answer at all, not only when the device says offline. An answer of any
status is the workstation speaking, and keeps its own band.

**When it tries again**, with no press: when the app opens, when the device
says the connection is back, every 15 seconds while anything waits, and on
coming back to the app. The timer and the return-to-app listener exist only
while something waits, and end with the queue; a device that says it's offline
is asked nothing. A connection that returns during a pass gets one more pass
after it. A source that failed (a 502) waits five minutes between tries, so its
three tries aren't spent in the first minute by the connection's timer.

**What isn't queued, ever:** a press in a hidden series or with reveal on (the
"Never cached" rule above) keeps its old band and writes nothing, and incognito
keeps nothing. No item holds a series' title, only the entry's id, the page and
its label, because a 404 can't say whether a series is gone or hidden since.

It sends once by two things together: one row per key on the device (two
presses are one) and the workstation answering the same thing asked again with
the one it already made (a resend after a reload, a tab that died between the
POST and the removal, the same page kept on two devices). So a new user of the
queue needs a door that answers a repeat with what it already made.

An item can change while it waits (`reviseHighlight`, which names the fields it
changed in `revised`) and while its POST is out. So the sender reads the row again
just before the POST, and again after: what was revised during it, and a colour
chosen for a row that turned out to exist already, goes to the row the answer
named by PATCH, beside the door (`/api/highlights/<id>`). An item taken back during
its POST has what that POST **made** set aside by DELETE, and only that: an answer
of a row already there leaves the row. Taken back because a later press covers it
(a selection joining a waiting quote), and only once that press is kept, written
on the device or answered by the workstation, the item is **superseded** instead
(a press kept nowhere leaves it waiting): the
workstation folds what that POST made into the covering row and keeps its id, so
no DELETE is sent. That record is the tab's own (`supersedeHighlight`) and
only the page running `landed` reads it: a reload ends that page, so no DELETE is
sent and the row is left for the join to fold; a second tab sending the queue
cannot see it, and there the DELETE goes. A join that itself waits carries the
quotes it covered on its own item (`covers`), so a refusal of that join puts them
back with their notes; `takeBackHighlight` hands the removed item back, so UNDO
restores all of that rather than a body rebuilt from the page. Each item
is told the moment it lands.

What each answer does (`arrival`): 2xx sent; a dropped connection, a 401, a 403
(incognito on at the moment, which says nothing of the item) and a 5xx stop the
pass and everything waits for the next one; a 502 waits and the rest go on, and
after three tries is told; any other 4xx is refused for good, and the reader is
told at the next image reader opened (or in the one open, when a pass refuses
it), until it dismisses it. A refused page pressed again is a fresh item, and
kept online it is forgotten; one still waiting is left exactly as it is.

## Tests

- `tests/cache-policy.spec.ts`: the policy.
- `tests/series-db.spec.ts`: the forward-only replay rule.
- `tests/offline-flow.e2e.ts`: the production service worker end to end. It
  caches ahead, reads the next chapter with the network cut, queues the
  events, replays them when back online, and checks ↓ CACHE / REMOVE CACHE
  and the `no-store` rule.
- `tests/highlights-queue.spec.ts`: the queue's rules, every answer and sending
  once, and the trying again. `tests/highlights-queue-flow.e2e.ts`: a page kept
  offline, through a reconnection, a closed app, a refusal, DON'T SEND,
  incognito, a hidden series or reveal, and a workstation that doesn't answer
  while the device says it's online.

## Not yet

- **Installing the PWA** (a web manifest and icons) is its own small step.
- **Offline history, series and library screens** show the last copy seen.
  Changes made offline (a rating, FAV) need the network: only reading
  progress and highlights ("Writes that wait", above) are queued.
- **Hidden series can't be read offline,** by design.
