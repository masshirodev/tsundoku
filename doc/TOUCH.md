# Holding a finger on an image

A finger held on an image does not open the browser's menu (save image,
share, open in new tab). In the reader it would come up over the page being
read whenever a press lasts a little too long, and nothing in it is
something this library wants from a page: pages are kept for offline from the
series' sheet ([`OFFLINE.md`](OFFLINE.md)), and a page is made a cover from
the reader's own page menu ([`COVERS.md`](COVERS.md), "Chosen").

- **Where:** any `img`, and anything on a reader page (`.page`), since a
  page's OCR rings and loading box sit over its image and take the press.
- **How:** the root layout cancels a `contextmenu` that follows a touch or pen
  `pointerdown`. Listening on the window, after the screen's own handlers,
  so the long presses the app gives a meaning to (the page menu, a tile's
  sheet) still get theirs first. iOS shows its image callout without a
  `contextmenu` to cancel, so `img` also carries `-webkit-touch-callout: none`
  (`src/lib/styles/base.css`).
- **Touch only.** A mouse's right click keeps the browser's menu wherever the
  screen doesn't claim the right click itself (the vertical strip, a cover in
  a list).
- **Not text.** Holding a finger on words still selects them; only images
  have no menu.

Tested in `tests/reader-flow.e2e.ts` ("a finger held on a page…").
