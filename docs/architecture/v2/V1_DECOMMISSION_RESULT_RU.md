# HolyMedia MCP V1 Decommission Result

Decommission timestamp: `2026-08-23T16:01:11Z`

## Final state

- V2 image: `ghcr.io/mcpforge-dev/holymedia-mcp-v2:sha-0821907ed669eb96a1a7d1ab4b4ae894dc11dc47`.
- V2 production configuration commit: `346ea45`.
- V1 commit: `c700fb7cf46884ad91bf4f8edc7b723a673f1446`.
- Public hostname, DNS, TLS and OAuth callback contracts were unchanged.
- V2 remained the only public runtime behind Nginx.

## V1 archive

Final archive:
`/var/backups/adforge-mcp/v1-decommission-20260823T155459Z`

The archive contains the fresh V1 PostgreSQL dump, V1 source/runtime archive,
V1 storage, V1 configuration, live and staging unit definitions, the immutable
V1 Nginx rollback configuration, a manifest and SHA-256 checksums. Checksum
verification and read/restore-list checks passed. V1 source, data and
configuration remain preserved; only archived disposable production `.venv`
and `.cache` directories were removed from the active filesystem.

Retained backups:

- `/var/backups/adforge-mcp/phase-c-20260822T204959Z`
- `/var/backups/adforge-mcp/post-cutover-v2-20260822T214700Z`
- `/var/backups/adforge-mcp/v1-decommission-20260823T155459Z`

## Controlled shutdown

The following V1 live and staging units are inactive and disabled:

- `adforge-mcp-web.service`
- `adforge-mcp-http.service`
- `adforge-mcp-staging-web.service`
- `adforge-mcp-staging-http.service`

V1 ports `8765`, `8766`, `18765` and `18766` are closed. V1 autostart is
disabled. Nginx contains V2 loopback upstreams only; no V1 upstream reference
remains in the active configuration. `nginx -t` passed.

## Post-decommission smoke

- Public `/health`: `200`.
- Public `/ready`: `200`.
- Public `/mcp` without credentials: `401`.
- V2 PostgreSQL, Redis, API, Web and Worker: healthy.
- Compatibility route smoke: passed.
- Browser desktop/mobile smoke: passed.
- Meta read smoke: passed; no provider writes were executed.
- Yandex/TikTok: V1-compatible OAuth/discovery capability preserved.
- Google: `N/A - no production connection`.
- OOM events in the checked window: `0`.
- Sensitive log markers in the checked V2 logs: `0`.
- Critical findings: `0`.
- High findings: `0`.

## Disk and retained recovery state

Decommission cleanup increased free space from approximately `2.8 GB` to
`4.3 GB` (`86%` to `78%` used). Removed items were limited to the archived
production V1 Python virtual environment and cache. PostgreSQL and Redis data,
V2 images, V1 source/data/configuration, encryption material, all listed
backups and rollback documentation were retained.

Telegram Hermes real E2E remains `DEFERRED BY PROJECT DECISION`. Payment
gateway and extended Yandex/TikTok reporting remain outside this operation.

## Verdict

**V1 DECOMMISSION COMPLETE**

**HOLYMEDIA MCP V2 FULLY PRODUCTION**

