#!/usr/bin/env bash
# Simulate a phone: post one OwnTracks-style location to a ThingsBoard device.
# Writes synthetic telemetry: use a dedicated test device, not a real phone.
#
#   TB_HOST=https://16-148-94-81.sslip.io TB_TOKEN=<device access token> \
#     bash tools/send-test-location.sh 34.1700 -118.1423
#
# The device access token is a credential: keep it out of the repository.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: TB_HOST=https://host TB_TOKEN=<test-device-token> bash tools/send-test-location.sh LAT LON
Requires bash, curl and Python 3. Sends exactly one synthetic location.
TB_CONNECT_TIMEOUT defaults to 5 seconds; TB_MAX_TIME defaults to 15 seconds.
Exit: 0 = HTTP 2xx; 2 = invalid input; nonzero = HTTP or transport failure.
USAGE
}
if [[ ${1:-} == --help || ${1:-} == -h ]]; then usage; exit 0; fi
if [[ $# != 2 ]]; then usage >&2; exit 2; fi
for dependency in python3 curl; do
  command -v "$dependency" >/dev/null || { printf 'Missing dependency: %s\n' "$dependency" >&2; exit 2; }
done
export TB_CONNECT_TIMEOUT=${TB_CONNECT_TIMEOUT:-5} TB_MAX_TIME=${TB_MAX_TIME:-15}

# Serialize numbers as JSON rather than interpolating user input into a body.
# Keep credentials out of diagnostics, including validation failures.
validated=$(python3 - "$1" "$2" <<'PY'
import json, math, os, sys, time
from urllib.parse import quote, urlsplit

def reject(message):
    print(message, file=sys.stderr)
    sys.exit(2)

host = os.environ.get('TB_HOST', '')
token = os.environ.get('TB_TOKEN', '')
try:
    url = urlsplit(host)
    port = url.port
    valid_host = (url.scheme in ('http', 'https') and url.hostname
                  and not url.username and not url.password
                  and url.path in ('', '/') and not url.query and not url.fragment
                  and not any(c.isspace() or ord(c) < 32 for c in host))
except ValueError:
    valid_host = False
if not valid_host:
    reject('TB_HOST must be an HTTP(S) origin without credentials, path, query or fragment.')
if not token or any(c.isspace() or ord(c) < 32 for c in token):
    reject('Set TB_TOKEN to a nonempty device token without whitespace.')
try:
    lat, lon = map(float, sys.argv[1:])
except ValueError:
    reject('Latitude and longitude must be numbers.')
if not math.isfinite(lat) or not -90 <= lat <= 90:
    reject('Latitude must be finite and between -90 and 90.')
if not math.isfinite(lon) or not -180 <= lon <= 180:
    reject('Longitude must be finite and between -180 and 180.')
for name in ('TB_CONNECT_TIMEOUT', 'TB_MAX_TIME'):
    value = os.environ[name]
    # A simple decimal also gives curl exactly the timeout Python validated.
    if not value.replace('.', '', 1).isdigit() or not 0 < float(value) <= 300:
        reject(name + ' must be a positive number no greater than 300 seconds.')
print(host.rstrip('/') + '/api/v1/' + quote(token, safe='') + '/telemetry')
print(json.dumps({'_type': 'location', 'lat': lat, 'lon': lon, 'tid': 'TS',
                 'batt': 100, 'tst': int(time.time()), 'testData': True}, allow_nan=False))
PY
) || exit 2
telemetry_url=${validated%%$'\n'*}
payload=${validated#*$'\n'}

# Disable curlrc and URL globbing; do not follow redirects or retry a POST.
# Do not echo the response body or credential-bearing URL on failure.
if http_status=$(curl --disable --globoff --silent --fail \
  --connect-timeout "$TB_CONNECT_TIMEOUT" --max-time "$TB_MAX_TIME" \
  --output /dev/null --write-out '%{http_code}' \
  --request POST --header 'Content-Type: application/json' \
  --data-binary "$payload" "$telemetry_url" 2>/dev/null); then
  if [[ $http_status == 2[0-9][0-9] ]]; then
    printf 'HTTP %s: synthetic location accepted.\n' "$http_status"
  else
    printf 'Upload failed: HTTP %s (expected 2xx; redirects are not followed).\n' "$http_status" >&2
    exit 1
  fi
else
  curl_status=$?
  printf 'Upload failed: curl exit %s, HTTP %s.\n' "$curl_status" "${http_status:-000}" >&2
  case "$curl_status" in
    6) printf 'Could not resolve the server hostname.\n' >&2 ;;
    7) printf 'Could not connect to the server.\n' >&2 ;;
    22) printf 'The server rejected the request; check the device token and server status.\n' >&2 ;;
    28) printf 'Request timed out; delivery is uncertain. Check telemetry before retrying.\n' >&2 ;;
    60) printf 'TLS certificate verification failed.\n' >&2 ;;
  esac
  exit "$curl_status"
fi
