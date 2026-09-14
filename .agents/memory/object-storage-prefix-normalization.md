---
name: Object storage prefix normalization
description: The relationship between configured private storage paths and protected /objects URLs.
---

Protected object URLs expose the object name without the storage bucket segment. Any authorization check comparing an object URL with a configured private storage directory must remove the bucket segment using the same path parsing rule as the storage adapter.

**Why:** Comparing the full configured bucket path to the returned object name makes valid protected uploads appear unowned and blocks otherwise valid attachment flows.

**How to apply:** Reuse or mirror the storage adapter's normalization whenever adding tenant-scoped object-path ownership checks; test the complete upload-to-download flow rather than only string prefixes.