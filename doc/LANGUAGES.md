# Languages

A **language pack** is everything tsundoku needs to look a word up in one
language: the rules that split text into words, and a dictionary to answer with.
The reader and the panel never know which pack answered.

**Packs ship in the code, dictionaries are data packs**, so a third party adds
a language with a PR and nobody installs a plugin loader or trusts code from
outside the repo. This document describes the lookup, and the English pack,
its first non-Japanese user.

## The contract

`src/lib/languages/types.ts`. Two halves, split the way Japanese already was
([`JAPANESE.md`](JAPANESE.md)): the words are found **on the reader's device**,
and the definitions come **from the workstation**.

- **`Token`** — `surface`, `lemma`, `reading`, `pos`, `lookupable`, `segments`.
  The panel draws these as tap targets. `segments` is the ruby: a language
  without furigana returns `[]` rather than the panel checking for a language.
- **`Entry`** — `headword`, `reading`, `senses`, and `source`. A sense is
  `{ pos, glosses }`, and a gloss is `{ lang, text }` with `lang` in `'en'` or
  `'pt'` (definitions in English, PT-BR or both, per device).
- **`source`** — dictionary name, licence and URL, on every entry. Wiktionary is
  CC BY-SA 4.0, so the panel draws the line it names rather than the app having
  to remember.

A pack is two functions and a path:

| Half            | Answers                | Runs                                         |
| --------------- | ---------------------- | -------------------------------------------- |
| `segment(text)` | the block as `Token[]` | on the device                                |
| `define({…})`   | a tap as `Entry[]`     | on the workstation, behind `GET /api/define` |

`GET /api/define?pack=en&surface=gave&after= up the fight` — `pack` defaults to
`ja`, so an older reader keeps the answer it has always had. `available: false`
means that pack's dictionary is not built, and the panel leaves LOOK UP out.

## The English pack

### Words, without a model

`src/lib/languages/en.ts`. A word is letters with apostrophes and hyphens inside
it (`don't`, `well-known`, `1990s`); everything between two words is punctuation,
drawn muted and never looked up. There is no tokenizer dependency, which is the
whole point: English does not need kuromoji's twelve dictionaries, and a pack
should not carry a model it does not use.

### Inflections, without a lemmatiser

`gave` is `give`, `mice` is `mouse`. Two mechanisms, in this order:

1. **The pack's `forms` table.** Wiktionary lists every form of a word, regular
   and irregular, and `scripts/pack-en.ts` keeps them. No suffix stripper is
   maintained by hand, and no language model guesses.
2. **Wiktionary's own pointer entries.** It writes one entry per inflected form
   whose entire content is "simple past of give" (`form_of`). The lookup follows
   that pointer to the lemma's real senses instead of printing it — otherwise
   the answer to "gave" would be a sentence about grammar.

An entry that is a word in its own right always wins: `saw` is the tool, not the
past of `see` (the forms table only answers when nothing else does).

### Phrases

`define` tries the longest span first, so `give up` beats `give`. The client
passes the text after the tap (`after`), and the server reads up to two words
into it — `lookahead` — because the client should not hold a phrase list. When a
phrase answers, the single word inside it is returned after it, since a reader
may have tapped only part of it.

### Sense order

Wiktionary's order, with `archaic`, `obsolete`, `rare` and `dated` senses pushed
under the rest, and identical glosses collapsed. That is **not** a frequency
ranking, and it shows: `look after` answers with "to follow with the eyes"
before "to take care of", because Wiktionary lists it that way. Nothing in the
data says which sense a reader means, and guessing would be worse than listing.

## The data pack

Built from [kaikki.org](https://kaikki.org/dictionary/English/)'s English
Wiktionary extract — the same Wiktionary text already parsed into JSON, under the
same licence, with the forms and phrase entries this pack needs already in it.

```sh
yarn run pack:en --in <English.jsonl.gz> --out <en-wiktionary.db>
yarn run pack:en:check                          # what it answers, and in what language
```

Measured on one extract:

|            |                                                            |
| ---------- | ---------------------------------------------------------- |
| source     | `kaikki.org-dictionary-English.jsonl.gz`, 534 MB           |
| build      | 75–95 s, 264–297 MB out                                    |
| contents   | 1,497,827 entries · 1,793,712 senses · 970,275 forms       |
| lookup     | 818/818 words · 48/48 inflections · 24/24 phrases answered |
| PT glosses | 39% of a word's senses, 32% of a form's, 27% of a phrase's |

The last row is the honest one: PT-BR definitions exist for a minority of senses,
which is why a sense without one shows the English line rather than nothing.

The build writes beside the target and renames at the end, so a reader sees
either the old pack or the new one, never half of either.

### Where it lives

`TSUNDOKU_HOME/packs/en-wiktionary.db` (`PACK_DIR` overrides the folder,
`TSUNDOKU_EN_PACK` the file). The path is read lazily and the database opened
read-only, as JMdict is: a missing pack means "no definitions", never a reader
that will not open. The app doesn't download packs: one is placed there by
hand.

## Adding a language

1. A `segment` for the device (`src/lib/languages/<id>.ts`) and a `define` for
   the workstation (`src/lib/server/languages/<id>.ts`), both answering the
   contract's shapes.
2. A pack builder under `scripts/`, with the licence it is under written in the
   entry's `source`.
3. A test with a fixture pack, and a `pack:<id>:check` with the numbers it was
   measured at.

## In the reader

`LookupPanel.svelte` takes a **pack**, not a language: it asks the pack to split
the block, sets the words in the pack's face and size (Plex Sans JP 30px for
Japanese, Plex Sans 24px for English), draws whatever ruby that language has, and
renders one normalised entry with its source and licence line under it. `packFor(locale)` picks the pack from the
book's language, and a language with none shows no LOOK UP rather than a panel
that answers nothing.

**The gesture is one, not one per language.** In a book, a long press selects
the word and raises the reader's bar, and LOOK UP on that bar opens the panel —
English and Japanese alike. A manga keeps the tap: a page has no text to select.

## Limits

- **A pack is placed by hand.** The app doesn't download one, and Browse has
  no dictionary tab.
- **No OCR** for a language other than Japanese, so a manga in English has no
  LOOK UP; a pack's words are not mined into flashcards.
