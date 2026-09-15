---
name: ClamAV runtime provisioning
description: Runtime requirements for real malware scanning in the API process
---

ClamAV packages provide the scanning executable but may not include virus definitions. The API must refresh definitions into a writable runtime directory before accepting uploads, while treating failed refreshes as scanner-unavailable rather than allowing files through.

**Why:** A bare `clamscan` installation can exit with a missing-database error, which otherwise turns every upload into an unavailable scan despite the package being installed.

**How to apply:** Keep scanner execution pointed at the same database directory used by the startup refresh. Bound refresh and scan timeouts, suppress provider output, and preserve fail-closed behavior when the mirror, executable, or definitions are unavailable.