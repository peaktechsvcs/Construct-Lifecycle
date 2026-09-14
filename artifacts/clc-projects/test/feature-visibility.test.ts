import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAccessComingSoonFeature,
  filterFeatureNavigationGroups,
  isAdvertisedFeature,
} from '../src/lib/feature-visibility.ts';

const groups = [
  {
    label: 'Projects',
    items: [
      { href: '/projects', label: 'All Projects' },
      { href: '/coming-soon/contracts', label: 'Contracts' },
    ],
  },
  {
    label: 'Financial',
    items: [
      { href: '/coming-soon/revenue', label: 'Revenue' },
    ],
  },
] as const;

test('disabled features are not advertised in navigation or direct routes', () => {
  const flags = [{ key: 'contracts' }];

  assert.equal(isAdvertisedFeature('revenue', flags), false);
  assert.equal(canAccessComingSoonFeature('revenue', flags, false), false);

  const visibleGroups = filterFeatureNavigationGroups(groups, flags, false);
  assert.deepEqual(
    visibleGroups.flatMap((group) => group.items.map((item) => item.href)),
    ['/projects', '/coming-soon/contracts'],
  );
});

test('a refreshed flag advertises the feature and permits its Coming soon route', () => {
  const beforeRefresh = filterFeatureNavigationGroups(groups, [], false);
  assert.deepEqual(
    beforeRefresh.flatMap((group) => group.items.map((item) => item.href)),
    ['/projects'],
  );

  const afterRefresh = [{ key: 'revenue' }, { key: 'contracts' }];
  const visibleGroups = filterFeatureNavigationGroups(groups, afterRefresh, false);
  assert.deepEqual(
    visibleGroups.flatMap((group) => group.items.map((item) => item.href)),
    ['/projects', '/coming-soon/contracts', '/coming-soon/revenue'],
  );
  assert.equal(canAccessComingSoonFeature('revenue', afterRefresh, false), true);
});

test('platform administrators can inspect hidden Coming soon routes', () => {
  assert.equal(canAccessComingSoonFeature('revenue', [], true), true);
  assert.deepEqual(
    filterFeatureNavigationGroups(groups, [], true).flatMap((group) =>
      group.items.map((item) => item.href),
    ),
    ['/projects', '/coming-soon/contracts', '/coming-soon/revenue'],
  );
});