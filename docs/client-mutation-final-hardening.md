# DealForge client mutation final hardening

This branch carries the final client-owned mutation integrity fixes recovered from the superseded PR #86 and rebased onto current production main.

Scope:
- settings submits only client-owned `emailAlerts` state instead of replaying the full legacy settings object
- duplicate submit prevention and explicit network/server failure state
- saved-search deletion refreshes only after confirmed success
- price-alert creation validates finite positive bounded targets before dispatch
- price-alert create/delete operations handle network/server failure and duplicate clicks

No commerce, Stripe, procurement, database schema, or tax release behavior is changed by this slice.
