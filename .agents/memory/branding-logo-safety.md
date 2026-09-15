---
name: Branding logo safety
description: Published tenant logo URLs are untrusted and the workspace shell must retain a shared-logo fallback.
---

Published tenant logo URLs are treated as untrusted display input: accept only bounded HTTP(S) URLs without embedded credentials, and switch to the shared Construct Lifecycle icon when the image cannot load.

**Why:** Branding is customer-controlled and can be blank, malformed, stale, or unreachable; a broken asset must not remove the recognizable workspace navigation identity.

**How to apply:** Keep validation at the shell rendering boundary and test valid, empty, unsafe, and load-failure cases using the deterministic browser fixture.