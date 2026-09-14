import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAllProjectsTableRows,
  groupActiveProjectStatusSections,
} from '../src/lib/project-views.ts';

const statuses = [
  { stableKey: 'waiting', displayName: 'Waiting', displayOrder: 1 },
  { stableKey: 'active', displayName: 'Active', displayOrder: 0 },
];

const projects = [
  { id: 1, projectNumber: 'PRJ-001', projectStatus: 'waiting' },
  { id: 2, projectNumber: 'PRJ-002', projectStatus: 'active' },
  { id: 3, projectNumber: 'PRJ-003', projectStatus: 'complete' },
];

test('All Projects keeps every project in one ungrouped table row collection', () => {
  const rows = getAllProjectsTableRows(projects);

  assert.deepEqual(rows, projects);
  assert.deepEqual(rows.map((project) => project.id), [1, 2, 3]);
  assert.deepEqual(rows.map((project) => project.projectNumber), [
    'PRJ-001',
    'PRJ-002',
    'PRJ-003',
  ]);
});

test('Active Projects groups only Active and Waiting records with Active first', () => {
  const sections = groupActiveProjectStatusSections(projects, statuses);

  assert.deepEqual(sections.map((section) => section.stableKey), [
    'active',
    'waiting',
  ]);
  assert.deepEqual(sections.map((section) => section.projects.map((project) => project.id)), [
    [2],
    [1],
  ]);
  assert.deepEqual(sections.flatMap((section) => section.projects.map((project) => project.projectNumber)), [
    'PRJ-002',
    'PRJ-001',
  ]);
});

test('Active Projects keeps an empty section when the other status has records', () => {
  const sections = groupActiveProjectStatusSections(
    [{ id: 4, projectNumber: 'PRJ-004', projectStatus: 'waiting' }],
    statuses,
  );

  assert.deepEqual(sections.map((section) => ({
    key: section.stableKey,
    count: section.projects.length,
  })), [
    { key: 'active', count: 0 },
    { key: 'waiting', count: 1 },
  ]);
});