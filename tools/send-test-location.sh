#!/usr/bin/env bash
# Simulate a phone: post one OwnTracks-style location to a ThingsBoard device.
# Useful to check the server and the dashboard without walking around.
#
#   TB_HOST=https://16-148-94-81.sslip.io TB_TOKEN=<device access token> \
#     bash tools/send-test-location.sh 34.1700 -118.1423
#
# The device access token is a credential: keep it out of the repository.
set -euo pipefail
: "${TB_HOST:?set TB_HOST, e.g. https://16-148-94-81.sslip.io}"
: "${TB_TOKEN:?set TB_TOKEN to the device access token}"
LAT=${1:?latitude}; LON=${2:?longitude}
curl -sS -o /dev/null -w "HTTP %{http_code}\n" -X POST \
  -H 'Content-Type: application/json' \
  -d "{\"_type\":\"location\",\"lat\":$LAT,\"lon\":$LON,\"tid\":\"TS\",\"batt\":100,\"tst\":$(date +%s)}" \
  "$TB_HOST/api/v1/$TB_TOKEN/telemetry"
