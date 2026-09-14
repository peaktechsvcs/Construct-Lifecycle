import assert from "node:assert/strict";
import test from "node:test";
import { filterActiveProjects } from "../src/lib/project-views.ts";

const states = [
  { stableKey: "award", normalizedCategory: "AWARDED" },
  { stableKey: "deliver", normalizedCategory: "EXECUTION" },
  { stableKey: "bid", normalizedCategory: "PRE_SALES" },
  { stableKey: "closeout", normalizedCategory: "COMPLETED" },
];

test("active project filtering requires a lifecycle-active stage and Active or Waiting status", () => {
  const projects = [
    { id: 1, projectNumber: "PRJ-001", stage: "award", projectStatus: "active" },
    { id: 2, projectNumber: "PRJ-002", stage: "deliver", projectStatus: "WAITING" },
    { id: 3, projectNumber: "PRJ-003", stage: "deliver", projectStatus: "complete" },
    { id: 4, projectNumber: "PRJ-004", stage: "bid", projectStatus: "active" },
    { id: 5, projectNumber: "PRJ-005", stage: "closeout", projectStatus: "waiting" },
  ];

  const matches = filterActiveProjects(projects, states, new Set(["active", "waiting"]));

  assert.deepEqual(matches.map((project) => project.id), [1, 2]);
  assert.deepEqual(matches.map((project) => project.projectNumber), [
    "PRJ-001",
    "PRJ-002",
  ]);
});