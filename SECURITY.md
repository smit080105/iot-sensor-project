# Security Notes

This document covers what was hardened in this project, what you as the
operator still need to do, and the known limits of this setup so nobody
mistakes it for more than it is.

## What's enforced now

| Area | Before | Now |
|---|---|---|
| `/api/devices/upload` (CSV registry sync) | Open to anyone | Requires `x-api-key` header + rate limited (10 req / 15 min) |
| All other `/api/*` routes (except `/api/health`) | Open to anyone | Requires `x-api-key` header |
| WebSocket feed | Open to anyone | Requires `?apiKey=` query param on connect |
| API rate limiting | None | 120 req/min general, 10 req/15min on upload |
| CSV upload size/type | Unbounded, any file | Capped at 1MB, `.csv` only |
| CORS | Wildcard (`*`) | Locked to `ALLOWED_ORIGIN` only |
| HTTP security headers | None | `helmet` (CSP, HSTS, etc.) |
| MQTT transport | Plaintext (`mqtt://…:1883`) | TLS by default (`mqtts://…:8883`) |
| `PAIRING_TOKEN` | Hardcoded fallback (`"Shalaka"`) | Required, no fallback; warns if short |
| Postgres port | Published to host (`5432:5432`) | Internal Docker network only |
| `multer` (file upload lib) | v1.x (known CVEs) | v2.x, `npm audit`: 0 vulnerabilities |
| Secrets in this project | Real credentials committed in `.env` | Rotated; `.env` stays out of git via `.gitignore` |

## What you must do before/after deploying

1. **Treat every secret in this zip as already compromised** if it's been
   shared with anyone else — `PAIRING_TOKEN`, `API_KEY`, and
   `PGPASSWORD` were regenerated once already, but if you share this zip
   or a git history containing `.env` again, rotate them again.
2. **Set `ALLOWED_ORIGIN`** in `backend/.env` / `docker/.env` to your
   actual frontend URL. Requests from any other origin are blocked.
3. **Keep `API_KEY` identical** between `backend/.env` (`API_KEY`) and
   `frontend/.env` / `docker/.env` (`VITE_API_KEY`) — they're compared
   directly.
4. **Update the device side** (her script) with the new `PAIRING_TOKEN`
   — the old one no longer works and shouldn't be reused.
5. **Never commit `.env` files.** Only `.env.example` files (placeholders)
   should ever be shared or committed — this is already set up in
   `.gitignore`, just don't override it.
6. **Put TLS in front of the whole stack** before exposing this to the
   real internet (e.g. terminate HTTPS at nginx or a reverse proxy with
   a Let's Encrypt certificate). Right now nginx and the backend both
   still serve plain HTTP — the API-key header is not meaningfully
   secret if it travels over plaintext HTTP.

## Known limits — read this before calling it "fully secure"

- **The frontend's API key is not truly secret.** It's baked into the
  built JS bundle (`VITE_API_KEY`), so anyone who can view the
  dashboard's page source can read it. This stops random internet
  traffic and casual scanning from reaching your API, but it does not
  stop someone who already has access to the dashboard from also
  calling the API directly. For a personal or small-team project this
  is a reasonable trade-off; it is not enterprise-grade access control
  (that would need per-user login + short-lived tokens).
- **The MQTT broker is still shared and public.** TLS (`mqtts://`)
  protects the wire between each client and the broker, but any other
  client on `broker.emqx.io` can still subscribe to the same topic names
  and see your traffic. `PAIRING_TOKEN` is the only thing stopping
  impersonation, not topic secrecy. Long-term, move to a private broker
  with per-device credentials and ACLs.
- **One shared API key, not per-client credentials.** Fine for a single
  admin/operator; if multiple people manage this system, consider
  distinct credentials per person so access can be revoked individually.
- **No centralized secret management.** Secrets live in `.env` files.
  For anything beyond a small project, consider a secrets manager
  (Vault, AWS Secrets Manager, etc.) instead.
- **No audit logging beyond `docker logs`.** There's no persistent,
  queryable record of who uploaded which CSV or when. Consider adding
  structured logging (Winston/Pino) shipped to a log aggregator if this
  matters for your use case.

## Quick reference: generating secrets

```bash
# API_KEY / VITE_API_KEY (must match exactly)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# PAIRING_TOKEN
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"

# PGPASSWORD
node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
```
