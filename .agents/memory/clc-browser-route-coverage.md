---
name: CLC browser route coverage
description: Why Construct Lifecycle route checks use a dependency-free Chromium fixture instead of a browser automation package.
---

Construct Lifecycle browser route coverage should run through the real Vite-rendered React app and design-system components, but may use a test-only Clerk module alias and fetch fixture when no browser automation dependency is available.

**Why:** The workspace already provides Chromium but does not include Playwright or Puppeteer; adding a large browser dependency would add avoidable package and audit cost for route-state coverage.

**How to apply:** Keep the fixture alias gated by `CLC_BROWSER_TEST=1`, keep production builds on the real Clerk/API modules, and make the route matrix assert user-visible headings, breadcrumbs, navigation state, redirects, and no-workspace behavior.