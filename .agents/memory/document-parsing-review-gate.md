---
name: Document parsing review gate
description: Construction documents produce bounded evidence for human review before intake data changes.
---

Protected construction documents are treated as untrusted source material. Parsing is bounded by file size, extracted text, archive entries, parser time, and retry count; unsupported or image-only files remain in needs-review rather than being treated as successfully parsed.

**Why:** Bid documents can contain hostile content, ambiguous values, scans, and stale revisions. Automatically creating or changing pipeline records from extracted text would bypass the existing human approval boundary.

**How to apply:** Keep parser output reviewable with evidence and confidence. Only accepted or corrected findings may be explicitly applied to the intake; downstream opportunity and bid creation still requires the existing intake approval action.