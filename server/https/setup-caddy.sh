#!/usr/bin/env bash
# Put HTTPS in front of ThingsBoard so that iPhones can upload.
#
# iOS App Transport Security makes OwnTracks refuse plain http:// URLs
# ("The resource could not be loaded because the App Transport Security
# policy requires the use of a secure connection"). Caddy terminates TLS with
# an automatically issued and renewed Let's Encrypt certificate and forwards
# to ThingsBoard on :8080. The hostname comes from sslip.io, which resolves
# a-b-c-d.sslip.io to the IP a.b.c.d, so no domain purchase is needed.
#
# Run on the ThingsBoard EC2 instance (Ubuntu 22.04). The security group must
# allow inbound TCP 80 (certificate challenge) and 443.
#   bash setup-caddy.sh               # uses this instance's public IP
#   bash setup-caddy.sh 16.148.94.81  # or give it explicitly
set -euo pipefail
IP=${1:-$(curl -s https://checkip.amazonaws.com)}
HOST="${IP//./-}.sslip.io"

sudo apt-get install -y -q debian-keyring debian-archive-keyring apt-transport-https curl gnupg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
  | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo apt-get update -q && sudo apt-get install -y -q caddy

printf '%s {\n\treverse_proxy localhost:8080\n}\n' "$HOST" | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy || sudo systemctl restart caddy

echo "Waiting for the certificate..."
for i in $(seq 1 30); do
  curl -sf -o /dev/null "https://$HOST/login" && { echo "HTTPS is up: https://$HOST"; exit 0; }
  sleep 2
done
echo "No certificate yet; check: sudo journalctl -u caddy -n 50" >&2
exit 1
