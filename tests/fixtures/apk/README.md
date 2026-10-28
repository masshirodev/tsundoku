# Real extension APKs

Two of Keiyoushi's extensions, as its repository published them, from
<https://github.com/keiyoushi/extensions-source> (Apache-2.0):

| File                                | Extension    | sha256                                                             |
| ----------------------------------- | ------------ | ------------------------------------------------------------------ |
| `tachiyomi-all.webtoons-v1.6.2.apk` | Webtoons.com | `8a9842dc5db97f9d3939a35eb819b154d5805a5338f5e35706d62bd3f0476079` |
| `tachiyomi-all.mangadex-v1.6.0.apk` | MangaDex     | `12fde77601d48c8b231340694db8446fba5a555ced4109b231c9d2e3000915fb` |

They're here because checking an APK's v2 signature needs a really signed one,
and Node can make neither a certificate nor a signing block to fake it with
(`tests/apk-signature.spec.ts`). The second exists because an update needs two
different signed APKs (`tests/engine-extensions-db.spec.ts`).

Keiyoushi's signing-key fingerprint, from its `repo.json`:
`9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2`.

Chosen as the smallest of the library's sources that aren't adult ones. Never
put an APK of an adult source here, and nothing from `/mnt/hdd2/tsundoku/samples`.
