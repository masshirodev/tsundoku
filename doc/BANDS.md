# Bands, and which ones can be dismissed

A band is the strip under a screen's bar that says one thing and offers one
act. `src/lib/components/chrome/Band.svelte` draws most of them; a few are
`Banner.svelte`'s. This is the account of which of them carry a ✕, and why.

## The rule

- **A band that reports something that already happened gets a ✕.** ADDED,
  MOVED, HIDDEN, a refusal: done, and being told so again helps nobody.
- **A band that says what is true now does not.** SCANNING while it runs,
  offline, a source not answering, incognito: hiding one of those would hide
  the truth, and the band goes by itself when the thing stops being true.
- **A band that is both gets no ✕ of its own**, and is named below.

The ✕ only clears the band. **It is not UNDO: the thing stays done, and UNDO
goes with the band**: a band's UNDO is only offered for as long as the band
is there.

A screen turns the cell on by passing `ondismiss` to `Band`. The cell comes
after the band's action, 48 px wide, inside the band's own height, so its hit
area stops at the hairline and cannot overlap the band below. Its accessible
name is `band_dismiss` ("Dismiss this band"), chosen to contain no control's
word ([`I18N.md`](I18N.md)). On a TV it is a focus stop after UNDO.

### Where a dismissed band stays gone

| Where the band lives                       | What ✕ does                                                                            | Stays gone                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| The URL (`?added=`, `?moved=1`, `?band=`)  | `clearBandUrl`: a replacing navigation without those parameters, no scroll, focus kept | A reload, and Back: the entry was replaced           |
| A form answer (`form`)                     | Remembers that answer object (`latest` is null while it is the one drawn)              | Until the next answer: a new `form` is a new band    |
| The page's own state                       | Clears it                                                                              | Until the event happens again                        |
| The workstation (`scan_jobs.dismissed_at`) | `?/dismissScan` with `stay=1`                                                          | Every device. A second tab's ✕ is the same row again |

