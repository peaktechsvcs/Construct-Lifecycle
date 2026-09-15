import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRANDING_FALLBACKS,
  brandingColorsWithFallbacks,
  hexToHsl,
  normalizeHexColor,
  sanitizeBrandingColors,
} from '../src/lib/color-utils.ts';
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