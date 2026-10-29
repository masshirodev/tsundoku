# Video fixtures

`clip.webm`: 8 s of ffmpeg test pattern and a sine tone, VP9 and Opus (the codecs Playwright's Chromium plays, which has no H.264 or AAC), 320x180. Made with:

```sh
ffmpeg -f lavfi -i "testsrc2=size=320x180:rate=12:duration=8" -f lavfi -i "sine=frequency=440:duration=8" -c:v libvpx-vp9 -b:v 60k -deadline realtime -cpu-used 8 -c:a libopus -b:a 24k -shortest clip.webm
```

`en.vtt`: two cues for it. Both feed `tests/browse-anime.e2e.ts` through the fake engine's `/video/` route (`tests/browse-setup.ts`).
