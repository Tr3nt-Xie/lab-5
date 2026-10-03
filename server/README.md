# Parts 1–2: phone preparation and cloud deployment

Owner: Wenxu Zhang. These instructions document the Lab 5 server deployment
and provide repeatable checks for the shared environment.

## Deployment used by this team

The October 1 deployment and October 3 HTTPS inspection recorded:

| Component | Recorded configuration |
|---|---|
| EC2 | Existing `lab4-worker`, us-west-2, t2.medium, 4 GiB RAM |
| OS | Ubuntu 22.04.5 LTS, amd64 |
| Java | OpenJDK 17.0.20.1 for ThingsBoard |
| Database | PostgreSQL 16.15, database `thingsboard`, local port 5432 |
| Application | ThingsBoard Community Edition 4.3.1.6 |
| Storage / queue | SQL, monthly partitions, built-in in-memory queue |
| HTTPS | Caddy forwards HTTPS to `localhost:8080` |
| Lab URL | `https://16-148-94-81.sslip.io` |

These are dated observations, not a claim that services are currently healthy.
The public IP may change after an EC2 stop/start. Check the EC2 console before
using the example URL. The existing Hadoop/Spark installation uses Java 11;
ThingsBoard's own `JAVA_HOME` selects Java 17 without changing that configuration.
The HTTPS setup is an existing teammate contribution; see [its script](https/setup-caddy.sh).

## Part 1: prepare the phones

