# Phase 3 — Customer Shipment Quantity Binding

## Purpose

Complete the customer fulfillment truth gate by binding shopper-visible shipment evidence to the authoritative order-line quantity.

## Rule

When DealForge projects shipment or delivery information into customer order history, the canonical shipment journal quantity must exactly equal the order item quantity. A zero, fractional, negative, or mismatched expected quantity fails closed.

If quantity binding fails, the existing customer fulfillment truth gate suppresses tracking and returns `processing` rather than presenting a shipment claim that no longer reconciles to the purchased line.

## Compatibility

The projection helper retains an optional quantity argument for non-customer internal callers. The customer order API always supplies the authoritative order-line quantity, so the customer-facing path cannot omit this check.

## Safety boundaries

This is a read-only projection rule. It does not mutate fulfillment, call carriers or suppliers, change procurement authority, alter Stripe state, or change tax/legal release controls. Issue #170 remains unchanged.
