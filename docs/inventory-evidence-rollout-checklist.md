# Inventory evidence rollout checklist

- [x] Exact persisted-offer identity bound.
- [x] Current freshness required for production commercialization.
- [x] Inventory confidence floor enforced.
- [x] Optional observed supplier price cannot contradict persisted item cost.
- [x] Provenance represented by SHA-256 hash in immutable order evidence.
- [x] New observations refresh bound Product metadata, invalidating older checkout snapshots.
- [x] Positive inventory automation never enables commerce.
- [x] Production runtime explicitly requires evidence binding.
- [ ] Merge only after Commerce CI, Product Engine CI, and Cloudflare Workers Dry Run pass on the exact PR head.
- [ ] Verify the exact merge SHA through the production deployment and live-route smoke workflow.
