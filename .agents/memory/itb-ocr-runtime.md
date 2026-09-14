---
name: ITB OCR runtime
description: Environment and cancellation constraints for bounded OCR of scanned bid documents.
---

Scanned ITB OCR depends on the system Tesseract package and the Poppler PDF renderer; child processes must receive the request abort signal so a timed-out parse does not continue in the background.

**Why:** The runtime does not include a Node OCR library, and pdfjs requires binary input as a Uint8Array. A promise timeout alone would leave OCR subprocesses running after the API request ended.

**How to apply:** Keep the system package declared in the Replit Nix configuration, pass command arguments without a shell, render only the bounded page count, and propagate AbortSignal through PDF rendering and Tesseract calls.