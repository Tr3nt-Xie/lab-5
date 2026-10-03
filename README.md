# EE 542 Lab 5 — Mobile phone IoT network with an IoT hub in the cloud

Phones run OwnTracks and report their location to a ThingsBoard Community
Edition server on AWS; ThingsBoard stores the telemetry and shows every phone
on a live map; Part 6 builds a custom multi-phone mapping application on top.

Team: Fengmao Xie, Wenxu Zhang, Xiaopeng Wu.

| Part | What | Where |
|---|---|---|
| 1–2 | OwnTracks; AWS Ubuntu + Java 17 + PostgreSQL + ThingsBoard | [`server/`](server/README.md) |
| 3–5 | Devices, HTTP(S) telemetry from the phones, OpenStreetMap dashboard | [`part3-5/`](part3-5/README.md) |
| 6 | Custom multi-phone mapping application | [`part6/`](part6/README.md) |

Also here: [`server/https/`](server/https/setup-caddy.sh), HTTPS in front of
ThingsBoard, required for iPhones; [`tools/`](tools/send-test-location.sh),
a synthetic-location sender for a dedicated test device.

Run `bash server/check-health.sh --http-only --public-url https://YOUR_HOST`
from a laptop to check HTTPS. Full server checks and deployment instructions are
in [`server/README.md`](server/README.md). Run local regression checks with
`python3 -m unittest discover -s tests -v` (Python 3, Bash and curl required).

Never commit device access tokens, SSH keys or ThingsBoard passwords.
