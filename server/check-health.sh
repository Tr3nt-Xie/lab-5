#!/usr/bin/env bash
# Read-only checks for the Lab 5 Ubuntu server. Does not restart or configure services.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: bash server/check-health.sh [--http-only] --public-url https://hostname
Full mode: run on the Ubuntu EC2 instance as ubuntu (passwordless sudo) or root.
HTTP-only mode: checks public HTTPS from a laptop; skips server-internal checks.
Environment: TB_PUBLIC_URL, TB_LOCAL_URL (default http://127.0.0.1:8080),
  TB_JAVA_BIN (default /usr/lib/jvm/java-17-openjdk-amd64/bin/java).
Exit: 0 = selected checks passed; 1 = one or more checks failed; 2 = usage error.
USAGE
}

http_only=false
export TB_PUBLIC_URL=${TB_PUBLIC_URL:-} TB_LOCAL_URL=${TB_LOCAL_URL:-http://127.0.0.1:8080}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --http-only) http_only=true; shift ;;
    --public-url)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      TB_PUBLIC_URL=$2; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
for dependency in python3 curl; do
  command -v "$dependency" >/dev/null || { printf 'Missing dependency: %s\n' "$dependency" >&2; exit 2; }
done
python3 - <<'PY' || exit 2
import os, sys
from urllib.parse import urlsplit
for name in ('TB_PUBLIC_URL', 'TB_LOCAL_URL'):
    raw = os.environ[name]
    try:
        url = urlsplit(raw)
        port = url.port
        allowed = ('https',) if name == 'TB_PUBLIC_URL' else ('http', 'https')
        valid = (url.scheme in allowed and url.hostname and not url.username and not url.password
                 and url.path in ('', '/') and not url.query and not url.fragment
                 and not any(c.isspace() or ord(c) < 32 for c in raw))
    except ValueError:
        valid = False
    if not valid:
        print(name + ' must be a valid origin without credentials, path, query or fragment.'
              + (' Public access requires HTTPS.' if name == 'TB_PUBLIC_URL' else ''), file=sys.stderr)
        sys.exit(2)
PY

passed=0
failed=0
pass_check() { printf '[PASS] %s\n' "$1"; passed=$((passed + 1)); }
fail_check() { printf '[FAIL] %s\n' "$1"; failed=$((failed + 1)); }

check_service() {
  if command -v systemctl >/dev/null && systemctl is-active --quiet "$1"; then
    pass_check "$1 is active"
  else
    fail_check "$1 is not active, or systemctl is unavailable"
  fi
}

check_http() {
  local label=$1 origin=$2 status curl_status
  if status=$(curl --disable --globoff --silent --fail --connect-timeout 5 --max-time 15 \
    --output /dev/null --write-out '%{http_code}' "${origin%/}/login" 2>/dev/null); then
    if [[ $status == 200 ]]; then
      pass_check "$label /login returned HTTP 200"
    else
      fail_check "$label /login returned HTTP $status; expected 200 without redirects"
    fi
  else
    curl_status=$?
    fail_check "$label request failed (curl $curl_status, HTTP ${status:-000}); check DNS, TLS and service reachability"
  fi
}

printf 'Lab 5 health check — %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
if [[ $http_only == true ]]; then
  printf '[INFO] HTTP-only mode: Java, services, database and local HTTP are not checked.\n'
else
  java_bin=${TB_JAVA_BIN:-/usr/lib/jvm/java-17-openjdk-amd64/bin/java}
  if java_version=$("$java_bin" -version 2>&1) && [[ $java_version == *'version "17.'* ]]; then
    pass_check 'Java 17 is available at TB_JAVA_BIN'
  else
    fail_check 'Java 17 was not found at TB_JAVA_BIN'
  fi
  check_service postgresql@16-main
  check_service thingsboard
  check_service caddy

  # Use the local Unix socket and peer authentication. No database password is read.
  # Verify both a working SQL connection and the ThingsBoard schema/version.
  db_command=(timeout 10 psql -X --no-password --set=ON_ERROR_STOP=1 \
    --host=/var/run/postgresql --dbname=thingsboard --tuples-only --no-align \
    --command="SELECT current_database(), current_setting('server_version_num')::int / 10000, to_regclass('public.device') IS NOT NULL, to_regclass('public.ts_kv') IS NOT NULL;")
  if [[ $(id -u) == 0 ]]; then
    db_command=(runuser -u postgres -- "${db_command[@]}")
  else
    db_command=(sudo -n -u postgres "${db_command[@]}")
  fi
  if database_result=$("${db_command[@]}" 2>/dev/null); then
    if [[ $database_result == 'thingsboard|16|t|t' ]]; then
      pass_check 'PostgreSQL 16: thingsboard database and device/ts_kv tables are available'
    else
      fail_check 'Database version or ThingsBoard schema does not match the Lab 5 configuration'
    fi
  else
    fail_check 'Database query failed; check PostgreSQL, peer access, psql/timeout and passwordless sudo'
  fi
  check_http 'Local ThingsBoard' "$TB_LOCAL_URL"
fi
check_http 'Public HTTPS (certificate verification enabled)' "$TB_PUBLIC_URL"
printf 'Result: %s passed, %s failed (%s mode).\n' "$passed" "$failed" "$([[ $http_only == true ]] && printf 'HTTP-only' || printf 'full')"
[[ $failed == 0 ]]
