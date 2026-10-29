#!/usr/bin/env bash
# Runs on the VPS. Source is an exact GitHub commit archive; .env stays in shared/.
set -Eeuo pipefail
umask 027
root=${1:?deployment root is required}
release_id=${2:?commit SHA is required}
profile=${3:-shared}
project=${4:-delivery}
[[ "$project" =~ ^[a-z][a-z0-9_-]+$ ]] || { echo "Invalid Compose project" >&2; exit 1; }
export COMPOSE_PROJECT_NAME="$project"
[[ "$root" =~ ^/[A-Za-z0-9/_-]+$ && "$root" != / ]] || { echo 'Invalid deployment directory' >&2; exit 1; }
[[ "$release_id" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid release SHA' >&2; exit 1; }
[[ "$profile" == production || "$profile" == shared || "$profile" == local ]] || { echo 'Invalid profile' >&2; exit 1; }
mkdir -p "$root/releases" "$root/shared" "$root/incoming"
exec 9>"$root/deploy.lock"
flock -w 1200 9 || { echo 'Another deployment is still running' >&2; exit 1; }
archive="$root/incoming/$release_id.tar.gz"
release="$root/releases/$release_id"
[[ -f "$root/shared/.env" ]] || { echo 'Missing shared/.env on server' >&2; exit 1; }
python3 - "$root/shared/.env" "$profile" <<'PY'
import re,sys
from pathlib import Path
from urllib.parse import urlsplit
values={}
for line in Path(sys.argv[1]).read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        key,value=line.split('=',1)
        values[key.strip()]=value.strip().strip('"').strip("'")
if not re.fullmatch(r'\d+:[\w-]+',values.get('BOT_TOKEN','')):
    raise SystemExit('Set a valid BOT_TOKEN in shared/.env')
if sys.argv[2] in ('production','shared'):
    url=urlsplit(values.get('APP_URL',''))
    if url.scheme!='https' or not url.hostname or url.hostname!=values.get('DOMAIN') or url.path not in ('','/'):
        raise SystemExit('Production needs matching HTTPS APP_URL and DOMAIN in shared/.env')
PY
if [[ ! -f "$release/.release-ready" ]]; then
  [[ -f "$archive" ]] || { echo 'Missing release archive' >&2; exit 1; }
  # Only trusted git archives arrive here; never extract a local .env or database.
  mkdir -p "$release"
  tar -xzf "$archive" -C "$release"
  ln -sfn "$root/shared/backups" "$release/backups"
  touch "$release/.release-ready"
fi
[[ -d "$root/shared/backups" ]] || { echo 'Create writable shared/backups first' >&2; exit 1; }
previous=$(readlink -f "$root/current" 2>/dev/null || true)
export FLYPARCEL_RELEASE="$release_id"
compose=(docker compose --project-name "$project" --env-file "$root/shared/.env" --project-directory "$release" -f "$release/compose.yaml")
if [[ "$profile" == production ]]; then compose+=(--profile production); fi
"${compose[@]}" config --quiet
# Building happens before any currently running service is stopped.
"${compose[@]}" build --pull bot app
if [[ -n "$previous" && -f "$previous/compose.yaml" ]]; then
  old=(docker compose --project-name "$project" --env-file "$root/shared/.env" --project-directory "$previous" -f "$previous/compose.yaml")
  if [[ "$profile" == production ]]; then old+=(--profile production); fi
  if FLYPARCEL_RELEASE="$(basename "$previous")" "${old[@]}" ps --status running --services | grep -qx bot; then
    FLYPARCEL_RELEASE="$(basename "$previous")" "${old[@]}" exec -T bot python backup.py </dev/null
  fi
elif "${compose[@]}" ps --status running --services | grep -qx bot; then
  "${compose[@]}" exec -T bot python backup.py </dev/null
fi
rollback() {
  trap - ERR
  echo 'Deployment failed; keeping logs and attempting to restore previous images' >&2
  "${compose[@]}" logs --tail 80 bot app >&2 || true
  if [[ -n "$previous" && "$previous" != "$release" && -f "$previous/compose.yaml" ]]; then
    export FLYPARCEL_RELEASE="$(basename "$previous")"
    "${old[@]}" up -d --no-build --wait --wait-timeout 180 || true
    if [[ "$profile" == shared ]]; then
      old_container=$("${old[@]}" ps -q app)
      if [[ -n "$old_container" ]] && ! docker inspect --format '{{json .NetworkSettings.Networks}}' "$old_container" | grep -q 'bots-edge'; then
        docker network connect --alias "$project-app" bots-edge "$old_container" || true
      fi
    fi
  fi
  # A database backup is never restored automatically: new user data must not be overwritten.
  exit 1
}
trap rollback ERR
"${compose[@]}" up -d --no-build --wait --wait-timeout 180
"${compose[@]}" exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" </dev/null
if [[ "$profile" == shared ]]; then
  edge=${DEPLOY_EDGE_PATH:-/opt/bots-edge}
  [[ -f "$edge/compose.yaml" && -d "$edge/sites" ]] || { echo 'Shared HTTPS proxy is not prepared' >&2; false; }
  domain=$(python3 - "$root/shared/.env" <<'PYDOMAIN'
from pathlib import Path
import re,sys
for line in Path(sys.argv[1]).read_text().splitlines():
    if line.startswith('DOMAIN='):
        value=line.split('=',1)[1].strip().strip('"').strip("'")
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]+',value): raise SystemExit('Invalid domain')
        print(value)
        break
else: raise SystemExit('Missing DOMAIN')
PYDOMAIN
)
  container=$("${compose[@]}" ps -q app)
  if ! docker inspect --format '{{json .NetworkSettings.Networks}}' "$container" | grep -q 'bots-edge'; then
    docker network connect --alias "$project-app" bots-edge "$container"
  fi
  route="$edge/sites/$project.caddy"
  printf '%s {\n    encode gzip\n    reverse_proxy %s-app:3000\n}\n' "$domain" "$project" > "$route.new"
  mv -f "$route.new" "$route"
  docker compose --project-name bots-edge -f "$edge/compose.yaml" up -d --wait
  docker compose --project-name bots-edge -f "$edge/compose.yaml" exec -T proxy caddy validate --config /etc/caddy/Caddyfile </dev/null
  docker compose --project-name bots-edge -f "$edge/compose.yaml" exec -T proxy caddy reload --config /etc/caddy/Caddyfile </dev/null
  curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-all-errors --max-time 15 "https://$domain/api/health"
fi
ln -sfn "$release" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
printf '%s\n' "$release_id" > "$root/deployed-sha"
rm -f "$archive"
trap - ERR
printf 'Deployed %s (%s)\n' "$release_id" "$profile"
