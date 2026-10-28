# A real extension APK

`tachiyomi-all.webtoons-v1.6.2.apk` is Keiyoushi's Webtoons.com extension,
as its repository published it (sha256
`8a9842dc5db97f9d3939a35eb819b154d5805a5338f5e35706d62bd3f0476079`), from
<https://github.com/keiyoushi/extensions-source> (Apache-2.0). It's here
because checking an APK's v2 signature needs a really signed one, and Node can
make neither a certificate nor a signing block to fake it with
(`tests/apk-signature.spec.ts`).

Keiyoushi's signing-key fingerprint, from its `repo.json`:
`9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2`.

Chosen as the smallest of the library's sources that isn't an adult one.
Never put an APK of an adult source here, and nothing from
`/mnt/hdd2/tsundoku/samples`.
