---
name: Responsive procurement flow checks
description: Cross-route procurement release checks need explicit state reset and semantic text matching.
---

Procurement browser flows should treat route navigation as stateful: after moving through quote, order, delivery, and receiving views, reset the page before asserting the originating route, and compare semantic text and quote-detail totals without depending on responsive capitalization.

**Why:** The same supplier page instance can retain its selected tab across URL changes, while responsive typography changes the rendered casing of section labels and vendor/date detail text.

**How to apply:** In future CDP release checks, separate flow assertions from final route assertions, use an explicit reset for the final route, and match labels case-insensitively.