# Handoff

## Current Handoff
From: DevOps (phone-app Phase 0 spike) to SDE / Architect for Phase 1.
- Plan, architecture, risks and rollback: `.10x/decisions/devops/phone-app.md`
- Spike result **GO**: `.10x/reviews/2026-10-13-phone-app-spike.md`; reusable code and benchmark in `spikes/wasm-engine/`
  (worker loading, `[JSImport]` NFKC, DevTools-throttled benchmark).
- Phase 1 must include: `Bib.Conversion` library; replaceable NFKC in `TextNormalizer`; source-generated JSON in
  `ConversionJson`. All 84 backend tests stay green; re-run `node spikes/wasm-engine/bench.mjs` as a regression check.
- Owner decisions: phone-only PWA, Android/Chrome, €0 without card, books only on the phone, no backups, no login,
  GitHub Pages (public repo), retire the server only after the app works on the phone.
- AOT (`wasm-tools` workload) is optional and needs the owner's OK before installing.
- The server stack keeps running untouched until Phase 5: `docker compose --profile full up -d`, http://127.0.0.1:8080.
- Owner actions later: enable GitHub Pages (Source: GitHub Actions), approve pushes, install the app on the phone.

## History
### 2026-10-13: DevOps (phone-app plan) to SDE / Architect
- Plan agreed; Phase 0 (spike) first. Superseded by the spike handoff above.

## History
### 2026-10-13: DevOps (local-hosting) to SRE / the owner
- Decisions: `.10x/decisions/devops/local-hosting.md`. Stack on the owner's PC at 127.0.0.1:8080, verified.
- Tailscale was never set up: superseded by phone-app the same day.

### 2026-10-12: DevOps/SRE to the next feature work
- Runbook: `.10x/decisions/sre/pdf-reader.md`
- Deploy: README "Deployment" + `.10x/decisions/devops/pdf-reader.md`
- Open items: CI pipeline, TLS proxy, strong DB password, container limits, email verification or closed registration.
- Candidate next features (PM backlog): search and tags, OCR for scanned PDFs, smarter chapters (PDF outline/bookmarks), EPUB import.
