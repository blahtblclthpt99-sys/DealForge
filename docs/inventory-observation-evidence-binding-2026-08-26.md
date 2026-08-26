# Inventory Observation Evidence-Binding Contract

Date: 2026-08-26

## Purpose

Bind direct-resale commercialization and immutable order source snapshots to the exact current inventory observation that justified the selected persisted supplier offer.

## Contract

A production commerce-eligible selected supplier offer must have a latest InventoryObservation that:

- belongs to the exact persisted supplier offer;
- is current, not aging/stale/invalid;
- reports `in_stock`;
- meets the canonical inventory confidence floor;
- does not report quantity zero;
- is not sourced from a paused/blocked source-health state;
- does not contradict the persisted supplier item cost when an observed price is present.

The immutable evidence binding contains the deterministic observation idempotency key, exact offer id, timestamps, availability, quantity, confidence, optional observed price, verification method, source health, and a SHA-256 provenance hash. Raw provenance is deliberately not copied into the order snapshot.

## Race behavior

When a newer observation is applied for the currently bound persisted offer, Product metadata is refreshed with the new evidence binding. Any checkout that already locked an older supplier snapshot will therefore fail the existing exact snapshot revalidation and must restart before Stripe Checkout creation.

Negative evidence remains monotonic-safe: it can demote commerce but can never enable commerce or execute procurement.

## Runtime gate

Production Cloudflare runtime explicitly sets:

`INVENTORY_EVIDENCE_BINDING_REQUIRED=true`

Legacy unit fixtures remain readable when this flag is absent so the rollout does not reinterpret historical non-production snapshots.

## Non-goals

This change does not:

- enable broad commerce;
- enable automatic procurement;
- create supplier purchases;
- alter Stripe tax/legal readiness;
- infer inventory without a persisted observation;
- fabricate supplier price, quantity, provenance, or availability evidence.
