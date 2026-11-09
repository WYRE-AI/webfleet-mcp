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
- Client-side protection for Webfleet's request limits: per-account and per-API-key throttle per action, per-user request serialisation (error 8015), and a one-interval response cache per exact credential set and request.
- Vendor errors surface the HTTP status, the WEBFLEET.connect response code, the vendor message, and a hint for actionable codes. "No data" (63, 9198) is an empty list.

### Changed

- `webfleet_objects_list` no longer takes `report`; vehicles moved to their own `webfleet_vehicles_list` (`showVehicleReportExtern`).
- `webfleet_raw_request` accepts only the fixed allowlist of read actions instead of the `show*`/`get*`/`pop*`/`geocode*`/`calc*`/`download*` prefixes. `pop*` consumed messages from a shared queue.
- License is MIT, matching the WYRE MCP fleet (the scaffold's Apache-2.0 text was modified and not the canonical license).

### Removed

- The `x-webfleet-host`/`WEBFLEET_HOST` and `x-webfleet-lang`/`WEBFLEET_LANG` overrides. The host is fixed at `csv.webfleet.com` and `lang` is always `en`.
- The `externalid` parameter, which the reference marks "for future use".

### Security

- Fixed upstream endpoint `https://csv.webfleet.com/extern`; no base-URL or host input exists, and the built URL is checked against it.
- Username and password are sent only as HTTP Basic Auth; reserved and credential parameter names are refused in any case.
- Redirects are never followed (`redirect: "manual"`; any 3xx is an error). Upstream bodies are capped at 4 MiB while streaming.
- Gateway mode (`AUTH_MODE=gateway`, the image default) reads the connection only from `X-Webfleet-Account`, `X-Webfleet-Username`, `X-Webfleet-Password`, and `X-Webfleet-Api-Key`, requires all four, and never reads the environment; the process is locked to gateway mode once the HTTP server starts.
- The password, API key, and Basic Auth token are redacted from tool output, tool errors, and logs.
- HTTP fails closed without a real `CONDUIT_S2S_SECRET` (32+ characters, no placeholders); `X-Conduit-Tool-Tiers` can only narrow the tool set (empty header = zero tools); 1 MiB request cap; listener defaults to 127.0.0.1.
- Dockerfile pins the base image by digest, installs with `npm ci --ignore-scripts`, runs as a non-root user, and bakes in no secret. CI uses `--ignore-scripts` and `persist-credentials: false`; release uses the pinned reusable workflow with `fail-on-severity: HIGH,CRITICAL`; gitleaks scans full history.
