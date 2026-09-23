# Serving

tsundoku runs on the workstation and is read on the tablet over the tailnet.
Development is `yarn run dev`, on localhost with no token. What the tablet
opens is the build:

```sh
yarn run build
yarn run serve     # https://workstation.example.ts.net:8443
```

## HTTPS, through `tailscale serve`

The reader needs a **secure context**. WebAuthn (the `/reveal` fingerprint gate),
the screen wake lock, and service workers (offline chapters, installing the
PWA) all refuse plain http. So `serve` does this, by default:

1. Asks `tailscale status` for this machine's tailnet name, and checks that it
   has an HTTPS certificate. MagicDNS and HTTPS certificates have to be on in
   the Tailscale admin console; on this tailnet they are.
2. Starts the app on **127.0.0.1:42143** only. Nothing but the local proxy can
   reach it, which is tighter than the old tailnet-address bind.
3. Makes sure `tailscale serve` maps **https port 8443** to it, and adds the
   mapping if it's missing (`tailscale serve --bg --https=8443
http://127.0.0.1:42143`). The mapping persists across reboots. It's
   **tailnet only**, `serve` and never `funnel`.
4. Sets `ORIGIN` to `https://<tailnet name>:8443`, so every POST passes
   SvelteKit's origin check, and cookies are `Secure`.

Tailscale owns the certificate and renews it itself, so there are no `tailscale
cert` files to rotate. `tailscale serve` accepts HTTPS on 443, 8443 and 10000
only. **443 is taken on this machine** by another app's mapping (to port
42138), so tsundoku uses 8443. `serve` never overwrites a port that something
else serves: it stops and says to pick another with `TSUNDOKU_HTTPS_PORT`.

The pure parts (reading the tailnet name, the origin, whether a port is free,
ours or taken) are in `src/lib/server/bind.ts`, tested in `tests/bind.spec.ts`.

## Plain http, the old way

`TSUNDOKU_SERVE=http yarn run serve` binds the tailnet address directly on
plain http, as kirisute does. A wildcard bind is still refused unless
`TSUNDOKU_BIND_ANY=1` says so by name: this box has no firewall, so 0.0.0.0
would be the whole LAN. The fingerprint gate, the wake lock and offline
caching don't work this way.

## Variables

| Variable                    | Default    | Meaning                                                         |
| --------------------------- | ---------- | --------------------------------------------------------------- |
| `TSUNDOKU_TOKEN`            | (required) | The shared login token, in `.env`.                              |
| `TSUNDOKU_SERVE`            | `https`    | `https` through tailscale serve, or `http`.                     |
| `TSUNDOKU_HTTPS_PORT`       | `8443`     | 443, 8443 or 10000.                                             |
| `PORT`                      | `42143`    | The app's own port, on 127.0.0.1 (or the tailnet in http mode). |
| `ORIGIN`                    | derived    | Only to override the derived one.                               |
| `HOST`, `TSUNDOKU_BIND_ANY` | —          | http mode only.                                                 |

## Undoing it

`tailscale serve --https=8443 off` removes the mapping. The app is then only
reachable from the workstation itself.
