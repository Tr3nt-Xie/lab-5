# Parts 3–5: phones as IoT devices, HTTP telemetry, live map

Owner: Fengmao Xie. Server: ThingsBoard CE 4.3 on AWS (set up in Parts 1–2).

## 3. One device per phone

In ThingsBoard (tenant administrator): **Entities → Devices → + → Add new
device**, profile `default`, one per phone:

| Device | Label |
|---|---|
| `phone-fengmao` | Fengmao Xie - OwnTracks |
| `phone-wenxu` | Wenxu Zhang - OwnTracks |
| `phone-xiaopeng` | Xiaopeng Wu - OwnTracks |

The connectivity dialog that opens after **Add** shows the HTTP upload URL:
`http://<server>:8080/api/v1/<device access token>/telemetry`. The token is
that device's credential; give each person only their own and never commit it.

The common `phone-` prefix is deliberate: the dashboard selects devices by
that prefix, so a fourth phone appears on the map without editing it.

## 4. OwnTracks → ThingsBoard over HTTP(S)

**iPhones need HTTPS.** With the plain `http://` URL from the handout, OwnTracks
on iOS reports (Status Info):

> The resource could not be loaded because the App Transport Security policy
> requires the use of a secure connection.

iOS App Transport Security forbids clear-text HTTP. Android does not enforce
this, which is why the handout's URL works there. The fix is server-side, no
app change: `../server/https/setup-caddy.sh` installs Caddy as a TLS reverse
proxy in front of ThingsBoard, with a Let's Encrypt certificate for the
`sslip.io` name of the server's IP (`16-148-94-81.sslip.io`). The upload URL
becomes

```
https://16-148-94-81.sslip.io/api/v1/<device access token>/telemetry
```

On the phone (OwnTracks 27, iOS): ⓘ → Settings → **Mode: HTTP**; the URL is
the unlabeled line below *Secret encryption key*; set **TrackerID** to your
initials; turn **Authentication off** (the token in the URL authenticates);
location permission **Always** with precise location. On Android: Preferences
→ Connection → Mode HTTP, Host = the URL. Then publish once and check Status
Info: the URL shows `https://…` and there is no error.

If the server's public IP changes (stop/start without an Elastic IP), the
`sslip.io` name changes with it: rerun the script and update the phones.

## 5. Check the data and build the map

**Telemetry.** Devices → `phone-…` → **Latest telemetry**. OwnTracks posts
its whole location message, so ThingsBoard stores every field as a time
series: `lat`, `lon`, `acc` (m), `alt` (m), `batt` (%), `tid`, `tst`, `vel`,
and also `ssid`/`bssid` of the Wi-Fi network (keep those off screen in
recordings). The device turns **Active** and `lat`/`lon` timestamps advance
with each publish.

**Dashboard.** Import `dashboard-part5-phone-map.json` (Dashboards → + →
Import dashboard), or build it by hand:

1. New dashboard → Add widget → **Maps → Map** (OpenStreetMap layers).
2. Overlays → Markers → Add marker → datasource **Entity**, new alias
   `Team phones`: filter type *Entity name*, type *Device*, name `phone-`,
   *resolve as multiple entities* on.
3. Marker settings → **Latitude key `lat`, Longitude key `lon`**, picked from
   the dropdown as **time series** (wave icon), plus `tid` and `batt` as
   additional keys. Save, apply, save the dashboard.

The one trap: typing the key name by hand stored it as an **attribute** key
(Ⓐ icon). Telemetry is time series, so the widget found no position and
centred on 0°, 0° in the Gulf of Guinea. Selecting the time-series key from
the dropdown fixed it.

## Testing without a phone

```bash
TB_HOST=https://16-148-94-81.sslip.io TB_TOKEN=<device token> \
  bash ../tools/send-test-location.sh 34.1700 -118.1423
```

posts one location in the same shape as OwnTracks and should move that
device's marker.
