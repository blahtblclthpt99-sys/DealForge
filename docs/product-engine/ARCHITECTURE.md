# DealForge Product Engine

Status: implementation baseline

## Purpose
Build a compliant, owner-controlled product intake pipeline that does not depend on Amazon Creators API access and never scrapes Amazon product pages.

## Pipeline
1. Scout A — discover candidate products/ASIN references from permitted public sources.
2. Scout B — independent discovery partition for coverage.
3. Validator/Scorer — validate ASIN syntax, source provenance, completeness, duplicates, and acceptance score.
4. Classifier — normalize taxonomy and suppress variation spam.
5. Publisher — single production writer; idempotent ASIN upsert only.

Workers are logical stages with bounded concurrency, not five permanently running servers.

## Hard rules
- Never scrape or automate Amazon product pages.
- Never fabricate or imply a live Amazon price, availability, discount, rating, or review count without an authorized source.
- Without authorized price data, render `Check current price on Amazon`.
- Never generate artificial affiliate clicks. Outbound navigation requires an explicit user action.
- Preserve the configured Associates tracking tag/Special Link.
- Publisher is the only stage with catalog-write authority.
- Every candidate retains provenance and audit metadata.
- Duplicate ASINs are upserted, never blindly inserted.
- Owner can pause the entire pipeline.

## Owner console
Route: `/admin/product-engine`.

Authorization must be enforced server-side for both the page and all backing actions. Hidden navigation is not authorization.

Dashboard requirements:
- stage health and last heartbeat
- discovered / pending / validated / classified / published / rejected counts
- category distribution
- rejection and duplicate reasons
- last run and last successful publication
- activity/audit history
- Run Discovery / Pause / Resume / Review / Publish controls

## Candidate lifecycle
`discovered -> validating -> validated -> classified -> approved -> published`

Terminal/side states: `rejected`, `dead_letter`, `duplicate`, `paused`.

Recommended candidate fields:
- id
- asin
- sourceType
- sourceUrl
- sourceObservedAt
- titleCandidate
- categoryCandidate
- normalizedCategory
- ownerSpecialLink
- score
- state
- rejectionReason
- attemptCount
- nextAttemptAt
- createdAt / updatedAt
- publishedProductId

## Reliability
- bounded scout concurrency
- exponential retry/backoff
- maximum attempts and dead-letter state
- ASIN-level idempotency/locking
- category quotas
- configurable acceptance threshold
- master pause/kill switch
- structured audit log for every state transition

## Provider abstraction
Discovery and enrichment must sit behind provider interfaces. A future authorized Amazon Creators API provider can be added without changing validation, classification, publishing, or the owner console.

## Existing worker safety correction
The legacy background worker currently contains direct Amazon HTML price scraping. That behavior must be removed before this Product Engine is considered compliant. Existing maintenance tasks (trending, flash expiry, cache cleanup) can remain. Price alerts must not treat an unverified/stale Amazon price as current.

## Release gate
Required tests:
- owner authorization / unauthorized denial
- malformed ASIN rejection
- provenance requirement
- duplicate/idempotent ingestion
- classifier behavior
- single-writer publishing
- stale/unverified price suppression
- affiliate tag preservation
- explicit-user-action outbound linking
- pause/kill switch
- retries/dead-letter behavior
- mobile owner-console rendering

Run lint, typecheck, unit/integration tests, build, and existing Worker smoke/security certification before merge/deploy.
