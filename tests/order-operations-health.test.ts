import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateOrderOperationsHealth,
  orderOperationsAlertFingerprint,
} from "../src/lib/order-operations-health";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-08-23T04:00:00.000Z");

test("non-paid orders are never actionable operations alerts", () => {
  const result = evaluateOrderOperationsHealth({
    financialStatus: "refunded",
    fulfillmentState: "awaiting_sourcing",
    paidAtMs: NOW - 100 * HOUR,
    stateEnteredAtMs: null,
    nowMs: NOW,
  });
  assert.equal(result.actionable, false);
  assert.equal(result.severity, "blocked");
  assert.equal(result.reason, "FINANCIAL_NOT_PAID");
});

test("newly paid awaiting-sourcing order is on track", () => {
  const result = evaluateOrderOperationsHealth({
    financialStatus: "paid",
    fulfillmentState: "awaiting_sourcing",
    paidAtMs: NOW - HOUR,
    stateEnteredAtMs: null,
    nowMs: NOW,
  });
  assert.equal(result.severity, "healthy");
  assert.equal(result.reason, "ON_TRACK");
});

test("awaiting-sourcing order warns after two hours and becomes critical after six", () => {
  const warning = evaluateOrderOperationsHealth({
    financialStatus: "paid",
    fulfillmentState: "awaiting_sourcing",
    paidAtMs: NOW - 3 * HOUR,
    stateEnteredAtMs: null,
    nowMs: NOW,
  });
  const critical = evaluateOrderOperationsHealth({
    financialStatus: "paid",
    fulfillmentState: "awaiting_sourcing",
    paidAtMs: NOW - 7 * HOUR,
    stateEnteredAtMs: null,
    nowMs: NOW,
  });
  assert.equal(warning.severity, "warning");
  assert.equal(warning.reason, "AWAITING_SOURCING_OVERDUE");
  assert.equal(critical.severity, "critical");
  assert.equal(critical.reason, "AWAITING_SOURCING_OVERDUE");
});

test("supplier-ordered and shipped aging use their stage entry time", () => {
  const supplierOrdered = evaluateOrderOperationsHealth({
    financialStatus: "paid",
    fulfillmentState: "supplier_ordered",
    paidAtMs: NOW - 10 * DAY,
    stateEnteredAtMs: NOW - 4 * DAY,
    nowMs: NOW,
  });
  const shipped = evaluateOrderOperationsHealth({
    financialStatus: "paid",
    fulfillmentState: "shipped",
    paidAtMs: NOW - 20 * DAY,
    stateEnteredAtMs: NOW - 6 * DAY,
    nowMs: NOW,
  });
  assert.equal(supplierOrdered.severity, "critical");
  assert.equal(supplierOrdered.reason, "SUPPLIER_ORDERED_OVERDUE");
  assert.equal(shipped.severity, "warning");
  assert.equal(shipped.reason, "SHIPMENT_STALE");
});

test("delivered orders are complete and not actionable", () => {
  const result = evaluateOrderOperationsHealth({
    financialStatus: "paid",
    fulfillmentState: "delivered",
    paidAtMs: NOW - DAY,
    stateEnteredAtMs: NOW - HOUR,
    nowMs: NOW,
  });
  assert.equal(result.actionable, false);
  assert.equal(result.severity, "complete");
  assert.equal(result.reason, "ORDER_COMPLETE");
});

test("missing stage timestamp fails closed", () => {
  const result = evaluateOrderOperationsHealth({
    financialStatus: "paid",
    fulfillmentState: "sourcing",
    paidAtMs: NOW - HOUR,
    stateEnteredAtMs: null,
    nowMs: NOW,
  });
  assert.equal(result.severity, "critical");
  assert.equal(result.reason, "STATE_TIMESTAMP_MISSING");
});

test("alert fingerprint changes on severity or stage entry", () => {
  const warning = orderOperationsAlertFingerprint({
    fulfillmentState: "sourcing",
    severity: "warning",
    reason: "SOURCING_OVERDUE",
    stateEnteredAtMs: NOW - 7 * HOUR,
  });
  const critical = orderOperationsAlertFingerprint({
    fulfillmentState: "sourcing",
    severity: "critical",
    reason: "SOURCING_OVERDUE",
    stateEnteredAtMs: NOW - 7 * HOUR,
  });
  const newStageEntry = orderOperationsAlertFingerprint({
    fulfillmentState: "sourcing",
    severity: "warning",
    reason: "SOURCING_OVERDUE",
    stateEnteredAtMs: NOW - 6 * HOUR,
  });
  assert.notEqual(warning, critical);
  assert.notEqual(warning, newStageEntry);
});
