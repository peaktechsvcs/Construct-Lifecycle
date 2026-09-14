---
name: Object storage path validation
description: Private object directories may contain dotted names such as .private while traversal protection remains separate.
---

Object storage object-path validation must allow safe dots in generated private directory names; traversal protection belongs in path parsing and must continue to reject `..`.

**Why:** The development private object directory is `.private`, so rejecting dots made valid protected uploads fail during completion and streaming.

**How to apply:** Keep the allowed character set compatible with configured bucket/object paths, and preserve explicit traversal checks rather than rejecting every dot.