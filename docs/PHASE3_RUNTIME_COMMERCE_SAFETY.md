# Phase 3 Runtime Commerce Safety

DealForge direct commerce is fail-closed at runtime.

An active product is purchasable only while all of the following remain true:

- the production financial gate is certified;
- direct commerce is enabled for the product;
- the product is in stock;
- currency is USD;
- landed cost and selling price are valid positive integer cents;
- the saved owner-reviewed commerce recommendation remains current;
- the saved source is verified and available;
- the saved source check has not exceeded its maximum age;
- stored landed cost and selling price still match the reviewed recommendation;
- retailer, supplier URL, and ASIN still match the source identity reviewed by the owner.

The same combined safety decision is applied to new Checkout creation and Checkout resume. The storefront additionally refuses the direct-buy presentation if source identity no longer matches.

The scheduled maintenance route runs `quarantineUnsafeDirectCommerce`. Unsafe active products are changed from active to inactive with a compare-and-set update, an audit record, and storefront product-cache invalidation. The safety worker has no activation path and never performs supplier purchasing.

Automatic quarantine is intentionally one-way. Restoring a product to direct commerce requires a new/current reviewed recommendation and the explicit owner activation workflow.
