---
name: Responsive browser coverage
description: Durable lessons from authenticated responsive browser coverage for protected workspaces.
---

Authenticated responsive coverage should collect runtime exceptions and page-level console errors, not only assert rendered selectors. Stable semantic selectors are preferable to text assertions for badges and controls inside intentional horizontal scroll regions.

**Why:** Strict browser error capture exposed invalid HTML nesting and empty image URLs that ordinary route and type checks did not report.

**How to apply:** When adding protected workspace cases, use the existing browser-auth fixture, keep standalone fixture data behind an explicit scenario query, exercise at least one real mutation with visible feedback, and distinguish DOM presence from viewport visibility for horizontally scrollable tables.