# DealForge Product Engine

Status: implementation complete; release verification in progress

## Purpose
Build a compliant, owner-controlled product intake pipeline that does not depend on Amazon Creators API access and never scrapes Amazon product pages.

## Pipeline
1. Scout A — accept candidate products/ASIN references from permitted public sources or owner intake.
2. Scout B — independent intake partition for coverage.
3. Validator/Scorer — validate ASIN syntax, source provenance, completeness, duplicates, variation protection, and acceptance score.
4. Classifier — normalize taxonomy and enforce category policy.
5. Publisher — single production writer; idempotent ASIN publication only.

Workers are logical stages with bounded concurrency, not five permanently running servers.

## Hard rules
- Never scrape or automate Amazon product pages.
- Never fabricate or imply a live Amazon price, availability, discount, rating, or review count without an authorized source.
- Without authorized price data, render `Check current price on Amazon`.
- Never generate artificial affiliate clicks. Outbound navigation requires an explicit user action.
- Preserve the configured Associates tracking tag/Special Link.
- Publisher is the only Product Engine stage with catalog-write authority.
- Every candidate retains provenance and audit metadata.
- Duplicate ASIN ingestion is idempotent and race-safe.
- Owner can pause the entire pipeline.

## Owner console
Route: `/admin/product-engine`.

Authorization is enforced server-side for both the page and all backing actions. The route fails closed unless the authenticated database user is an admin and matches `PRODUCT_ENGINE_OWNER_EMAIL`.

Dashboard exposes:
- Scout A / Scout B / Validator / Classifier / Publisher health
- discovered / pending / validated / classified / published / rejected / dead-letter / duplicate counts
- category distribution and rejection reasons
- last run and last successful publication
- activity/audit history
- Run Discovery / Pause / Resume / Review / Publish / Retry controls

## Candidate lifecycle
`discovered -> validating -> validated -> classified -> approved -> published`

Terminal/side states: `rejected`, `dead_letter`, `duplicate`, `paused`.

## Reliability and integrity
- ASIN-level idempotency and unique constraints
- bounded worker concurrency and bounded batch size
- exponential retry/backoff and maximum attempts
- dead-letter handling and owner retry
- category quotas and configurable acceptance threshold
- variation-spam protection
- master pause/kill switch
- structured audit log for state transitions and owner actions
- source URL validation; Product Engine discovery URLs are recorded but never server-fetched
- conservative Amazon claim provenance with current-price fallback behavior

## Provider abstraction
Discovery and enrichment sit behind compliant intake semantics. A future authorized Amazon provider can be added without changing validation, classification, publishing, or the owner console. No current implementation circumvents Amazon account/API eligibility restrictions.

## Migration strategy
The repository previously had no Prisma migration history. `20260822000000_dealforge_baseline` records the existing DealForge schema. Existing databases mark that baseline as applied, then deploy `20260822102000_product_engine_safe_intake`. New databases can apply both migrations normally. CI exercises both paths.

## Release gate
Required verification includes:
- locked dependency install and production dependency security audit
- lint and TypeScript typecheck
- SQLite and PostgreSQL Prisma schema validation
- clean PostgreSQL migration chain
- existing-database baseline + Product Engine migration path
- complete tests and explicit Product Engine tests
- production build
- release gate regression rerun

Merge/deploy remains blocked until these gates and external required checks are green.
