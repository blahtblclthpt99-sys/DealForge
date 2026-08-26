import assert from "node:assert/strict";
import test from "node:test";
import {
  bindSupplierSourceProvenanceToMetadata,
  bindSupplierSourceProvenanceToSpecifications,
  buildSupplierSourceProvenance,
  evaluateSupplierSourceProvenance,
  parseSupplierSourceProvenance,
  readSupplierSourceProvenanceFromMetadata,
} from "../src/lib/supplier-source-provenance";

const SOURCE_VERIFIED_AT = "2026-08-26T05:00:00.000Z";

function build() {
  return buildSupplierSourceProvenance({
    supplierName: "Verified Supplier",
    sourceClass: "authorized_dropshipper",
    sourceUrl: "https://supplier.example",
    resaleAllowed: true,
    sourceVerifiedAt: SOURCE_VERIFIED_AT,
  });
}

test("builds deterministic source provenance without storing raw documents", () => {
  const first = build();
  const second = build();
  assert.deepEqual(first, second);
  assert.equal(first.version, 1);
  assert.equal(first.verificationMethod, "owner_manual");
  assert.match(first.attestationSha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(first).includes("password"), false);
});

test("tampered provenance hash fails closed", () => {
  const provenance = build();
  assert.equal(parseSupplierSourceProvenance({ ...provenance, sourceClass: "wholesale" }), null);
  assert.equal(parseSupplierSourceProvenance({ ...provenance, attestationSha256: "0".repeat(64) }), null);
});

test("supplier metadata preserves and returns exact provenance", () => {
  const provenance = build();
  const metadata = bindSupplierSourceProvenanceToMetadata(JSON.stringify({ note: "keep" }), provenance);
  const parsed = JSON.parse(metadata) as Record<string, unknown>;
  assert.equal(parsed.note, "keep");
  assert.deepEqual(readSupplierSourceProvenanceFromMetadata(metadata), provenance);
});

test("malformed supplier metadata is never silently overwritten", () => {
  const provenance = build();
  assert.throws(
    () => bindSupplierSourceProvenanceToMetadata("{malformed", provenance),
    /SUPPLIER_METADATA_INVALID/,
  );
  assert.throws(
    () => bindSupplierSourceProvenanceToMetadata("[]", provenance),
    /SUPPLIER_METADATA_INVALID/,
  );
});

test("live supplier drift is detected independently of product JSON", () => {
  const provenance = build();
  const metadata = bindSupplierSourceProvenanceToMetadata("{}", provenance);
  const decision = evaluateSupplierSourceProvenance(metadata, {
    supplierName: "Verified Supplier",
    sourceClass: "distributor",
    sourceUrl: "https://supplier.example",
    resaleAllowed: true,
    sourceVerifiedAt: new Date(SOURCE_VERIFIED_AT),
    verificationSource: "owner_manual",
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reasons.join(","), /supplier_source_provenance_class_drift/);
});

test("commercialization snapshot binds the exact supplier provenance envelope", () => {
  const provenance = build();
  const specs = bindSupplierSourceProvenanceToSpecifications(JSON.stringify({
    supplierOfferV1: {
      supplierName: "Verified Supplier",
      sourceClass: "authorized_dropshipper",
      sourceUrl: "https://supplier.example/item",
      resaleAllowed: true,
      sourceVerifiedAt: SOURCE_VERIFIED_AT,
      priceVerifiedAt: SOURCE_VERIFIED_AT,
    },
  }), provenance);
  const root = JSON.parse(specs) as { supplierOfferV1: { sourceVerificationV1: unknown } };
  assert.deepEqual(root.supplierOfferV1.sourceVerificationV1, provenance);
});
