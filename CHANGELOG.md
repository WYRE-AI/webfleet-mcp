# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Released versions are appended by semantic-release from Conventional Commits.

## [Unreleased]

### Added

- Read-only MCP server for Bridgestone Webfleet WEBFLEET.connect (WYREAI-536): stdio and stateless streamable HTTP (Conduit gateway) transports.
- 30 read-tier tools: `webfleet_status` (local), one tool per documented read action (28: objects, vehicles, object groups and memberships, nearest vehicles, contracts, object features, trips, trip summary, tracks, logbook, standstills, idle exceptions, working times, events, speeding and acceleration events, drivers, driver groups and memberships, object and driver KPIs, addresses, address groups and memberships, orders, order waypoints, messages), and `webfleet_raw_request` limited to the same actions.
- Parameters, enums, lengths, and limits follow the WEBFLEET.connect 1.76.0 Reference Guide. The shared date range filter is validated (pattern vs. from/to vs. year/month/day); `tripid` and `orderid` are accepted in place of a date range where the reference allows it. `columnfilter` is offered on every tool.
- Client-side protection for Webfleet's request limits: a throttle per action for each tenant account and its API key, per-credential-set request serialisation (error 8015), a 10 s back-off per credential set after a request times out or is cancelled, and a one-interval response cache per exact credential set and request.
- Vendor errors surface the HTTP status, the WEBFLEET.connect response code, the vendor message, and a hint for actionable codes. "No data" (63, 9198) is an empty list.

### Changed

- `webfleet_objects_list` no longer takes `report`; vehicles moved to their own `webfleet_vehicles_list` (`showVehicleReportExtern`).
- `webfleet_raw_request` accepts only the fixed allowlist of read actions instead of the `show*`/`get*`/`pop*`/`geocode*`/`calc*`/`download*` prefixes. `pop*` consumed messages from a shared queue.
- License is MIT, matching the WYRE MCP fleet (the scaffold's Apache-2.0 text was modified and not the canonical license).

### Removed

- The `x-webfleet-host`/`WEBFLEET_HOST` and `x-webfleet-lang`/`WEBFLEET_LANG` overrides. The host is fixed at `csv.webfleet.com` and `lang` is always `en`.
- The `externalid` parameter, which the reference marks "for future use".

### Fixed

- `webfleet_events` sends `resolved` and `acknowledged` as `1`/`0`, the values the reference documents, instead of `true`/`false`.
- `webfleet_speeding_events` and `webfleet_acceleration_events` require one of objectno, objectuid, objectgroupname, driverno, driveruid, or drivergroupname, as the reference does; `webfleet_acceleration_events` now accepts `objectgroupname`.
- `webfleet_logbook` describes `tripid` as selecting one finished trip, not as a replication high-water mark.
- `webfleet_standstills` requires `range_pattern` (or from/to, which is sent with `range_pattern=ud`) and no longer takes `year`/`month`/`day`. Every explicit from/to range is sent with `range_pattern=ud`.
- ISO 8601 date-times must include seconds and a `+hh:mm` offset or `Z` if they carry a zone, matching the reference's notation.
- `orderid` is checked against its 20-byte UTF-8 limit, not 20 characters.
- `webfleet_trips`, `webfleet_idle_exceptions`, and `webfleet_working_times` state their documented date range limits.
- ISO 8601 date-times with an impossible date, clock field, or offset (for example `2026-02-30`, `24:00:00`, `+99:99`) are refused before sending.
- A call cancelled while queued no longer spends a throttle slot. A failure while reading the response body is a clear tool error with the HTTP status.
- `npm start` (and the `webfleet-mcp` bin) honours `MCP_TRANSPORT=http` and starts the HTTP listener instead of stdio.
- `webfleet_status` is a tool error (`isError`) when credentials are missing or malformed, as the fleet canary contract requires.
- The throttle is no longer shared across accounts that use the same API key (one partner key can serve many tenants); users of one account now share that account's budget, as Webfleet counts it.
- After a request times out or is cancelled, the next request for the same credentials is refused locally for 10 s instead of being answered by Webfleet with 8015.
- Network errors keep the system error code (for example `ENOTFOUND`) when it is a plain code.

### Security

- Fixed upstream endpoint `https://csv.webfleet.com/extern`; no base-URL or host input exists, and the built URL is checked against it.
- Username and password are sent only as HTTP Basic Auth; reserved and credential parameter names are refused in any case.
- Redirects are never followed (`redirect: "manual"`; any 3xx is an error). Upstream bodies are capped at 4 MiB while streaming.
- Gateway mode (`AUTH_MODE=gateway`, the image default) reads the connection only from `X-Webfleet-Account`, `X-Webfleet-Username`, `X-Webfleet-Password`, and `X-Webfleet-Api-Key`, requires all four, and never reads the environment; the process is locked to gateway mode once the HTTP server starts.
- The password, API key, and Basic Auth token are redacted from tool output, tool errors, and logs, including their JSON-escaped and URL-encoded forms.
- Serialisation, back-off, and cache are keyed on the full credential set; the throttle on the tenant account plus its secret API key. No bucket is shared across accounts or keyed on the account name alone, so a caller with another tenant's account name cannot spend or observe its budget.
- Throttle and cache state is bounded: expired throttle keys are swept, the key count is capped, and every cache entry is charged at least 1 KiB, so caller-chosen keys cannot grow memory without limit.
- HTTP fails closed without a real `CONDUIT_S2S_SECRET` (32+ characters, no placeholders); `X-Conduit-Tool-Tiers` can only narrow the tool set (empty header = zero tools); 1 MiB request cap; listener defaults to 127.0.0.1.
- Dockerfile pins the base image by digest, installs with `npm ci --ignore-scripts`, runs as a non-root user, and bakes in no secret. CI uses `--ignore-scripts` and `persist-credentials: false`; release uses the pinned reusable workflow with `fail-on-severity: HIGH,CRITICAL`; gitleaks scans full history.
