# Handoff

## Current Handoff
From: DevOps (local-hosting) to SRE / the owner.
- Decisions, operations and runbook additions: `.10x/decisions/devops/local-hosting.md`
- Environment: owner's Windows PC, Docker Desktop, project `testbib`, http://127.0.0.1:8080 (volumes `testbib_pgdata`, `testbib_bookdata`).
- Deploy/update: `docker compose --profile full up -d --build`. Rollback: previous commit, same command.
- Pending (owner): install Tailscale on PC and phone, enable MagicDNS + HTTPS certificates, then
  `tailscale serve --bg http://127.0.0.1:8080`. Also enable Docker Desktop "Start when you sign in" and stop the PC from sleeping.
- No backups by the owner's decision: `down -v` or Docker "Reset to factory defaults" loses all books.
- SRE: fold the local-hosting runbook lines into `.10x/decisions/sre/pdf-reader.md` when the setup is final.

## History
### 2026-10-12: DevOps/SRE to the next feature work
- Runbook: `.10x/decisions/sre/pdf-reader.md`
- Deploy: README "Deployment" + `.10x/decisions/devops/pdf-reader.md`
- Open items: CI pipeline, TLS proxy, strong DB password, container limits, email verification or closed registration.
- Candidate next features (PM backlog): search and tags, OCR for scanned PDFs, smarter chapters (PDF outline/bookmarks), EPUB import.
