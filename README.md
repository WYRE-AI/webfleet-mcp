# Webfleet MCP Server

Read-only [Model Context Protocol](https://modelcontextprotocol.io) server for the Bridgestone Webfleet [WEBFLEET.connect](https://www.webfleet.com/en_au/webfleet/partners/integration/developer-resources/) CSV/JSON API.

Built for the Infinity Investments engagement (TFH / Rent-A-Fence, Brisbane), delivered with Steadfast. Steadfast owns the access layer and rotates credentials. This process does not keep standing client credentials. Before any production pull, confirm with the client (Scott) whether Webfleet has replaced Coretex 360 or still runs alongside it. IT Glue currently records Coretex 360, and no Webfleet tenant was documented there.

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

## Engagement constraints

- Read-only. Reporting questions for Webfleet are still to be captured in the Steadfast discovery session with Ben Andrews and Scott Burr.
- Steadfast creates and rotates the API key and user. WYRE receives them per run (environment or gateway headers) and does not store them in this repository.
- Infinity data resides in Azure Australia. State the processing region and retention before a scheduled pull leaves the tenancy.
- Webfleet is vendor-hosted. There is no Steadfast network path to build for this API.

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

`/health` is container liveness and always returns 200. The MCP endpoint is `POST /mcp`. When `CONDUIT_S2S_SECRET` is set, `/mcp` requires a valid `X-Gateway-S2S` header.

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

The container listens on port 8080 and sets `MCP_TRANSPORT=http`.

## Tests

Tests mock `fetch`. They do not call Webfleet and do not embed a live API key. The Basic Auth fixture reproduces the reference example `wfcuser:yourpwd` → `Authorization: Basic d2ZjdXNlcjp5b3VycHdk`.

## License

Apache-2.0. See [LICENSE](LICENSE).
