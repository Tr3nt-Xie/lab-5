# EE 542 Lab 5 — Mobile phone IoT network with an IoT hub in the cloud

Phones run OwnTracks and report their location to a ThingsBoard Community
Edition server on AWS; ThingsBoard stores the telemetry and shows every phone
on a live map; Part 6 builds a custom multi-phone mapping application on top.

Team: Fengmao Xie, Wenxu Zhang, Xiaopeng Wu.

| Part | What | Where |
|---|---|---|
| 1–2 | OwnTracks; AWS Ubuntu + Java 17 + PostgreSQL + ThingsBoard | |
| 3–5 | Devices, HTTP(S) telemetry from the phones, OpenStreetMap dashboard | [`part3-5/`](part3-5/README.md) |
| 6 | Custom multi-phone mapping application | |

Also here: [`server/https/`](server/https/setup-caddy.sh), HTTPS in front of
ThingsBoard, required for iPhones; [`tools/`](tools/send-test-location.sh),
a phone simulator for testing.

Never commit device access tokens, SSH keys or ThingsBoard passwords.
