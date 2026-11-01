#!/bin/sh
# Write the live .env from Infisical (doc/SECRETS.md). Infisical, on the VPS,
# is where tsundoku's secrets are kept; the .env in the data folder
# ($TSUNDOKU_HOME/.env, /mnt/hdd2/tsundoku/.env) is a copy of them, made by
# hand with this script whenever one changes. The workstation runs the
# released bundle (c228), whose launcher reads that file; the checkout's own
# .env is development's and this never touches it. The app only ever reads
# .env, so it starts and restarts without the VPS (the ISP can blackhole it).
#
#   yarn run secrets:pull
#   yarn run secrets:pull --dry-run   # what would change, by name; writes nothing
#
# Needs .infisical-identity beside it (untracked, mode 600), in the VPS's
# shape (~/projects/infisical/compose-with-secrets.sh there):
#   INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET, INFISICAL_PROJECT_ID,
#   INFISICAL_ENVIRONMENT, INFISICAL_API_URL
# Prints key names only, never a value.
set -eu

dry=
[ "${1:-}" = "--dry-run" ] && dry=1

cd "${SECRETS_DIR:-$(dirname "$0")/..}"
identity=.infisical-identity
: "${TSUNDOKU_HOME:?is not set: the live .env is \$TSUNDOKU_HOME/.env (/mnt/hdd2/tsundoku on the workstation)}"
target="$TSUNDOKU_HOME/.env"

if [ ! -r "$identity" ]; then
	printf '%s is missing: see doc/SECRETS.md, "Once".\n' "$identity" >&2
	exit 1
fi
set -a
. "./$identity"
set +a
: "${INFISICAL_CLIENT_ID:?missing from $identity}"
: "${INFISICAL_CLIENT_SECRET:?missing from $identity}"
: "${INFISICAL_PROJECT_ID:?missing from $identity}"
: "${INFISICAL_ENVIRONMENT:?missing from $identity}"
: "${INFISICAL_API_URL:?missing from $identity}"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
chmod 700 "$work"

jq -n --arg clientId "$INFISICAL_CLIENT_ID" --arg clientSecret "$INFISICAL_CLIENT_SECRET" \
	'{ clientId: $clientId, clientSecret: $clientSecret }' > "$work/login.json"
curl -fsS --retry 3 --connect-timeout 10 --max-time 60 \
	-H 'Content-Type: application/json' --data-binary "@$work/login.json" \
	"$INFISICAL_API_URL/api/v1/auth/universal-auth/login" > "$work/session.json"
token=$(jq -er '.accessToken' "$work/session.json")

curl -fsS --retry 3 --connect-timeout 10 --max-time 60 -G \
	-H "Authorization: Bearer $token" \
	--data-urlencode "workspaceId=$INFISICAL_PROJECT_ID" \
	--data-urlencode "environment=$INFISICAL_ENVIRONMENT" \
	--data-urlencode 'secretPath=/' \
	"$INFISICAL_API_URL/api/v3/secrets/raw" > "$work/secrets.json"

# An empty list is the easy mistake (a new project, or the wrong environment),
# and writing it would leave the app with no token. Refuse, and say where.
if ! jq -e '.secrets | length > 0' "$work/secrets.json" >/dev/null; then
	printf 'no secrets in project %s, environment %s: %s left as it is\n' \
		"$INFISICAL_PROJECT_ID" "$INFISICAL_ENVIRONMENT" "$target" >&2
	exit 1
fi

{
	printf '# Written by scripts/secrets-pull.sh from Infisical (doc/SECRETS.md).\n'
	printf '# Change a value there, then pull again; an edit here is lost on the next pull.\n'
	jq -r '.secrets | sort_by(.secretKey)[] | "\(.secretKey)=\(.secretValue | @json)"' "$work/secrets.json"
} > "$work/env"
chmod 600 "$work/env"

# The bundle runs from its own folder, so a relative DATABASE_PATH (the
# checkout's old "data/library.sqlite") would open a new, empty library there.
db=$(sed -n 's/^DATABASE_PATH=//p' "$work/env" | sed 's/^"\(.*\)"$/\1/')
case "$db" in
'' | /*) ;;
*)
	printf 'DATABASE_PATH in Infisical is relative (%s): make it absolute there first.\n' "$db" >&2
	exit 1
	;;
esac

# What changed, by name: added, removed, changed. Values are never printed.
keys() { sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$1" | sort; }
if [ -f "$target" ]; then
	keys "$target" > "$work/old"
	keys "$work/env" > "$work/new"
	for k in $(comm -13 "$work/old" "$work/new"); do printf '  + %s\n' "$k"; done
	for k in $(comm -23 "$work/old" "$work/new"); do printf '  - %s (not in Infisical: dropped)\n' "$k"; done
	for k in $(comm -12 "$work/old" "$work/new"); do
		a=$(grep -m1 "^$k=" "$target" | cut -d= -f2- | sed 's/^"\(.*\)"$/\1/')
		b=$(grep -m1 "^$k=" "$work/env" | cut -d= -f2- | sed 's/^"\(.*\)"$/\1/')
		[ "$a" = "$b" ] || printf '  ~ %s\n' "$k"
	done
fi
if [ -n "$dry" ]; then
	printf 'dry run: %s keys in Infisical (%s). %s left as it is.\n' \
		"$(keys "$work/env" | wc -l | tr -d ' ')" "$INFISICAL_ENVIRONMENT" "$target"
	exit 0
fi
[ -f "$target" ] && cp -p "$target" "$target.bak" && chmod 600 "$target.bak"
mv "$work/env" "$target"
printf '%s written: %s keys from %s (%s). The last one is %s.bak.\n' \
	"$target" "$(keys "$target" | wc -l | tr -d ' ')" "$INFISICAL_API_URL" "$INFISICAL_ENVIRONMENT" "$target"
printf 'Restart to use it: systemctl --user restart tsundoku\n'
