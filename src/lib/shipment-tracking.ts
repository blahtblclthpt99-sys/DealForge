import { createHash } from "node:crypto";

export const TRACKING_CARRIERS = ["ups", "usps", "fedex", "dhl", "other"] as const;
export type TrackingCarrier = (typeof TRACKING_CARRIERS)[number];

export type ShipmentRecordedV1 = {
  version: 1;
  carrierCode: TrackingCarrier;
  carrierName: string;
  trackingNumber: string;
  trackingUrl: string | null;
  quantity: number;
  shippedAt: string;
};

export type ShipmentRecordedV2 = {
  version: 2;
  packageId: string;
  carrierCode: TrackingCarrier;
  carrierName: string;
  trackingNumber: string;
  trackingUrl: string | null;
  quantity: number;
  shippedAt: string;
};

export type ShipmentRecorded = ShipmentRecordedV1 | ShipmentRecordedV2;

export type DeliveryRecordedV1 = {
  version: 1;
  deliveredAt: string;
};

export type DeliveryRecordedV2 = {
  version: 2;
  packageId: string;
  deliveredAt: string;
};

export type DeliveryRecorded = DeliveryRecordedV1 | DeliveryRecordedV2;

type ProcurementJournalEvent = {
  type: string;
  detail: string;
  createdAt?: Date | string;
};

export type PublicShipmentPackage = {
  packageId: string;
  status: "shipped" | "delivered";
  carrierName: string;
  trackingNumber: string;
  trackingUrl: string | null;
  quantity: number;
  shippedAt: string;
  deliveredAt: string | null;
};

export type ShipmentJournalSummary = {
  ok: true;
  packages: PublicShipmentPackage[];
  shippedQuantity: number;
  deliveredQuantity: number;
} | {
  ok: false;
  reason:
    | "SHIPMENT_JOURNAL_INVALID"
    | "SHIPMENT_PACKAGE_DUPLICATE"
    | "DELIVERY_PACKAGE_UNKNOWN"
    | "DELIVERY_PACKAGE_DUPLICATE"
    | "DELIVERY_TIMESTAMP_INVALID";
};

const CARRIER_NAMES: Record<Exclude<TrackingCarrier, "other">, string> = {
  ups: "UPS",
  usps: "USPS",
  fedex: "FedEx",
  dhl: "DHL",
};

function safeTimestamp(value: unknown, futureAllowanceMs = 15 * 60 * 1000): string | null {
  if (typeof value !== "string" || value.length < 20 || value.length > 40) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > Date.now() + futureAllowanceMs) return null;
  return new Date(parsed).toISOString();
}

export function normalizeTrackingNumber(value: unknown): string | null {
  if (typeof value !== "string" || /[\r\n\t\0]/.test(value)) return null;
  const normalized = value.trim().replace(/ +/g, "");
  if (normalized.length < 4 || normalized.length > 80) return null;
  if (!/^[A-Za-z0-9-]+$/.test(normalized)) return null;
  return normalized;
}

