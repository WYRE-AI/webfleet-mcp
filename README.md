# Webfleet MCP Server

A read-only [Model Context Protocol](https://modelcontextprotocol.io) server for Bridgestone Webfleet's [WEBFLEET.connect](https://www.webfleet.com/en_us/webfleet/partners/integration/developer-resources/) API. It gives an MSP a read view of a client's fleet: vehicles and their latest positions, drivers, trips and tracks, events, KPIs, addresses, and orders.

Every tool is a `GET` of a read-only report action against the fixed endpoint `https://csv.webfleet.com/extern`. Nothing here can insert, update, or delete data, send anything to a driver terminal, or consume a message queue. Parameters and limits follow the **WEBFLEET.connect 1.76.0 Reference Guide**.

## Tools

| Tool | WEBFLEET.connect action | Limit |
| --- | --- | --- |
| `webfleet_status` | none (local configuration only) | n/a |
| `webfleet_objects_list` | `showObjectReportExtern` | 6/min |
| `webfleet_vehicles_list` | `showVehicleReportExtern` | 10/min |
| `webfleet_object_groups_list` | `showObjectGroups` | 10/min |
| `webfleet_object_group_objects_list` | `showObjectGroupObjects` | 10/min |
| `webfleet_nearest_vehicles` | `showNearestVehicles` | 10/min |
| `webfleet_contracts_list` | `showContracts` | 6/min |
| `webfleet_object_features` | `getObjectFeatures` | 10/min |
| `webfleet_trips` | `showTripReportExtern` | **1/min** |
| `webfleet_trip_summary` | `showTripSummaryReportExtern` | 10/min |
| `webfleet_tracks` | `showTracks` (max 2 days) | 10/min |
| `webfleet_logbook` | `showLogbook` | 10/min |
| `webfleet_standstills` | `showStandStills` | 6/min |
| `webfleet_idle_exceptions` | `showIdleExceptions` | 10/min |
| `webfleet_working_times` | `showWorkingTimes` | 6/min |
| `webfleet_events` | `showEventReportExtern` | **1/min** |
| `webfleet_speeding_events` | `showSpeedingEvents` | 10/min |
| `webfleet_acceleration_events` | `showAccelerationEvents` | 10/min |
| `webfleet_drivers_list` | `showDriverReportExtern` | 10/min |
| `webfleet_driver_groups_list` | `showDriverGroups` | 10/min |
| `webfleet_driver_group_drivers_list` | `showDriverGroupDrivers` | 10/min |
| `webfleet_object_kpis` | `getObjectKPIs` | 10/min |
| `webfleet_driver_kpis` | `getDriverKPIs` | 10/min |
| `webfleet_addresses_list` | `showAddressReportExtern` | 6/min |
| `webfleet_address_groups_list` | `showAddressGroupReportExtern` | 900/hour |
| `webfleet_address_group_addresses_list` | `showAddressGroupAddressReportExtern` | 900/hour |
| `webfleet_orders_list` | `showOrderReportExtern` | 6/min |
| `webfleet_order_waypoints` | `showOrderWaypoints` | 10/min |
| `webfleet_messages_list` | `showMessages` (reads messages; does not touch the queue) | 10/min |
| `webfleet_raw_request` | any one of the actions above, with caller-supplied parameters | same |

The catalog is one table in [`src/tools/catalog.ts`](src/tools/catalog.ts); the action allowlist and limits are in [`src/actions.ts`](src/actions.ts).

**Date ranges.** Report tools take the reference's date range filter: `range_pattern` (`d0`, `d-1`..`d-6`, `w0`..`w-3`, `wf0`..`wf-3`, `m0`..`m-3`, `ud`), or `rangefrom_string` + `rangeto_string` (ISO 8601, since every request sends `useISO8601=true`), or `year` (+ `month`, `day`). Trips and the logbook also accept `tripid` alone (continuous replication) and orders accept `orderid` alone.

**No paging.** WEBFLEET.connect returns a full list per call and has no page parameter. `tripid` is passed through as given; the server never issues follow-up requests. Use `columnfilter` (every tool) and the filters to keep responses small. A response larger than `WEBFLEET_MAX_RESPONSE_CHARS` keeps as many leading rows as fit and adds `truncated`, `returned_items`, `total_items`, and a `truncation_hint`.

**Errors.** Vendor errors come back as tool errors (`isError: true`) with the HTTP status, the WEBFLEET.connect response code (`X-Webfleet-Errorcode` or the body's error id), the vendor message, and a hint for the codes an operator can act on (1101/1106 wrong credentials, 8014 missing access right or API key, 8011 quota, 8015 overlapping request). WEBFLEET.connect does not return a request id. "No data" (codes 63 and 9198) is returned as an empty list, not an error.

## Request limits

Webfleet blocks an action once its limit is exceeded and keeps blocking until no request arrives for a full window; repeated overload can get a client's limits lowered or its access revoked. This server therefore:

- **throttles** each action per account and per API key to its documented limit and refuses locally (`Not sent: ... Retry in Ns`) instead of sending a request that would be rejected;
- **serialises** requests per account and username, as the reference requires (error 8015 otherwise);
- **caches** successful responses per exact credential set and request for one limit interval (60 s for a 1/min action, 10 s for 6/min, 6 s for 10/min), so a repeated identical call is answered locally.

The state is per process. With more than one replica, each replica keeps its own budget; run one replica per gateway cell or lower the limits.

## Authentication

A connection is four values: account name, username, password, and a 36-character API key. `account` and `apikey` go on the query string, as the reference requires. Username and password are sent **only** as HTTP Basic Auth (`Authorization: Basic base64(username:password)`); they never appear in the URL, and `username`/`password` parameters are refused.

| Mode | Where the connection comes from |
| --- | --- |
| stdio | `WEBFLEET_ACCOUNT`, `WEBFLEET_USERNAME`, `WEBFLEET_PASSWORD`, `WEBFLEET_API_KEY` |
| HTTP, `AUTH_MODE=env` | the same variables (startup refuses missing or malformed values) |
| HTTP, `AUTH_MODE=gateway` (container default) | the `X-Webfleet-Account`, `X-Webfleet-Username`, `X-Webfleet-Password`, and `X-Webfleet-Api-Key` headers on each request, **only**. All four are required (401 otherwise). The environment is never read, and the process stays locked to gateway mode once started. |

Use a dedicated integration user with the WEBFLEET.connect access right and only the report rights it needs, never an admin. Calls run with that user's rights, which can include live vehicle positions and driver personal data.

Every upstream request sends `Authorization`, `accept: application/json`, and `user-agent: webfleet-mcp/<version>`, plus the common parameters `lang=en`, `account`, `apikey`, `action`, `outputformat=json`, `useUTF8=true`, and `useISO8601=true`.

## Tool tiers

All tools are tier `read`, and `read` is the default (`WEBFLEET_TOOL_TIERS=read`). Conduit's `X-Conduit-Tool-Tiers` header can only narrow the set, and a present-but-empty (or non-`read`) header exposes zero tools.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `WEBFLEET_ACCOUNT`, `WEBFLEET_USERNAME`, `WEBFLEET_PASSWORD`, `WEBFLEET_API_KEY` | unset | Connection for stdio and `AUTH_MODE=env`. Ignored in gateway mode. |
| `WEBFLEET_TOOL_TIERS` | `read` | Comma-separated tiers. Only `read` is valid. |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http`. The image sets `http`. |
| `AUTH_MODE` | `env` | `env` or `gateway`. The image sets `gateway`. |
| `MCP_HTTP_HOST` | `127.0.0.1` | HTTP bind address. The image sets `0.0.0.0`. |
| `MCP_HTTP_PORT` | `8080` | HTTP port. |
| `MCP_ALLOWED_HOSTS` | unset | Optional `Host` header allowlist for `/mcp`. |
| `CONDUIT_S2S_SECRET` | unset | Required for HTTP. 32+ characters, not a placeholder (`openssl rand -hex 32`). Never logged. |
| `MCP_ALLOW_INSECURE_DEV` | unset | `1` = local development without S2S; binds 127.0.0.1 only. |
| `WEBFLEET_REQUEST_TIMEOUT_MS` | `60000` | Upstream timeout (max 300000, the reference's recommendation). Aborting early makes the next call for the same user fail with 8015. |
| `WEBFLEET_MAX_RESPONSE_CHARS` | `60000` | Tool output cap (redacted first, then measured). |
| `WEBFLEET_MAX_UPSTREAM_BYTES` | `4194304` (4 MiB) | Upstream body cap, enforced while streaming (max 128 MiB). |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`. Logs go to stderr and are redacted. |

See [`.env.example`](.env.example).

## Running

### stdio

```bash
npm ci --ignore-scripts && npm run build
WEBFLEET_ACCOUNT=... WEBFLEET_USERNAME=... WEBFLEET_PASSWORD=... WEBFLEET_API_KEY=... node dist/index.js
```

### HTTP behind the Conduit gateway

```bash
export CONDUIT_S2S_SECRET="$(openssl rand -hex 32)"
docker compose up --build
```

`GET /health` is unauthenticated liveness only and reads no credentials. `POST /mcp` requires a valid `X-Gateway-S2S` header and, in gateway mode, all four `X-Webfleet-*` headers. The password travels in a header, so any gateway-to-server hop that leaves the host must run over TLS.

## Security

- Fixed upstream endpoint; no base-URL or host override exists, and the built URL is checked to stay on `https://csv.webfleet.com/extern`.
- A fixed allowlist of read actions; `insert*`, `update*`, `delete*`, `send*`, `pop*`/`ack*`/`createQueue*`, and everything else is refused, including through `webfleet_raw_request`.
- Redirects are never followed; any 3xx is an error.
- The API key must be exactly 36 visible ASCII characters; the username may not contain `:`; control characters are refused in every credential and argument.
- The password, API key, and Basic Auth token are redacted from tool output, tool errors, and logs. Unexpected internal errors are reported generically.
- HTTP fails closed without a real `CONDUIT_S2S_SECRET`; S2S verification is the fleet's shared `s2s-verify.ts`.
- Only arguments declared in a tool's schema reach the handler.

There is no public sandbox. Testing against a live account must be read-only, with a dedicated integration user.

## Development

```bash
npm ci --ignore-scripts
npm run build
npm test
npm run lint
npm run lint:destructive
npm run typecheck
npm run smoke
```

Tests mock `fetch`; nothing calls a Webfleet host. `npm run smoke` starts the built stdio server and checks the 30-tool read-only surface and the local refusals without any network call.

## License

[MIT](LICENSE)
