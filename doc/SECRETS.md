# Secrets

tsundoku's configuration is environment variables. `.env.example` lists them.
The app reads them from `.env`: a checkout's own `.env` in development, and the
data folder's, `$TSUNDOKU_HOME/.env`, when it runs a released bundle, whose
launcher reads that file ([`SERVING.md`](SERVING.md)). Variables already set in
the shell win over the file.

The author's deployment keeps the master copy in an
[Infisical](https://infisical.com) instance and writes the data folder's `.env`
from it with `yarn run secrets:pull` ("Pulling from Infisical", below). Nothing
else needs Infisical: any way of writing `.env` works.

## What's in it

**One secret is not in `.env`: a TMDB key typed in SETTINGS.** It is the
install's own, kept in the database's `settings` table beside the trackers'
OAuth tokens, and shown only by its last four characters. The environment's
`TMDB_API_RC_TOKEN` or `TMDB_API_KEY` always wins over it.

**The keys, the non-secret ones too:**

| Key                                 | What for                                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `TSUNDOKU_TOKEN`                    | Signing in to the app ([`INSTALL.md`](INSTALL.md))                                                                                     |
| `DATABASE_PATH`, `LIBRARY_ROOT`     | Which library `serve` opens ([`SERVING.md`](SERVING.md))                                                                               |
| `TSUNDOKU_HOME`, `BACKUP_DIR`       | The data folders; not secrets ([`DISTRIBUTION.md`](DISTRIBUTION.md))                                                                   |
| `KUMIKO_TOKEN`, `KUMIKO_DECK`       | Mined words to Kumiko ([`JAPANESE.md`](JAPANESE.md))                                                                                   |
| `ANILIST_CLIENT_*`, `MAL_CLIENT_*`  | Tracking sign-ins ([`TRACKING.md`](TRACKING.md))                                                                                       |
| `TMDB_API_RC_TOKEN`, `TMDB_API_KEY` | The TMDB catalogue for films and shows; either one                                                                                     |
| `RANOBE_TOKEN`                      | Novels to Ranobe ([`RANOBE.md`](RANOBE.md))                                                                                            |
| `RANOBE_SUGGEST_TOKEN`              | Suggestions to Ranobe, as its app account (RANOBE.md)                                                                                  |
| `ENGINE_URL`                        | The extension engine ([`EXTENSION-ENGINE.md`](EXTENSION-ENGINE.md)); not a secret, `http://127.0.0.1:4590`                             |
| `ENGINE_TOKEN`                      | The engine's bearer token: the compose file requires it, tsundoku sends it                                                             |
| `NOVEL_SOLVER_URL`                  | Where the app reaches the solver for a novel plugin's site check ([`NOVELS.md`](NOVELS.md)); `http://127.0.0.1:8193/v1` in development |

The serving settings (`HOST`, `PORT`, `TSUNDOKU_SERVE`, `TSUNDOKU_HTTPS_PORT`,
`TSUNDOKU_BIND_ANY`) and the data folders' overrides are in `.env.example`
with their defaults.

`DATABASE_PATH` must be **absolute** for a released bundle. The bundle runs
from its own folder, so a relative path would open a new, empty library there.

## Pulling from Infisical

`yarn run secrets:pull` (`scripts/secrets-pull.sh`) writes `$TSUNDOKU_HOME/.env`
from one Infisical project and environment. It never touches a checkout's own
`.env`. The app never reads Infisical itself: it reads `.env`, so it starts at
boot and restarts on its own even when the Infisical server cannot be reached.
The pull is run by hand when something changes, never at boot.

### Once

1. In Infisical, create a project for tsundoku and pick its environment (for
   example **Production**, slug `prod`).
2. Import an existing `.env`: _Secrets → Add → upload a .env file_.
3. Under _Access Control → Machine Identities_, create an identity with
   **Universal Auth**. Add it to the project as a **Viewer**: it only ever
   reads. Create a client secret for it.
4. Write the identity into the checkout the pull runs from:

   ```sh
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

   It is untracked (`.gitignore`), and so is `.env.bak`.

5. `yarn run secrets:pull --dry-run`, then `yarn run secrets:pull`. The first
   time, it should list no changes but what you added.

### A change

Change the value in Infisical, then:

```sh
yarn run secrets:pull --dry-run    # what would change, by name; writes nothing
yarn run secrets:pull && systemctl --user restart tsundoku
```

The pull prints what changed by name (`+` added, `-` dropped, `~` changed)
and never a value. It keeps the previous `.env` as `.env.bak`. It refuses an
empty list (a new project, or the wrong environment) and a relative
`DATABASE_PATH`, and leaves `.env` as it was.

A pull writes Infisical's list and nothing else, so a key that exists only in
`.env` is dropped. The script names each one it drops.

### How it works

- a universal-auth login with the identity;
- `GET /api/v3/secrets/raw` for the project and environment;
- a `chmod 600` temporary file, moved over `.env`.

It needs only `curl` and `jq`, not Infisical's CLI.

Each value is written JSON-quoted (`KEY="value"`), which Node's `loadEnvFile`
reads. A value with a `"` or a `\` in it would need care.