export function resolveTrackingCarrier(
  carrierCode: unknown,
  carrierName: unknown,
): { carrierCode: TrackingCarrier; carrierName: string } | null {
  if (typeof carrierCode !== "string" || !(TRACKING_CARRIERS as readonly string[]).includes(carrierCode)) {
    return null;
  }
  const code = carrierCode as TrackingCarrier;
  if (code !== "other") return { carrierCode: code, carrierName: CARRIER_NAMES[code] };
  if (typeof carrierName !== "string") return null;
  const name = carrierName.trim();
  if (name.length < 2 || name.length > 60 || !/^[A-Za-z0-9 .&'()-]+$/.test(name)) return null;
  return { carrierCode: code, carrierName: name };
}

export function buildOfficialTrackingUrl(
  carrierCode: TrackingCarrier,
  trackingNumber: string,
): string | null {
  const encoded = encodeURIComponent(trackingNumber);
  switch (carrierCode) {
    case "ups":
      return `https://www.ups.com/track?tracknum=${encoded}`;
    case "usps":
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`;
    case "fedex":
      return `https://www.fedex.com/fedextrack/?trknbr=${encoded}`;
    case "dhl":
      return `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${encoded}`;
    case "other":
      return null;
  }
}

export function shipmentPackageId(carrierCode: TrackingCarrier, trackingNumber: string) {
  const digest = createHash("sha256")
    .update(`${carrierCode}:${trackingNumber}`)
    .digest("hex")
    .slice(0, 24);
  return `pkg_${digest}`;
}

function normalizedShipmentFields(input: {
  carrierCode: unknown;
  carrierName?: unknown;
  trackingNumber: unknown;
  quantity: unknown;
  shippedAt?: unknown;
}) {
  const carrier = resolveTrackingCarrier(input.carrierCode, input.carrierName);
  const trackingNumber = normalizeTrackingNumber(input.trackingNumber);
  if (!carrier || !trackingNumber || !Number.isSafeInteger(input.quantity) || (input.quantity as number) <= 0) {
    return null;
  }
  const shippedAt = input.shippedAt === undefined ? new Date().toISOString() : safeTimestamp(input.shippedAt);
  if (!shippedAt) return null;
  return {
    carrierCode: carrier.carrierCode,
    carrierName: carrier.carrierName,
    trackingNumber,
    trackingUrl: buildOfficialTrackingUrl(carrier.carrierCode, trackingNumber),
    quantity: input.quantity as number,
    shippedAt,
  };
}

export function createShipmentRecord(input: {
  carrierCode: unknown;
  carrierName?: unknown;
  trackingNumber: unknown;
  quantity: unknown;
  shippedAt?: unknown;
}): ShipmentRecordedV2 | null {
  const normalized = normalizedShipmentFields(input);
  if (!normalized) return null;
  return {
    version: 2,
    packageId: shipmentPackageId(normalized.carrierCode, normalized.trackingNumber),
    ...normalized,
  };
}

export function parseShipmentEventDetail(raw: string): ShipmentRecorded | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const shipment = parsed.shipment;
    if (!shipment || typeof shipment !== "object" || Array.isArray(shipment)) return null;
    const value = shipment as Record<string, unknown>;
    const normalized = normalizedShipmentFields({
      carrierCode: value.carrierCode,
      carrierName: value.carrierName,
      trackingNumber: value.trackingNumber,
      quantity: value.quantity,
      shippedAt: value.shippedAt,
    });
    if (!normalized || value.trackingUrl !== normalized.trackingUrl) return null;
    if (value.version === 1) {
      return { version: 1, ...normalized };
    }
    const packageId = shipmentPackageId(normalized.carrierCode, normalized.trackingNumber);
    if (value.version !== 2 || value.packageId !== packageId) return null;
    return { version: 2, packageId, ...normalized };
  } catch {
    return null;
  }
}

export function createDeliveryRecord(input: {
  packageId: unknown;
  deliveredAt?: unknown;
}): DeliveryRecordedV2 | null {
  if (typeof input.packageId !== "string" || !/^pkg_[a-f0-9]{24}$/.test(input.packageId)) return null;
  const deliveredAt = input.deliveredAt === undefined ? new Date().toISOString() : safeTimestamp(input.deliveredAt);
  if (!deliveredAt) return null;
  return { version: 2, packageId: input.packageId, deliveredAt };
}

export function parseDeliveryEventDetail(raw: string): DeliveryRecorded | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const delivery = parsed.delivery;
    if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) return null;
    const value = delivery as Record<string, unknown>;
    const deliveredAt = safeTimestamp(value.deliveredAt);
    if (!deliveredAt) return null;
    if (value.version === 1) return { version: 1, deliveredAt };
    if (value.version !== 2 || typeof value.packageId !== "string" || !/^pkg_[a-f0-9]{24}$/.test(value.packageId)) {
      return null;
    }
    return { version: 2, packageId: value.packageId, deliveredAt };
  } catch {
    return null;
  }
}

export function packageIdForShipment(shipment: ShipmentRecorded) {
  return shipment.version === 2
    ? shipment.packageId
    : shipmentPackageId(shipment.carrierCode, shipment.trackingNumber);
}

