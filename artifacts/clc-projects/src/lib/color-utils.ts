import { getContrastRatio } from './accessibility.ts';

export const BRANDING_COLOR_KEYS = [
  'primaryColor',
  'secondaryColor',
  'accentColor',
  'backgroundColor',
  'foregroundColor',
] as const;

export type BrandingColorKey = typeof BRANDING_COLOR_KEYS[number];
export type BrandingColors = Partial<Record<BrandingColorKey, string>>;
export type BrandingColorIssues = Partial<Record<BrandingColorKey, string[]>>;

export const BRANDING_FALLBACKS: Record<BrandingColorKey, string> = {
  primaryColor: '#2563eb',
  secondaryColor: '#f1f5f9',
  accentColor: '#f1f5f9',
  backgroundColor: '#ffffff',
  foregroundColor: '#0f172a',
};

export function normalizeHexColor(hex?: string | null): string | null {
  if (typeof hex !== 'string' || !hex) return null;
  const value = hex.trim().replace(/^#/, '');
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return null;
  const normalized = value.length === 3
    ? value.split('').map((character) => character + character).join('')
    : value;
  return `#${normalized.toLowerCase()}`;
}

export function sanitizeBrandingColors(data: unknown): BrandingColors {
  if (!data || typeof data !== 'object') return {};

  const source = data as Record<string, unknown>;
  return Object.fromEntries(
    BRANDING_COLOR_KEYS.flatMap((key) => {
      const value = normalizeHexColor(typeof source[key] === 'string' ? source[key] : null);
      return value ? [[key, value]] : [];
    }),
  ) as BrandingColors;
}

export function brandingColorsWithFallbacks(data: unknown): Record<BrandingColorKey, string> {
  return { ...BRANDING_FALLBACKS, ...sanitizeBrandingColors(data) };
}

function recordFromUnknown(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' ? data as Record<string, unknown> : {};
}

export function getInvalidBrandingColorFields(data: unknown): BrandingColorKey[] {
  const source = recordFromUnknown(data);
  return BRANDING_COLOR_KEYS.filter((key) => key in source && normalizeHexColor(
    typeof source[key] === 'string' ? source[key] : null,
  ) === null);
}

export function getBrandingColorIssues(data: unknown): BrandingColorIssues {
  const source = recordFromUnknown(data);
  const issues: BrandingColorIssues = {};
  const addIssue = (key: BrandingColorKey, message: string) => {
    issues[key] = [...(issues[key] ?? []), message];
  };

  for (const key of getInvalidBrandingColorFields(source)) {
    addIssue(key, 'Use a 3- or 6-digit hex color, such as #2563eb.');
  }

  const primaryColor = normalizeHexColor(typeof source.primaryColor === 'string' ? source.primaryColor : null);
  if (primaryColor) {
    const ratio = getContrastRatio('#ffffff', primaryColor);
    if (ratio < 4.5) {
      addIssue('primaryColor', `White text on this action color is ${ratio.toFixed(2)}:1; use a darker color for at least 4.5:1.`);
    }
  }

  const foregroundColor = normalizeHexColor(typeof source.foregroundColor === 'string' ? source.foregroundColor : null);
  const backgroundColor = normalizeHexColor(typeof source.backgroundColor === 'string' ? source.backgroundColor : null);
  if (foregroundColor && backgroundColor) {
    const ratio = getContrastRatio(foregroundColor, backgroundColor);
    if (ratio < 4.5) {
      const message = `Page text contrast is ${ratio.toFixed(2)}:1; adjust this color or its pair to reach at least 4.5:1.`;
      addIssue('foregroundColor', message);
      addIssue('backgroundColor', message);
    }
  }

  return issues;
}

export function hexToHsl(hex?: string | null): string | null {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  const value = normalized.slice(1);
  
  const r = parseInt(value.substring(0, 2), 16) / 255;
  const g = parseInt(value.substring(2, 4), 16) / 255;
  const b = parseInt(value.substring(4, 6), 16) / 255;
  
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
