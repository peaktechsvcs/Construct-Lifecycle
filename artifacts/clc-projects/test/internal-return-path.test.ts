import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { getInternalReturnPath } from '../src/lib/internal-return-path.ts';

const origin = 'https://constructlifecycle.test';

before(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { origin } },
  });
});

after(() => {
  delete (globalThis as { window?: unknown }).window;
});

test('rejects empty, malformed, external, and protocol-relative return values', () => {
  const rejectedValues: Array<string | null> = [
    null,
    '',
    '   ',
    'https://outside.example/projects',
    '//outside.example/projects',
    '/projects/%ZZ',
  ];

  for (const value of rejectedValues) {
    assert.equal(getInternalReturnPath(value), null, `expected ${JSON.stringify(value)} to be rejected`);
  }
});

test('rejects control characters and backslashes before URL normalization', () => {
  const rejectedValues = [
    '/projects/42?return=/dashboard\u0000',
    '/projects/42?return=/dashboard\u001f',
    '/projects/42?return=/dashboard\u007f',
    '/projects\\42',
    '/projects/42\\details',
  ];

  for (const value of rejectedValues) {
    assert.equal(getInternalReturnPath(value), null, `expected ${JSON.stringify(value)} to be rejected`);
  }
});

test('keeps encoded path separators encoded', () => {
  const value = '/projects/42%2F%2E%2E%2Fsettings?tab=summary%26compact#details';

  assert.equal(getInternalReturnPath(value), value);
});

test('preserves valid internal path, query, and hash exactly', () => {
  const value = '/dashboard/drilldown/active-projects?sort=value_desc&search=alpha%20team&return=%2Fprojects%2F42%3Ftab%3Doverview%23summary#projects';

  assert.equal(getInternalReturnPath(value), value);
});