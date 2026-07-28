# Frontend Docker Healthcheck IPv6/localhost Fix — Spec

## Current State Analysis

`frontend/Dockerfile` defines:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/nginx-health
```

`frontend/nginx.conf` only declares IPv4 listeners:

```nginx
server {
    listen 80;
    ...
}
server {
    listen 443 ssl;
    ...
}
```

Diagnosed live on the production server (`schoolworks.ocboe.com`, 2026-07-27/28) during an SSL
renewal incident:

- `docker compose exec frontend wget -qO- http://localhost:80/nginx-health` → `Connection refused`
- `docker compose exec frontend wget -qO- http://127.0.0.1:80/nginx-health` → `healthy`
- `nginx -t` → config syntax OK

Root cause: inside the container, `localhost` resolves to `::1` before `127.0.0.1`. Since nginx
only binds IPv4 (`listen 80;` / `listen 443 ssl;`, no `[::]:` variants), the IPv6 loopback
connection is refused. Docker's `HEALTHCHECK` uses the same `http://localhost:80/...` URL, so it
has been failing the same way — the `frontend` container has been permanently reported
`unhealthy` even though it correctly serves real IPv4/external traffic (Docker's host-side port
publishing on `0.0.0.0`/`[::]` NATs external connections down to the container's IPv4 socket
regardless, so external users were never affected).

## Problem

`docker-compose.yml`'s `certbot` service declares:

```yaml
certbot:
  depends_on:
    frontend:
      condition: service_healthy
```

Because `frontend` never reports healthy, `certbot` (the long-running 12h auto-renewal loop) has
never been able to start on `docker compose up`. This silently disabled Let's Encrypt
auto-renewal and directly caused a same-day cert expiry incident.

## Proposed Solution

Minimal, surgical fix: change the `HEALTHCHECK` CMD in `frontend/Dockerfile` to probe
`127.0.0.1` instead of `localhost`, removing the IPv6-resolution ambiguity. Do not add IPv6
`listen` directives to `nginx.conf` — that's a larger surface change with no evidence it's
needed (external IPv6 clients are already served correctly via Docker's port-publishing NAT;
nginx itself never needs to bind IPv6 for that to work).

### Implementation Steps

1. Edit `frontend/Dockerfile`: change
   `CMD wget --no-verbose --tries=1 --spider http://localhost:80/nginx-health`
   to
   `CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:80/nginx-health`
2. No other files change. No new dependencies. No schema/config changes.

## Dependencies

None — no new libraries, no version-sensitive APIs involved (plain `wget`/Docker HEALTHCHECK
syntax, unchanged from current usage).

## Risks and Mitigations

- **Risk:** none identified for this change in isolation — it only affects which loopback
  address the in-container healthcheck probes.
- **Mitigation/validation:** rebuild the frontend image locally via
  `docker compose -f docker-compose.dev.yml build frontend` (Phase 6 preflight) to confirm the
  image still builds; the actual healthy/unhealthy behavior fix itself can only be observed after
  the fixed image is deployed to production (out of scope for this local repo change — deployment
  is the user's decision per project constraints).
