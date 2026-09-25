# Secrets

tsundoku's `.env` is a **copy**. The master copy lives in **Infisical** on the
VPS (`https://infisical.example.com`, project `tsundoku`, environment
`prod`). `yarn run secrets:pull` writes it here.

**The app never reads Infisical itself.** It reads `.env`, as it always has.
It starts at boot and restarts on its own (`ops/systemd/tsundoku.service`,
[`SERVING.md`](SERVING.md)), and it must keep doing both when the VPS can't
be reached: the ISP sometimes blackholes its address range. So the pull is
done by hand, when something changes, never at boot. Decided with the owner
on 2026-09-24.

## What's in it

**Every key `.env` has, the non-secret ones too:**

| Key                                | What for                                                       |
| ---------------------------------- | -------------------------------------------------------------- |
| `TSUNDOKU_TOKEN`                   | Signing in to the app ([`INSTALL.md`](INSTALL.md))             |
| `DATABASE_PATH`, `LIBRARY_ROOT`    | Which library `serve` opens ([`SERVING.md`](SERVING.md))       |
| `KUMIKO_TOKEN`, `KUMIKO_DECK`      | Mined words to Kumiko ([`JAPANESE.md`](JAPANESE.md))           |
| `ANILIST_CLIENT_*`, `MAL_CLIENT_*` | Tracking sign-ins, once they're built ([`LINKS.md`](LINKS.md)) |

A pull writes Infisical's list and nothing else, so a key that exists only
in `.env` is dropped. The script names each one it drops.

## Once

1. In Infisical, create the project **tsundoku**. Use its **Production**
   environment (slug `prod`).
2. Import the current `.env`: _Secrets → Add → upload a .env file_.
3. Under _Access Control → Machine Identities_, create
   **tsundoku-workstation** with **Universal Auth**. Add it to the project as
   a **Viewer**: it only ever reads. Create a client secret for it.
4. Write the identity beside the app, as the VPS's services have theirs:

   ```sh
   cd ~/projects/tsundoku
   install -m 600 /dev/null .infisical-identity
   $EDITOR .infisical-identity
   ```

   ```
   INFISICAL_CLIENT_ID=…
   INFISICAL_CLIENT_SECRET=…
   INFISICAL_PROJECT_ID=…        # the project's settings page
   INFISICAL_ENVIRONMENT=prod
   INFISICAL_API_URL=https://infisical.example.com
   ```

   It's untracked (`.gitignore`), and so is `.env.bak`.

5. `yarn run secrets:pull`. The first time, it should list no changes.

## A change

Change the value in Infisical, then:

```sh
yarn run secrets:pull && systemctl --user restart tsundoku
```

The pull prints what changed by name (`+` added, `-` dropped, `~` changed)
and never a value. It keeps the previous `.env` as `.env.bak`. It refuses
an empty list (a new project, or the wrong environment) and leaves `.env`
as it was.

## How it works

`scripts/secrets-pull.sh` is the VPS's
`infisical/compose-with-secrets.sh`, pointed at a file instead of
`docker compose`:

- a universal-auth login with the identity;
- `GET /api/v3/secrets/raw` for the project and environment;
- a `chmod 600` temporary file, moved over `.env`.

It needs only `curl` and `jq`, not Infisical's CLI.

Each value is written JSON-quoted (`KEY="value"`), which Node's
`loadEnvFile` reads. A value with a `"` or a `\` in it would need care. None
has one today.
