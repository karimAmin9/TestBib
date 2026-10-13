# local-hosting: run on the owner's PC, private access from the phone

**Date:** 2026-10-13 · **Status:** stack deployed and verified locally; Tailscale setup pending (owner)

## Requirements (from the owner)
- Single user (owner only). Use the site from the phone, from anywhere.
- €0 budget. Keep the books on the PC. **No backups** (owner's explicit choice).

## Decision
Run the production stack (`docker compose --profile full`) on the owner's Windows PC under Docker Desktop.
Reach it privately via **Tailscale** (free personal plan): `tailscale serve --bg http://127.0.0.1:8080`
→ `https://<pc-name>.<tailnet>.ts.net`, valid HTTPS cert, only reachable by the owner's tailnet devices.
One database on one machine, so data is the same on every device by construction.

## Alternatives considered
| Option | Why not |
|---|---|
| Oracle Cloud Always Free (ARM VM) + Tailscale | €0 and 24/7, PDFium ships linux-arm64. Declined: owner prefers no cloud account. Easiest upgrade path if availability becomes a problem. |
| Paid VPS (~€4–5/mo) | Declined: cost. |
| Free PaaS tiers (Render, Railway, …) | Unsuitable: free DBs expire or sleep, no persistent disk for uploaded files. |

## Changes (2026-10-13)
- `docker-compose.yml`: `restart: unless-stopped` on all services; `web` and `postgres` ports bound to `127.0.0.1`
  (this PC's NIC has a public-looking address 193.170.x.x, so 0.0.0.0 bindings were a real exposure risk).
- `backend/.dockerignore`: exclude dev runtime files (`Bib.Api/Data/books`, `Bib.Api/Data/keys`). On Windows these
  live inside the `Data/` source folder.
- README: "On your own PC, reachable from your phone (Tailscale)".

## Verified (2026-10-13)
Images built; `/health` 200 on 127.0.0.1:8080; not reachable via the LAN address. Through nginx: register, login,
upload, conversion (Ready, Verified), chapter, image, cover, delete. Test account removed afterwards: DB empty.
Dev mode (`dotnet run`, DB `bib_dev`) still connects with Postgres on 127.0.0.1.

## Security review findings vs. this setup
- TLS: Tailscale HTTPS (+ WireGuard). API not exposed; Postgres on localhost only.
- Default DB password: accepted, Postgres is reachable only from this PC.
- Open registration: accepted, the site is reachable only from the owner's tailnet.
- Container limits: not set; Docker Desktop's VM caps memory. Revisit if a big PDF starves the PC.

## Operations
- Update: `docker compose --profile full up -d --build`. Rollback: check out the previous commit, same command.
- Stop: `docker compose --profile full down`. **Never `-v`**, never Docker Desktop "Reset to factory defaults":
  both delete `testbib_pgdata` / `testbib_bookdata`, i.e. all books, with no backup to restore from.
- Availability limits: down while the PC is off, asleep, or not signed in (Docker Desktop starts at sign-in).
- Docker Desktop crash "remove …\*.sock: The file cannot be accessed by the system": quit Docker, rename
  `%LOCALAPPDATA%\Docker\run` and `%LOCALAPPDATA%\docker-secrets-engine`, start again. Avoid force-killing Docker.
- Benign log lines on API start: `libgssapi_krb5.so.2` (Npgsql Kerberos probe), and a failed
  `__EFMigrationsHistory` select on a brand-new database.
