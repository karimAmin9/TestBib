# Handoff

## Current Handoff
From: DevOps (phone-app) to SDE / Architect for implementation.
- Plan, architecture, risks and rollback: `.10x/decisions/devops/phone-app.md`
- Owner decisions: phone-only PWA, Android/Chrome, €0 without card, books only on the phone, no backups, no login,
  GitHub Pages (public repo), retire the server only after the app works on the phone.
- Start with **Phase 0 (spike)**: it decides whether phone performance is acceptable before any refactoring.
  Installing the `wasm-tools` workload (AOT) needs the owner's OK.
- The server stack keeps running untouched until Phase 5: `docker compose --profile full up -d`, http://127.0.0.1:8080.
- Owner actions later: enable GitHub Pages (Source: GitHub Actions), approve pushes, install the app on the phone.

## History
### 2026-10-13: DevOps (local-hosting) to SRE / the owner
- Decisions: `.10x/decisions/devops/local-hosting.md`. Stack on the owner's PC at 127.0.0.1:8080, verified.
- Tailscale was never set up: superseded by phone-app the same day.

### 2026-10-12: DevOps/SRE to the next feature work
- Runbook: `.10x/decisions/sre/pdf-reader.md`
- Deploy: README "Deployment" + `.10x/decisions/devops/pdf-reader.md`
- Open items: CI pipeline, TLS proxy, strong DB password, container limits, email verification or closed registration.
- Candidate next features (PM backlog): search and tags, OCR for scanned PDFs, smarter chapters (PDF outline/bookmarks), EPUB import.