Install OwnTracks on each phone and review the [OwnTracks guide](https://owntracks.org/booklet/).
Each phone needs its own ThingsBoard device and token, created in
[Parts 3–5](../part3-5/README.md). Location permission must allow the intended
foreground/background recording. Installing the app alone does not prove that
telemetry is reaching the server.

## Part 2: installation reference for a fresh server

Run installation commands on Ubuntu 22.04 amd64. The team's current server is
already initialized; use the health checks below for it. Re-running database
creation or `--loadDemo` is not part of routine validation.

### Java and application package

```bash
sudo apt-get update
sudo apt-get install -y openjdk-17-jdk postgresql-common curl ca-certificates python3
mkdir -p ~/lab5/packages
cd ~/lab5/packages
curl --fail --location --output thingsboard-4.3.1.6.deb \
  https://github.com/thingsboard/thingsboard/releases/download/v4.3.1.6/thingsboard-4.3.1.6.deb
sha256sum thingsboard-4.3.1.6.deb
sudo dpkg -i thingsboard-4.3.1.6.deb
```

The original lab download had SHA-256
`0f252b842f0dfacae2c26bf49a5717c30682cafbfb81eaf4b52d8b03c16d5c4b`.
This is a recorded fingerprint, not an independently published signature.
The version is pinned to the team's installation; this is not an upgrade guide.
See the [official release](https://github.com/thingsboard/thingsboard/releases/tag/v4.3.1.6).

### PostgreSQL 16 and database

Use the [official PostgreSQL Ubuntu repository](https://www.postgresql.org/download/linux/ubuntu/):

```bash
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl --fail --output /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc
cat <<'PGDG' | sudo tee /etc/apt/sources.list.d/pgdg.sources >/dev/null
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: jammy-pgdg
Architectures: amd64
Components: main
Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
PGDG
sudo apt-get update
sudo apt-get install -y postgresql-16
sudo systemctl enable --now postgresql@16-main
sudo -u postgres psql
```

Inside `psql`, on the fresh server only:

```text
\password postgres
CREATE DATABASE thingsboard;
\q
```

Enter the database password at the private prompt. Merge
[thingsboard.conf.example](thingsboard.conf.example) into
`/etc/thingsboard/conf/thingsboard.conf`, preserving the package defaults and
replacing `REPLACE_ON_SERVER_ONLY` privately with the same password. Keep this
deployed file on the server with owner `root:thingsboard` and mode `640`.
PostgreSQL remains local; public port 5432 is not needed.

SQL telemetry uses monthly partitions. The in-memory queue is suitable for
this single-node lab; it is not a durable production message queue.

### Initialize and start

```bash
cd /tmp
sudo /usr/share/thingsboard/bin/install/install.sh --loadDemo
sudo systemctl edit thingsboard
```

Add startup ordering in the systemd override:

```ini
[Unit]
Wants=postgresql@16-main.service
After=postgresql@16-main.service
```

Then start ThingsBoard:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now thingsboard
```

In the original installation, running the installer from a directory under
`/home/ubuntu` caused `Invalid source directory`. Running it from `/tmp` resolved
that error. A failed installation also returned exit code 0, so verify the
database schema and application instead of relying only on the installer exit code.

### HTTPS and access

From this repository on EC2:

```bash
bash server/https/setup-caddy.sh YOUR_CURRENT_PUBLIC_IPV4
```

The existing script configures Caddy for the IP-derived `sslip.io` hostname.
It needs inbound TCP 80 for certificate issuance and TCP 443 for HTTPS. SSH
access is separate; Caddy reaches ThingsBoard locally on port 8080. This guide
does not modify security groups. The original lab used a broad inbound rule;
coordinate any network changes with the teammates using the shared instance.

## Read-only health checks

From the repository root **on EC2**, using `ubuntu` with passwordless sudo or root:

```bash
bash server/check-health.sh --public-url https://16-148-94-81.sslip.io
```

Seven checks run: Java 17 at `TB_JAVA_BIN`, the three service states
(`postgresql@16-main`, `thingsboard`, `caddy`), a real SQL query checking the
database/version and `device`/`ts_kv` tables, local `/login`, and public HTTPS
`/login` with certificate verification. A failed check does not suppress the
remaining checks. SQL is bounded to 10 seconds; each HTTP request is bounded
to 15 seconds. The script neither changes services nor reads configuration secrets.

Prerequisites: Bash, Python 3, curl; full mode also uses systemd, PostgreSQL's
`psql`, GNU `timeout`, and `sudo`/`runuser`. The Java path defaults to
`/usr/lib/jvm/java-17-openjdk-amd64/bin/java`. Override `TB_JAVA_BIN` only when
the deployment uses a different Java 17 path. `TB_LOCAL_URL` defaults to
`http://127.0.0.1:8080`.

From a **laptop**, check external HTTPS only:

```bash
bash server/check-health.sh --http-only --public-url https://16-148-94-81.sslip.io
```

HTTP-only success does not certify the server-internal checks. Neither mode
proves that phones are uploading or that authentication and the custom map work;
verify those in ThingsBoard and on the phones. Exit codes: `0` selected checks
passed, `1` a check failed, `2` invalid usage or missing common prerequisites.

## Synthetic upload check

Use a dedicated test device, named outside the `phone-` prefix so it does not
appear in the team map. The upload script writes persistent telemetry to that
device. In a Bash shell, from the repository root:

```bash
export TB_HOST=https://16-148-94-81.sslip.io
read -r -s -p 'Test device token: ' TB_TOKEN
printf '\n'
export TB_TOKEN
bash tools/send-test-location.sh 34.0205 -118.2856
unset TB_TOKEN
```

The script checks finite latitude/longitude ranges, emits valid JSON, marks the
record `testData: true`, and accepts only HTTP 2xx. HTTP errors, redirects and
transport failures return nonzero. Connection/overall timeouts default to 5/15
seconds (`TB_CONNECT_TIMEOUT` / `TB_MAX_TIME`, positive decimals up to 300).
No automatic retries are made; after a timeout, inspect telemetry before retrying
because the server may have accepted the request. Tokens and response bodies are
not printed. Dependencies are Bash, curl and Python 3.

## Local regression checks

```bash
python3 -m unittest discover -s tests -v
```

Upload tests use real curl against a temporary loopback server with a dummy
token. Server-health tests simulate Ubuntu commands and failure cases; they do
not claim that the live EC2 passed. No test contacts AWS or writes phone telemetry.

Verification on October 3, 2026: all 17 local regression tests passed. Separately,
the external HTTPS check passed at 23:00:14 UTC, and this exact health script ran
on the existing EC2 at 23:01:43 UTC with **7 passed, 0 failed**. These checks do not
replace the team's real-phone movement and arrival demonstration.

## Handoff and shutdown

Wenxu maintains the shared server; Fengmao configures phones and the basic map;
Xiaopeng owns the custom mapping application. Share the HTTPS origin and device
names; exchange credentials privately. On an IP change, update Caddy and each
phone's upload URL. Save evidence before stopping EC2 after the team is finished.
Stopping compute does not automatically remove retained EBS/public-IP charges.
