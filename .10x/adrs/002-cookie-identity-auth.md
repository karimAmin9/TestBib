# ADR-002: ASP.NET Core Identity with cookie auth

**Status:** Accepted
**Date:** 2026-10-12
**Feature:** pdf-reader
**Author:** 10x-Team (Architect + Security)

## Context
Multiple users with private libraries. SPA and API will be served from the same origin (dev proxy, nginx in prod).

## Decision
ASP.NET Core Identity (`MapIdentityApi`) backed by EF Core/Postgres, cookie auth only (HttpOnly, SameSite=Strict, Secure in prod). Every book query filters by OwnerId; non-owned resources return 404.

## Alternatives Considered
| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| JWT bearer in localStorage | Stateless, cross-origin | XSS token theft, refresh logic | Same-origin makes cookies simpler + safer |
| External IdP (Auth0/Entra) | No password storage | External dependency, cost | Overkill for v1 |

## Consequences
- Positive: no token handling in Angular; CSRF mitigated by SameSite=Strict + JSON-only APIs.
- Negative: API not usable cross-origin without changes.
- Risks: if ever served cross-site, add antiforgery tokens.

## Dependencies
- Requires same-origin deployment (nginx reverse proxy).
