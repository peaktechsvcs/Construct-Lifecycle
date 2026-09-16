export function getInternalReturnPath(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001F\u007F]/.test(value)) return null;
  try {
    decodeURIComponent(value);
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    if (!origin) return null;
    const candidate = new URL(value, origin);
    if (candidate.origin !== origin) return null;
    return `${candidate.pathname}${candidate.search}${candidate.hash}`;
  } catch {
    return null;
  }
}