/* GENERATED FROM tokens.json -- DO NOT EDIT. Run scripts/build-tokens.mjs. */
// Portable design tokens (colors as hex). Web consumes the theme via
// src/index.css; mobile (Expo) and any other platform import this object so the
// whole product shares one source of truth.
export const tokens = {
  "color": {
    "light": {
      "background": "#fafafa",
      "foreground": "#0f172a",
      "border": "#e2e8f0",
      "card": "#ffffff",
      "cardForeground": "#0f172a",
      "popover": "#ffffff",
      "popoverForeground": "#0f172a",
      "primary": "#2563eb",
      "primaryForeground": "#f8fafc",
      "secondary": "#f1f5f9",
      "secondaryForeground": "#0f172a",
      "muted": "#f1f5f9",
      "mutedForeground": "#64748b",
      "accent": "#f59e0b",
      "accentForeground": "#0f172a",
      "destructive": "#ef4444",
      "destructiveForeground": "#f8fafc",
      "input": "#e2e8f0",
      "ring": "#2563eb",
      "chart1": "#2563eb",
      "chart2": "#0284c7",
      "chart3": "#22c55e",
      "chart4": "#f59e0b",
      "chart5": "#ef4444",
      "sidebar": "#0f172a",
      "sidebarForeground": "#f8fafc",
      "sidebarBorder": "#1e293b",
      "sidebarPrimary": "#2563eb",
      "sidebarPrimaryForeground": "#f8fafc",
      "sidebarAccent": "#1e293b",
      "sidebarAccentForeground": "#f8fafc",
      "sidebarRing": "#3b82f6"
    },
    "dark": {
      "background": "#0f172a",
      "foreground": "#f8fafc",
      "border": "#1e293b",
      "card": "#0f172a",
      "cardForeground": "#f8fafc",
      "popover": "#0f172a",
      "popoverForeground": "#f8fafc",
      "primary": "#3b82f6",
      "primaryForeground": "#0f172a",
      "secondary": "#1e293b",
      "secondaryForeground": "#f8fafc",
      "muted": "#1e293b",
      "mutedForeground": "#94a3b8",
      "accent": "#fbbf24",
      "accentForeground": "#0f172a",
      "destructive": "#991b1b",
      "destructiveForeground": "#f8fafc",
      "input": "#1e293b",
      "ring": "#3b82f6",
      "chart1": "#3b82f6",
      "chart2": "#0ea5e9",
      "chart3": "#22c55e",
      "chart4": "#fbbf24",
      "chart5": "#ef4444",
      "sidebar": "#0f172a",
      "sidebarForeground": "#f8fafc",
      "sidebarBorder": "#1e293b",
      "sidebarPrimary": "#3b82f6",
      "sidebarPrimaryForeground": "#0f172a",
      "sidebarAccent": "#1e293b",
      "sidebarAccentForeground": "#f8fafc",
      "sidebarRing": "#3b82f6"
    }
  },
  "fontFamily": {
    "sans": [
      "Inter",
      "sans-serif"
    ],
    "serif": [
      "Georgia",
      "serif"
    ],
    "mono": [
      "DM Mono",
      "monospace"
    ]
  },
  "radius": "0.5rem",
  "spacing": "0.25rem"
} as const;

export type Tokens = typeof tokens;
export default tokens;
