---
name: Responsive browser coverage
description: Durable lessons from authenticated responsive browser coverage for protected workspaces.
---

Authenticated responsive coverage should collect runtime exceptions and page-level console errors, not only assert rendered selectors. Stable semantic selectors are preferable to text assertions for badges and controls inside intentional horizontal scroll regions.

**Why:** Strict browser error capture exposed invalid HTML nesting and empty image URLs that ordinary route and type checks did not report.

**How to apply:** When adding protected workspace cases, use the existing browser-auth fixture, keep standalone fixture data behind an explicit scenario query, exercise at least one real mutation with visible feedback, and distinguish DOM presence from viewport visibility for horizontally scrollable tables.

Visual captures should load the required fonts before the first render check, then wait through the app's entrance animation after rendered data and route interactions settle; do not force a second post-render animation reset.

**Why:** Resetting animations after data mounted produced screenshot states that differed from the intended final layout, while a post-render wait preserved stable final paints without changing the UI under test.

**How to apply:** Keep font readiness in the initial stabilizer and use a capture delay longer than the longest entrance animation after `inspect`; refresh baselines only when the final captured state is intentional.