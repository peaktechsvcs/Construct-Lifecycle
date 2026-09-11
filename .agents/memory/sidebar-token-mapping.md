---
name: Sidebar token mapping
description: Tailwind v4 sidebar utility classes require explicit color mappings in the theme block.
---

Sidebar-specific utility classes such as `bg-sidebar`, `text-sidebar-foreground`, and `border-sidebar-border` only emit CSS when their corresponding `--color-sidebar*` tokens are declared in the Tailwind `@theme` block.

**Why:** The underlying `:root` HSL variables alone do not make Tailwind v4 utilities available; missing mappings caused the mobile navigation panel to render transparent and inherit the page beneath it.

**How to apply:** When adding or debugging custom color utility names, verify both the raw CSS variables and their `@theme` color mappings, then confirm the compiled CSS contains the expected utility rules.