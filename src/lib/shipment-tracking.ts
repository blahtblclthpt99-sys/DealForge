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

export type DeliveryRecordedV1 = {
  version: 1;
  deliveredAt: string;
};

type ProcurementJournalEvent = {
  type: string;
  detail: string;
  createdAt?: Date | string;
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

export function createShipmentRecord(input: {
  carrierCode: unknown;
  carrierName?: unknown;
  trackingNumber: unknown;
  quantity: unknown;
  shippedAt?: unknown;
}): ShipmentRecordedV1 | null {
  const carrier = resolveTrackingCarrier(input.carrierCode, input.carrierName);
  const trackingNumber = normalizeTrackingNumber(input.trackingNumber);
  if (!carrier || !trackingNumber || !Number.isSafeInteger(input.quantity) || (input.quantity as number) <= 0) {
    return null;
  }
  const shippedAt =
    input.shippedAt === undefined ? new Date().toISOString() : safeTimestamp(input.shippedAt);
  if (!shippedAt) return null;
  return {
    version: 1,
    carrierCode: carrier.carrierCode,
    carrierName: carrier.carrierName,
    trackingNumber,
    trackingUrl: buildOfficialTrackingUrl(carrier.carrierCode, trackingNumber),
    quantity: input.quantity as number,
    shippedAt,
  };
}

export function parseShipmentEventDetail(raw: string): ShipmentRecordedV1 | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const shipment = parsed.shipment;
    if (!shipment || typeof shipment !== "object" || Array.isArray(shipment)) return null;
    const value = shipment as Record<string, unknown>;
    const record = createShipmentRecord({
      carrierCode: value.carrierCode,
      carrierName: value.carrierName,
      trackingNumber: value.trackingNumber,
      quantity: value.quantity,
      shippedAt: value.shippedAt,
    });
    if (!record || value.version !== 1 || value.trackingUrl !== record.trackingUrl) return null;
    return record;
  } catch {
    return null;
  }
}

export function parseDeliveryEventDetail(raw: string): DeliveryRecordedV1 | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const delivery = parsed.delivery;
    if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) return null;
    const value = delivery as Record<string, unknown>;
    const deliveredAt = safeTimestamp(value.deliveredAt);
    if (value.version !== 1 || !deliveredAt) return null;
    return { version: 1, deliveredAt };
  } catch {
    return null;
  }
}

export function projectPublicShipment(events: ProcurementJournalEvent[]) {
  const shipmentEvent = events.find((event) => event.type === "RECORD_SHIPMENT");
  if (!shipmentEvent) return null;
  const shipment = parseShipmentEventDetail(shipmentEvent.detail);
  if (!shipment) return null;
  const deliveryEvent = events.find((event) => event.type === "MARK_DELIVERED");
  const delivery = deliveryEvent ? parseDeliveryEventDetail(deliveryEvent.detail) : null;
  return {
    status: delivery ? ("delivered" as const) : ("shipped" as const),
    carrierName: shipment.carrierName,
    trackingNumber: shipment.trackingNumber,
    trackingUrl: shipment.trackingUrl,
    shippedAt: shipment.shippedAt,
    deliveredAt: delivery?.deliveredAt ?? null,
  };
}

export function publicFulfillmentStatus(status: string) {
  if (status === "delivered") return "delivered" as const;
  if (status === "shipped") return "shipped" as const;
  return "processing" as const;
}