export function summarizeShipmentJournal(events: ProcurementJournalEvent[]): ShipmentJournalSummary {
  const packages = new Map<string, PublicShipmentPackage>();
  let shippedQuantity = 0;
  let deliveredQuantity = 0;

  for (const event of events) {
    if (event.type === "RECORD_SHIPMENT") {
      const shipment = parseShipmentEventDetail(event.detail);
      if (!shipment) return { ok: false, reason: "SHIPMENT_JOURNAL_INVALID" };
      const packageId = packageIdForShipment(shipment);
      if (packages.has(packageId)) return { ok: false, reason: "SHIPMENT_PACKAGE_DUPLICATE" };
      packages.set(packageId, {
        packageId,
        status: "shipped",
        carrierName: shipment.carrierName,
        trackingNumber: shipment.trackingNumber,
        trackingUrl: shipment.trackingUrl,
        quantity: shipment.quantity,
        shippedAt: shipment.shippedAt,
        deliveredAt: null,
      });
      shippedQuantity += shipment.quantity;
      continue;
    }

    if (event.type !== "MARK_DELIVERED") continue;
    const delivery = parseDeliveryEventDetail(event.detail);
    if (!delivery) return { ok: false, reason: "SHIPMENT_JOURNAL_INVALID" };

    let packageId: string | null = delivery.version === 2 ? delivery.packageId : null;
    if (!packageId) {
      const undelivered = [...packages.values()].filter((entry) => !entry.deliveredAt);
      if (undelivered.length !== 1) return { ok: false, reason: "DELIVERY_PACKAGE_UNKNOWN" };
      packageId = undelivered[0].packageId;
    }

    const shipment = packages.get(packageId);
    if (!shipment) return { ok: false, reason: "DELIVERY_PACKAGE_UNKNOWN" };
    if (shipment.deliveredAt) return { ok: false, reason: "DELIVERY_PACKAGE_DUPLICATE" };
    if (Date.parse(delivery.deliveredAt) < Date.parse(shipment.shippedAt)) {
      return { ok: false, reason: "DELIVERY_TIMESTAMP_INVALID" };
    }
    shipment.status = "delivered";
    shipment.deliveredAt = delivery.deliveredAt;
    deliveredQuantity += shipment.quantity;
  }

  return { ok: true, packages: [...packages.values()], shippedQuantity, deliveredQuantity };
}

export function projectPublicShipments(events: ProcurementJournalEvent[], expectedQuantity?: number) {
  if (
    expectedQuantity !== undefined &&
    (!Number.isSafeInteger(expectedQuantity) || expectedQuantity <= 0)
  ) {
    return [];
  }
  const summary = summarizeShipmentJournal(events);
  if (!summary.ok) return [];
  if (expectedQuantity !== undefined && summary.shippedQuantity > expectedQuantity) return [];
  return summary.packages;
}

export function projectPublicShipment(
  events: ProcurementJournalEvent[],
  expectedQuantity?: number,
) {
  const shipmentEvents = events.filter((event) => event.type === "RECORD_SHIPMENT");
  const deliveryEvents = events.filter((event) => event.type === "MARK_DELIVERED");
  if (shipmentEvents.length !== 1 || deliveryEvents.length > 1) return null;

  const shipment = parseShipmentEventDetail(shipmentEvents[0].detail);
  if (!shipment) return null;
  if (
    expectedQuantity !== undefined &&
    (!Number.isSafeInteger(expectedQuantity) || expectedQuantity <= 0 || shipment.quantity !== expectedQuantity)
  ) {
    return null;
  }

  const packages = projectPublicShipments(events, expectedQuantity);
  if (packages.length !== 1) return null;
  const projected = packages[0];
  return {
    status: projected.status,
    carrierName: projected.carrierName,
    trackingNumber: projected.trackingNumber,
    trackingUrl: projected.trackingUrl,
    shippedAt: projected.shippedAt,
    deliveredAt: projected.deliveredAt,
  };
}

export function publicFulfillmentStatus(status: string) {
  if (status === "delivered") return "delivered" as const;
  if (status === "shipped") return "shipped" as const;
  return "processing" as const;
}
