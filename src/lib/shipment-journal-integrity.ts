import { parseShipmentEventDetail, type ShipmentRecordedV1 } from "./shipment-tracking";

export type ShipmentJournalIntegrityReason =
  | "shipment_event_missing"
  | "shipment_event_duplicate"
  | "shipment_event_invalid"
  | "shipment_quantity_mismatch"
  | "shipment_purchase_evidence_missing"
  | "shipment_purchase_evidence_mismatch";

type ShipmentJournalEvent = {
  eventKey: string;
  detail: string;
};

export type ShipmentJournalIntegrityResult = {
  ok: boolean;
  reasons: ShipmentJournalIntegrityReason[];
  shipment: ShipmentRecordedV1 | null;
  purchaseEvidenceHash: string | null;
};

function uniqueReasons(reasons: ShipmentJournalIntegrityReason[]) {
  return [...new Set(reasons)];
}

function readPurchaseEvidenceHash(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed.purchaseEvidenceHash;
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) return null;
    return value.toLowerCase();
  } catch {
    return null;
  }
}

export function reconcileShipmentJournal(input: {
  events: ShipmentJournalEvent[];
  expectedPurchaseEvidenceHash: string;
  expectedQuantity: number;
}): ShipmentJournalIntegrityResult {
  const reasons: ShipmentJournalIntegrityReason[] = [];

  if (input.events.length === 0) {
    return {
      ok: false,
      reasons: ["shipment_event_missing"],
      shipment: null,
      purchaseEvidenceHash: null,
    };
  }
  if (input.events.length !== 1) reasons.push("shipment_event_duplicate");

  const event = input.events[0];
  const shipment = parseShipmentEventDetail(event.detail);
  if (!shipment) {
    reasons.push("shipment_event_invalid");
    return {
      ok: false,
      reasons: uniqueReasons(reasons),
      shipment: null,
      purchaseEvidenceHash: readPurchaseEvidenceHash(event.detail),
    };
  }

  if (shipment.quantity !== input.expectedQuantity) reasons.push("shipment_quantity_mismatch");

  const purchaseEvidenceHash = readPurchaseEvidenceHash(event.detail);
  if (!purchaseEvidenceHash) {
    reasons.push("shipment_purchase_evidence_missing");
  } else if (purchaseEvidenceHash !== input.expectedPurchaseEvidenceHash.toLowerCase()) {
    reasons.push("shipment_purchase_evidence_mismatch");
  }

  const normalized = uniqueReasons(reasons);
  return {
    ok: normalized.length === 0,
    reasons: normalized,
    shipment,
    purchaseEvidenceHash,
  };
}
