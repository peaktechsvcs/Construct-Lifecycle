import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRANDING_FALLBACKS,
  brandingColorsWithFallbacks,
  getBrandingColorIssues,
  getInvalidBrandingColorFields,
  hexToHsl,
  normalizeHexColor,
  sanitizeBrandingColors,
} from '../src/lib/color-utils.ts';
import { getSafeBrandingLogoUrl } from '../src/lib/branding-logo.ts';
import { BRANDING_SAVE_ERROR_MESSAGE } from '../src/lib/branding-save.ts';
import { getContrastRatio } from '../src/lib/accessibility.ts';

test('branding colors accept only finite hex values before entering CSS variables', () => {
  assert.equal(normalizeHexColor('#abc'), '#aabbcc');
  assert.equal(normalizeHexColor(' #2563EB '), '#2563eb');
  assert.equal(normalizeHexColor('#12zz34'), null);
  assert.equal(normalizeHexColor('rgb(1, 2, 3)'), null);
  assert.equal(hexToHsl('#12zz34'), null);
});

test('incomplete or malformed published branding keeps the shared theme fallback', () => {
  assert.deepEqual(
    brandingColorsWithFallbacks({
      primaryColor: '#123456',
      backgroundColor: '#not-a-color',
      foregroundColor: null,
    }),
    {
      ...BRANDING_FALLBACKS,
      primaryColor: '#123456',
    },
  );
  assert.deepEqual(
    sanitizeBrandingColors({ primaryColor: '#123456', secondaryColor: 42 }),
    { primaryColor: '#123456' },
  );
});

test('default branded actions and page text meet WCAG AA contrast', () => {
  assert.ok(getContrastRatio('#ffffff', BRANDING_FALLBACKS.primaryColor) >= 4.5);
  assert.ok(getContrastRatio(BRANDING_FALLBACKS.foregroundColor, BRANDING_FALLBACKS.backgroundColor) >= 4.5);
  assert.ok(getContrastRatio('#ffffff', '#ffffff') < 4.5);
});

test('branding logo URLs allow web images and fall back for empty or unsafe values', () => {
  const fallback = '/logo-icon.png';
  assert.equal(
    getSafeBrandingLogoUrl(' https://cdn.example.test/logo.svg ', fallback),
    'https://cdn.example.test/logo.svg',
  );
  assert.equal(getSafeBrandingLogoUrl('/uploaded/logo.png', fallback), '/uploaded/logo.png');
  assert.equal(getSafeBrandingLogoUrl('', fallback), fallback);
  assert.equal(getSafeBrandingLogoUrl('   ', fallback), fallback);
  assert.equal(getSafeBrandingLogoUrl(null, fallback), fallback);
  assert.equal(getSafeBrandingLogoUrl('not a valid logo URL', fallback), fallback);
  assert.equal(getSafeBrandingLogoUrl('images/logo.png', fallback), fallback);
  assert.equal(getSafeBrandingLogoUrl('javascript:alert(1)', fallback), fallback);
  assert.equal(getSafeBrandingLogoUrl('data:image/svg+xml,<svg></svg>', fallback), fallback);
  assert.equal(getSafeBrandingLogoUrl('https://user:password@example.test/logo.png', fallback), fallback);
});

test('branding draft guidance distinguishes malformed values from contrast failures', () => {
  const issues = getBrandingColorIssues({
    primaryColor: '#ffffff',
    secondaryColor: '#12zz34',
    backgroundColor: '#ffffff',
    foregroundColor: '#ffffff',
  });
  assert.deepEqual(getInvalidBrandingColorFields({
    primaryColor: '#ffffff',
    secondaryColor: '#12zz34',
    backgroundColor: '#ffffff',
    foregroundColor: '#ffffff',
  }), ['secondaryColor']);
  assert.match(issues.secondaryColor?.[0] ?? '', /3- or 6-digit hex/);
  assert.match(issues.primaryColor?.[0] ?? '', /White text on this action color/);
  assert.match(issues.foregroundColor?.[0] ?? '', /Page text contrast/);
  assert.match(issues.backgroundColor?.[0] ?? '', /Page text contrast/);
});

test('branding save errors explain that the current draft is not persisted and can be retried', () => {
  assert.match(BRANDING_SAVE_ERROR_MESSAGE, /not persisted/);
  assert.match(BRANDING_SAVE_ERROR_MESSAGE, /Retry saving/);
});