const SAFE_LOGO_PROTOCOLS = new Set(['http:', 'https:']);
const MAX_LOGO_URL_LENGTH = 2048;

/**
 * Branding URLs come from published tenant data and must be treated as
 * untrusted input before they reach an image source.
 */
export function getSafeBrandingLogoUrl(
  value: unknown,
  fallback: string,
  origin = 'http://localhost',
): string {
  if (typeof value !== 'string') return fallback;

  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_LOGO_URL_LENGTH) return fallback;

  try {
    const parsed = new URL(candidate, origin);
    if (!SAFE_LOGO_PROTOCOLS.has(parsed.protocol) || parsed.username || parsed.password) {
      return fallback;
    }
    return candidate;
  } catch {
    return fallback;
  }
}