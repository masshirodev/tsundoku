# Languages

A **language pack** is everything tsundoku needs to look a word up in one
language: the rules that split text into words, and a dictionary to answer with.
The reader and the panel never know which pack answered.

Card c195 is the whole idea (decided with the owner 2026-10-30, "option 1"):
**packs ship in the code, dictionaries download as data packs**, so a third party
adds a language with a PR and nobody installs a plugin loader or trusts code
from outside the repo. That card also carries the OCR half — reading a page's
meaning off an image — which is not built. **This document describes the lookup
half, and the English pack that is its first non-Japanese user (c198).**

## The contract

`src/lib/languages/types.ts`. Two halves, split the way Japanese already was
([`JAPANESE.md`](JAPANESE.md)): the words are found **on the reader's device**,
and the definitions come **from the workstation**.

- **`Token`** — `surface`, `lemma`, `reading`, `pos`, `lookupable`, `segments`.
  The panel draws these as tap targets. `segments` is the ruby: a language
  without furigana returns `[]` rather than the panel checking for a language.
- **`Entry`** — `headword`, `reading`, `senses`, and `source`. A sense is
  `{ pos, glosses }`, and a gloss is `{ lang, text }` with `lang` in `'en'` or
  `'pt'` (c200: definitions in English, PT-BR or both, per device).
- **`source`** — dictionary name, licence and URL, on every entry. Wiktionary is
  CC BY-SA 3.0, so the panel draws the line it names rather than the app having
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

Measured 2026-11-12, on the extract of 2026-10-30:

|            |                                                            |
| ---------- | ---------------------------------------------------------- |
| source     | `kaikki.org-dictionary-English.jsonl.gz`, 534 MB           |
| build      | 75–95 s, 264–297 MB out                                    |
| contents   | 1,497,827 entries · 1,793,712 senses · 970,275 forms       |
| lookup     | 818/818 words · 48/48 inflections · 24/24 phrases answered |
| PT glosses | 39% of a word's senses, 32% of a form's, 27% of a phrase's |

The last row is the honest one: PT-BR definitions exist for a minority of senses,
which is why c200 requires the English fallback line rather than an empty sense.

The build writes beside the target and renames at the end, so a reader sees
either the old pack or the new one, never half of either.

### Where it lives

`TSUNDOKU_HOME/packs/en-wiktionary.db` (`PACK_DIR` overrides the folder,
`TSUNDOKU_EN_PACK` the file). The path is read lazily and the database opened
read-only, as JMdict is in kotoba: a missing pack means "no definitions", never
a reader that will not open.

The app does not download packs yet. Until it does, a pack is placed there by
hand — which is enough for the workstation, and not enough for a friend's
install; that is the download card c195 still owes.

## Adding a language

1. A `segment` for the device (`src/lib/languages/<id>.ts`) and a `define` for
   the workstation (`src/lib/server/languages/<id>.ts`), both answering the
   contract's shapes.
2. A pack builder under `scripts/`, with the licence it is under written in the
   entry's `source`.
3. A test with a fixture pack, and a `pack:<id>:check` with the numbers it was
   measured at.

## Not built yet

- **The panel draws Japanese.** `LookupPanel.svelte` still sets furigana and asks
  for a Japanese entry; the generic body is designed
  ([`handoffs/lookup-panel/`](handoffs/lookup-panel/), the c202 brief) but not
  wired.
- **The reader resolves no pack.** `TextReader.svelte` gates lookup on
  `const japanese = /^ja\b/i.test(locale)` — the one line that makes an English
  novel show no LOOK UP at all.
- **Downloading a pack**, and the Dictionary tab in Browse (c204).
- **OCR** for a language that has no text to select (c195, c196), and mining a
  pack's words into flashcards (c203).