**Two URL bands' ✕ in quick succession clear both**: while the first ✕'s
navigation is still landing (a slow load), the second builds on where the
first is going, not on the address still shown, which holds the first band's
parameters (`clearBandUrl`'s `pendingClear`; `band-dismiss-flow`, "two ✕
during a slow load").

**A URL band's ✕ navigates, and SvelteKit resets `form` on navigation**, so it
also clears any form-answer band on screen, and that band's UNDO goes with it
(measured in `band-dismiss-flow`). A form-answer band's ✕ does not touch the
URL's bands.

A new event brings a new band, however recently the last was dismissed. Bands
stack, so one going moves the next up under the pointer, which is fine; the
second press of a double tap must not take that one too, so a press inside
400 ms of a band a ✕ removed does nothing. Only a ✕ starts that wait: a band
that a new answer replaced has not just been pressed.

### `?added=` on the series screen means three things

| The URL                                       | `added` is             | Read by                             |
| --------------------------------------------- | ---------------------- | ----------------------------------- |
| `?added=<source id>&queued=N`, after ADD      | The source id          | ADDED TO THE LIBRARY (`addedFrom`)  |
| `?moved=1&added=N&kept=N`, after a MOVE       | A count of chapters    | MOVED's detail (`moved.added`)      |
| `?created=N&order=…&added=1,2`, after a GROUP | Entry ids (or volumes) | The created band, and its `undoAdd` |

`addedFrom` is null when `moved=1` or a `created` parameter is present, so
ADDED TO THE LIBRARY draws only after an ADD. Read without that rule, a move's
count passes as a source id: an ADDED band would draw above MOVED, and its
UNDO would post `?/undoSourceAdd` for a series that was moved, not added.

Because the created band reads `added` to tell a new series from books added
to an existing one (`?/ungroup` against `?/undoAdd`), no other ✕ may remove
`added` from under it.

## Every band

### Dismissable

| Screen                              | Band                                                                                                       | Lives in                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Library (`src/routes/+page.svelte`) | `… IS NO LONGER A WORK`, `… HIDDEN`, `HIDDEN · TAKEN OUT`, `UNGROUPED · …`                                 | URL (`band`, `facts`, `name`, `n`)                             |
| Library                             | Work made, `ADDED TO …`                                                                                    | Form answer                                                    |
| Library                             | HIDDEN (loose or whole) with UNDO                                                                          | Form answer                                                    |
| Library                             | A refused UNDO, `NOTHING CHANGED`                                                                          | Form answer                                                    |
| Library                             | `SHOWN · …`                                                                                                | Form answer                                                    |
| Library                             | REFRESH's batch band                                                                                       | Form answer                                                    |
| Library                             | `IMPORT FINISHED` (a `Banner`)                                                                             | The workstation                                                |
| Series (`series/[id]/+page.svelte`) | `ADDED TO THE LIBRARY` after an ADD, and its shelf chips with it (one URL)                                 | URL (`added`, `queued`)                                        |
| Series                              | `MOVED TO …`                                                                                               | URL (`moved`, `added`, `kept`, `lost`)                         |
| Series                              | The kind switch done, with UNDO                                                                            | The page                                                       |
| Series                              | `SERIES CREATED`, `N … ADDED`                                                                              | URL (`created`, `added`, `order`, `unit`)                      |
| Series                              | A refusal, `NOTHING CHANGED`                                                                               | Form answer                                                    |
| Series                              | `N NOT AT THE SOURCE`                                                                                      | Form answer                                                    |
| Series                              | REFRESH's answer                                                                                           | Form answer                                                    |
| Series                              | `MARKED READ THROUGH`, `PUT BACK N CHAPTERS` (EPISODES, WATCHED on video)                                  | Form answer                                                    |
| Series                              | `ADDED TO … · PART`, Work made, `UNLINKED`, `RENAMED`, `TAKEN OUT`                                         | Form answer                                                    |
| Series panel (`SeriesPanel.svelte`) | `TAKEN OUT OF …`, `… IS NO LONGER A WORK`, `HIDDEN · TAKEN OUT`                                            | Form answer                                                    |
| Series panel                        | `NOT A SERIES · WON'T ASK AGAIN`, `NOT THIS · WON'T ASK AGAIN`                                             | Form answer                                                    |
| Pages (`PageGrid.svelte`)           | A cover set, with UNDO                                                                                     | The page                                                       |
| Work (`work/[id]`)                  | `TAKEN OUT`, `ADDED`, `RENAMED`, a refusal                                                                 | Form answer                                                    |
| History                             | `REMOVED · PROGRESS KEPT`                                                                                  | Form answer                                                    |
| History                             | `ADDED · PROGRESS KEPT`                                                                                    | The page                                                       |
| Downloads, a source's preview       | A refusal, `NOTHING CHANGED`                                                                               | Form answer                                                    |
| Extensions                          | A refusal, a refused command                                                                               | Form answer, the page                                          |
| A source's page                     | A refused command                                                                                          | The page                                                       |
| A source's settings                 | A refusal                                                                                                  | Form answer                                                    |
| BROWSE, a source's page             | `ADDED TO THE LIBRARY, AND HIDDEN` (`AddedBand`)                                                           | URL (`added`, `series`, `preview`, `queued`, `new`, `refused`) |
| BROWSE, a source's settings         | `N SERIES HIDDEN NOW` (`ConcealBand`)                                                                      | URL (`of`, `concealed`)                                        |
| Highlights                          | `HIGHLIGHT DELETED`, a refusal                                                                             | Form answer                                                    |
| Highlights                          | `COPIED · N`                                                                                               | The page                                                       |
| Search                              | `HIDDEN`/`SHOWN` a Work whole, with UNDO                                                                   | The page                                                       |
| SETTINGS                            | The AniList/Ranobe sign-in band                                                                            | URL (`signin`, `service`)                                      |
| SETTINGS                            | `TMDB KEY SAVED`                                                                                           | Form answer                                                    |
| Layout, the web edition only        | `NOTHING CHANGED · …` after a takeover, with TRY AGAIN ([`WEB-EDITION.md`](WEB-EDITION.md), "Taking over") | Form answer                                                    |

**`IMPORT FINISHED` and the default shelf.** With no `?shelf=` in the URL the
library's default is the NEW shelf only while the import is current
(`scan ? 'new' : 'all'`), so its ✕ ends that view: at a bare `/` the grid goes
from JUST IMPORTED on NEW to ALL, without a navigation (measured in
`band-dismiss-flow`'s stored-band case). A library opened with `?shelf=` stays
on it. What else a ✕ changes depends on where its band lives (the table
above): a URL band's ✕ navigates and so clears a form answer too, while this
stored band's ✕ leaves the page's `form` alone. Its answer is never applied as
`form` (`keepForm`, which reads the page again instead), so a HIDE band on
screen keeps its UNDO (`band-dismiss-flow`, "IMPORT FINISHED's ✕ leaves a HIDE
band on screen").

### Says what is true now: no ✕

| Screen                        | Band                                                                      | Why                                |
| ----------------------------- | ------------------------------------------------------------------------- | ---------------------------------- |
| Layout                        | Incognito, reveal                                                         | The state itself                   |
| Library                       | `SCANNING ON WORKSTATION`, offline, the update bands' running states      | While it lasts                     |
| A source's page, its settings | `NOT ANSWERING`, `DID NOT ANSWER`, `ASKED TO SLOW DOWN`, `FAILED TO LOAD` | A source not answering is true now |
| A source's page               | `PASSING THE SITE'S BROWSER CHECK`, `STILL ASKING`                        | A wait in progress                 |

### Both: no ✕ of the band's own

- **FIRST READ's variant of ADDED (`StartTrail`, on the series screen just after
  ADD, with its UNDO).** It says which step comes next as well as what was
  done, and the trail owns when it goes: its only ✕ is the trail's, which ends
  the GET STARTED trip ([`ONBOARDING.md`](ONBOARDING.md)) and the band with
  it.
- **`KEPT BOTH · 1 EARLIER DECISION COULDN'T BE CARRIED OUT`
  (`SeriesPanel`).** It reports the past and points at something still true:
  SEE DUPLICATES → leads to a decision that is still waiting.

### Banners

`Banner.svelte` has no dismiss cell, so the update bands carry no ✕. Two
`Banner`s carry one of their own in their action cell:
`SERIES TO LINK` ([`LINKS.md`](LINKS.md)), and `IMPORT FINISHED`, whose ✕ sits
beside TIDY NEW. Moving `IMPORT FINISHED` onto `Band` would lose TIDY NEW's
accent cell and SEE LOG's link in the detail line.
