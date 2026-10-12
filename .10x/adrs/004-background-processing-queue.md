# ADR-004: In-process background queue for PDF processing

**Status:** Accepted
**Date:** 2026-10-12
**Feature:** pdf-reader

## Context
Large PDFs take seconds to minutes to convert; uploads must not block the HTTP request.

## Decision
Upload returns 202 with Book.Status=Processing; book id goes into a bounded `Channel<Guid>`; `BookProcessingWorker` (BackgroundService) runs processor → verifier. On startup, books still in Processing are re-enqueued. Frontend polls.

## Alternatives Considered
| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| Synchronous processing | Simplest | Request timeouts | Bad UX for big PDFs |
| Hangfire / RabbitMQ | Durable, scalable | Extra infra | Single instance suffices for v1 |

## Consequences
- Single API instance only; restart re-enqueue covers crashes. Move to a real queue when scaling horizontally.
