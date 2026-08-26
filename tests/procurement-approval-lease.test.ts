import test from "node:test";
import assert from "node:assert/strict";
import {
  PROCUREMENT_APPROVAL_LEASE_MINUTES,
  PROCUREMENT_APPROVAL_LEASE_MS,
  evaluateProcurementApprovalLease,
} from "../src/lib/procurement-approval-lease";

test("procurement approval lease is valid only inside the 15 minute window", () => {
  const approvedAt = Date.UTC(2026, 7, 26, 12, 0, 0);
  const beforeExpiry = evaluateProcurementApprovalLease(
    new Date(approvedAt),
    approvedAt + PROCUREMENT_APPROVAL_LEASE_MS - 1,
  );
  assert.equal(PROCUREMENT_APPROVAL_LEASE_MINUTES, 15);
  assert.equal(beforeExpiry.valid, true);
  assert.equal(beforeExpiry.reason, null);
  assert.equal(beforeExpiry.remainingMs, 1);

  const atExpiry = evaluateProcurementApprovalLease(
    new Date(approvedAt),
    approvedAt + PROCUREMENT_APPROVAL_LEASE_MS,
  );
  assert.equal(atExpiry.valid, false);
  assert.equal(atExpiry.reason, "approval_lease_expired");
  assert.equal(atExpiry.remainingMs, 0);
});

test("missing and invalid approval timestamps fail closed", () => {
  assert.equal(evaluateProcurementApprovalLease(null, 1).reason, "approval_timestamp_missing_or_invalid");
  assert.equal(evaluateProcurementApprovalLease("not-a-date", 1).reason, "approval_timestamp_missing_or_invalid");
});

test("approval timestamps materially in the future fail closed", () => {
  const nowMs = Date.UTC(2026, 7, 26, 12, 0, 0);
  const decision = evaluateProcurementApprovalLease(new Date(nowMs + 6 * 60_000), nowMs);
  assert.equal(decision.valid, false);
  assert.equal(decision.reason, "approval_timestamp_in_future");
});

test("lease projection preserves exact approval and expiry timestamps", () => {
  const approvedAt = "2026-08-26T12:00:00.000Z";
  const decision = evaluateProcurementApprovalLease(approvedAt, Date.parse(approvedAt) + 60_000);
  assert.equal(decision.approvedAt, approvedAt);
  assert.equal(decision.expiresAt, "2026-08-26T12:15:00.000Z");
  assert.equal(decision.remainingMs, 14 * 60_000);
});
