# Security review: pdf-reader (2026-10-12)

## Threat model (STRIDE, condensed)
| Asset / entry point | Threat | Mitigation | Status |
|---|---|---|---|
| Accounts (`/api/auth/*`) | Credential stuffing, brute force | Identity lockout after 10 attempts; per-IP rate limit of 20/min (429) | ✅ tested |
| Session cookie | Theft via XSS | HttpOnly, no token in JS; Angular interpolation only, no innerHTML (XSS test in reader spec) | ✅ |
| Session cookie | CSRF | SameSite=Strict, JSON APIs; antiforgery deliberately disabled on the upload endpoint (ADR-002) | ✅ (requires same origin) |
| Books (IDOR) | Read or modify another user's books | Every query goes through `OwnedBy(userId)`; non-owned books return 404 | ✅ integration-tested on all 8 endpoints |
| Image endpoint | Path traversal | Strict filename regex `^p\d+-(\d+\|page)\.(png\|jpg)$` | ✅ tested |
| Upload | Malicious or huge files | `%PDF-` magic check, 100 MB limit, GUID paths, original name used only as display text, 30 uploads/h per user | ✅ |
| PDF parsers (PdfPig managed, PDFium native) | Parser DoS or memory corruption from crafted PDFs | Background worker (not the request thread), 5,000-page cap, container runs as non-root `app` user, errors mapped to "Failed" | ⚠ residual risk (finding 3) |
| Content sniffing | A crafted file served as HTML | Fixed content types; `X-Content-Type-Options: nosniff` (API and nginx) | ✅ |
| Clickjacking | Framing | `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'` | ✅ |
| Dependencies | Known CVEs | `dotnet list package --vulnerable`: none; `npm audit`: 0 | ✅ (2026-10-12) |

## Findings: required before public deployment
1. **Set a strong `POSTGRES_PASSWORD`.** Compose falls back to the dev password if it's unset. Don't publish port 5432 in production: remove the `ports:` mapping or bind it to 127.0.0.1.
2. **Serve over HTTPS only**, behind a TLS proxy. Cookies become `Secure` via `X-Forwarded-Proto`. Never expose the API container directly: forwarded headers are trusted from any source (`KnownIPNetworks` is cleared), on the assumption that only nginx can reach the API.
3. **PDF parsing residual risk.** PDFium is native code that processes untrusted input. Recommended hardening:
   - set container memory and CPU limits (`deploy.resources.limits`)
   - keep Docnet/PDFium updated
   - optionally move processing into a separate, low-privilege worker container
4. **Data-protection keys** are stored unencrypted on the data volume. Protect the volume, or use `ProtectKeysWith*` / a key vault when moving to the cloud.
5. **No email verification or reset.** Email addresses aren't verified, and there's no password-reset email (Identity uses a no-op sender). That's acceptable for private use. Before opening registration to the public, add an email sender, or disable `/register` once your accounts exist.
6. **CSP allows `style-src 'unsafe-inline'`**, which Angular component styles need. Acceptable, since scripts are restricted to `'self'`.

## Secrets
- No production secrets in the repo. `appsettings.Development.json` and `docs/dev-test-accounts.md` hold local-only dev credentials and are clearly labelled.
