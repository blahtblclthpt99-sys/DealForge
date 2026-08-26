import {
  packageIdForShipment,
  parseShipmentEventDetail,
  type ShipmentRecorded,
} from "./shipment-tracking";

export type ShipmentJournalIntegrityReason =
  | "shipment_event_missing"
  | "shipment_event_duplicate"
  | "shipment_event_invalid"
  | "shipment_package_duplicate"
  | "shipment_quantity_exceeded"
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
  shipment: ShipmentRecorded | null;
  shipments: ShipmentRecorded[];
  shippedQuantity: number;
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
  allowPartial?: boolean;
}): ShipmentJournalIntegrityResult {
  const reasons: ShipmentJournalIntegrityReason[] = [];
  const shipments: ShipmentRecorded[] = [];
  const packageIds = new Set<string>();
  const purchaseEvidenceHashes: string[] = [];
  let shippedQuantity = 0;

  if (input.events.length === 0) {
    return {
      ok: false,
      reasons: ["shipment_event_missing"],
      shipment: null,
      shipments: [],
      shippedQuantity: 0,
      purchaseEvidenceHash: null,
    };
  }

  for (const event of input.events) {
    const shipment = parseShipmentEventDetail(event.detail);
    const purchaseEvidenceHash = readPurchaseEvidenceHash(event.detail);

    if (!shipment) {
      reasons.push("shipment_event_invalid");
    } else {
      const packageId = packageIdForShipment(shipment);
      if (packageIds.has(packageId)) {
        reasons.push("shipment_package_duplicate");
      } else {
        packageIds.add(packageId);
        shipments.push(shipment);
        shippedQuantity += shipment.quantity;
      }
    }

    if (!purchaseEvidenceHash) {
      reasons.push("shipment_purchase_evidence_missing");
    } else {
      purchaseEvidenceHashes.push(purchaseEvidenceHash);
      if (purchaseEvidenceHash !== input.expectedPurchaseEvidenceHash.toLowerCase()) {
        reasons.push("shipment_purchase_evidence_mismatch");
      }
    }
  }

  if (!Number.isSafeInteger(input.expectedQuantity) || input.expectedQuantity <= 0) {
    reasons.push("shipment_quantity_mismatch");
  } else if (shippedQuantity > input.expectedQuantity) {
    reasons.push("shipment_quantity_exceeded");
  } else if (!input.allowPartial && shippedQuantity !== input.expectedQuantity) {
    reasons.push("shipment_quantity_mismatch");
  }

  const normalized = uniqueReasons(reasons);
  const commonPurchaseEvidenceHash =
    purchaseEvidenceHashes.length === input.events.length &&
    purchaseEvidenceHashes.every((value) => value === purchaseEvidenceHashes[0])
      ? purchaseEvidenceHashes[0]
      : null;

  return {
    ok: normalized.length === 0,
    reasons: normalized,
    shipment: shipments.length === 1 ? shipments[0] : null,
    shipments,
    shippedQuantity,
    purchaseEvidenceHash: commonPurchaseEvidenceHash,
  };
}
