# Webfleet MCP Server

Read-only [Model Context Protocol](https://modelcontextprotocol.io) server for the Bridgestone Webfleet [WEBFLEET.connect](https://www.webfleet.com/en_au/webfleet/partners/integration/developer-resources/) CSV/JSON API.

Credentials are supplied per run (environment variables or gateway headers) by whoever owns the access layer. This process does not keep standing credentials.

## API

Checked against the public **WEBFLEET.connect 1.74.0** reference:

- Base URL: `https://csv.webfleet.com/extern`
- The 1.74 reference documents a single CSV/JSON host, `csv.webfleet.com`. There is no separate Australian hostname. `csv.telematics.tomtom.com` is the legacy pre-rebrand host and is accepted only as an explicit override (`WEBFLEET_HOST` or `x-webfleet-host`).
- `account` and `apikey` (exactly 36 characters) are query parameters.
- Username and password authenticate with HTTP Basic Auth (`Authorization: Basic base64(username:password)`). They are not written into the URL. Webfleet removes URL credentials at the end of June 2026.
- Every call sets `outputformat=json`, `useUTF8=true`, and `useISO8601=true`.

| Tool | WEBFLEET.connect action |
| --- | --- |
| `webfleet_status` | Local configuration only. Does not call Webfleet. |
| `webfleet_objects_list` | `showObjectReportExtern` (default) or `showVehicleReportExtern` when `report=vehicle` |
| `webfleet_trips` | `showTripReportExtern` |
| `webfleet_raw_request` | Caller-supplied read action (`show*`, `get*`, `pop*`, `geocode*`, `calc*`, `download*`) |

`showObjectReportExtern` is limited to 6 requests per minute. `showTripReportExtern` is limited to 1 request per minute. Trip filters are `tripid` (continuous replication) or a CSV `range_pattern` (`d0`, `d-1`, `w0`, `wf0`, `m0`, `ud`, …). With `useISO8601=true`, `rangefrom_string` and `rangeto_string` are ISO 8601 and apply to the trip end time. A range longer than one month also needs `objectno`.

Write actions (`send*`, `insert*`, `update*`, `delete*`, and the rest) are rejected.

## Operating constraints

- Read-only.
- The API key and user are created and rotated outside this repository and supplied per run. They are never stored here.
- State the processing region and retention before a scheduled pull leaves the customer's tenancy.
- Webfleet is vendor-hosted. No private network path is needed for this API.

## Install

```bash
npm install
npm test
npm run typecheck
npm run build
```

Node.js 20 or newer.

### Environment

Copy `.env.example` to `.env`. Single-tenant mode reads:

```bash
WEBFLEET_ACCOUNT=your_webfleet_account
WEBFLEET_API_KEY=0123456789abcdef0123456789abcdef0123
WEBFLEET_USERNAME=your_webfleet_username
WEBFLEET_PASSWORD=your_webfleet_password
# Optional: csv.webfleet.com (default) or csv.telematics.tomtom.com
WEBFLEET_HOST=csv.webfleet.com
WEBFLEET_LANG=en
```

### Gateway mode

HTTP mode accepts one tenant per request. Headers are scoped with `AsyncLocalStorage` and are not mixed with environment credentials:

- `x-webfleet-account`
- `x-webfleet-api-key`
- `x-webfleet-username`
- `x-webfleet-password`
- `x-webfleet-host` (optional)
- `x-webfleet-lang` (optional)

`/health` is container liveness and always returns 200. The MCP endpoint is `POST /mcp`. `/mcp` requires a valid `X-Gateway-S2S` header signed with `CONDUIT_S2S_SECRET`. If the secret is unset, `/mcp` rejects every request.

Outside a container the listener binds to `127.0.0.1` by default (`MCP_HTTP_HOST`). The signature and tenant headers are not encrypted by this server, so any gateway-to-server hop that leaves the host or pod must run over TLS (ingress, service mesh, or a TLS-terminating proxy).

### Run

```bash
# stdio (default) — local MCP clients
npm start

# HTTP — gateway and containers
npm run start:http
```

### Docker

```bash
docker compose up --build
```

The container listens on `0.0.0.0:8080` and sets `MCP_TRANSPORT=http`. Expose it only on a private network behind TLS termination.

## Tests

Tests mock `fetch`. They do not call Webfleet and do not embed a live API key. The Basic Auth fixture reproduces the reference example `wfcuser:yourpwd` → `Authorization: Basic d2ZjdXNlcjp5b3VycHdk`.

## License

Apache-2.0. See [LICENSE](LICENSE).
