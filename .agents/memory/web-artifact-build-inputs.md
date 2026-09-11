---
name: Web artifact build inputs
description: Required environment values for manually verifying React/Vite artifact production builds.
---

Manual production builds for web artifacts must provide both `PORT` and `BASE_PATH`; the Vite config intentionally fails fast when either is absent.

**Why:** The managed workflow supplies these values, but a direct package build does not, so an otherwise valid build can appear broken if run without the workflow environment.

**How to apply:** Use the artifact's configured preview path for `BASE_PATH` and an available positive port when running a direct build.