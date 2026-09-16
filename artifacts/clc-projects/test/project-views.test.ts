import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getActiveProjectStatusEmptyGuidance,
  getAllProjectsTableRows,
  groupActiveProjectStatusSections,
} from '../src/lib/project-views.ts';

test('empty custom Active Projects status uses its configured label and project destination', () => {
  assert.deepEqual(
    getActiveProjectStatusEmptyGuidance(
      { stableKey: 'field_active', displayName: 'Field Work' },
      'Paused',
    ),
    {
      text: 'Create a project or update a project to the Field Work status.',
      href: '/projects',
      label: 'Open project book',
    },
  );
});

test('empty waiting status points teams to workflow configuration without replacing its label', () => {
  assert.deepEqual(
    getActiveProjectStatusEmptyGuidance(
      { stableKey: 'waiting', displayName: 'Paused' },
      'Paused',
    ),
    {
      text: 'Move a project to Paused when progress is paused or your team is waiting on a decision.',
      href: '/settings/administration/workflows',
      label: 'Review workflow',
    },
  );
});

test('Active Projects keeps every configured status in display order', () => {
  const sections = groupActiveProjectStatusSections(
    [
      { id: 5, projectNumber: 'PRJ-005', projectStatus: 'review_pending' },
      { id: 6, projectNumber: 'PRJ-006', projectStatus: 'active' },
      { id: 7, projectNumber: 'PRJ-007', projectStatus: 'field_active' },
      { id: 8, projectNumber: 'PRJ-008', projectStatus: 'waiting' },
    ],
    [
      { stableKey: 'review_pending', displayName: 'Review pending', displayOrder: 0 },
      { stableKey: 'waiting', displayName: 'Waiting', displayOrder: 20 },
      { stableKey: 'field_active', displayName: 'Field active', displayOrder: 5 },
      { stableKey: 'active', displayName: 'Active', displayOrder: 30 },
    ],
  );

  assert.deepEqual(sections.map((section) => section.stableKey), [
    'review_pending',
    'field_active',
    'waiting',
    'active',
  ]);
});

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