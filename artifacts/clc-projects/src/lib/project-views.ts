export type ProjectStatusDefinition = {
  stableKey: string;
  displayName: string;
  displayOrder: number;
};

export type ProjectWithStatus = {
  projectStatus?: string | null;
};

/**
 * All Projects intentionally has one table. Keep this as a named view-model
 * boundary so future grouping logic cannot accidentally leak into that page.
 */
export function getAllProjectsTableRows<T>(projects: readonly T[]): T[] {
  return [...projects];
}

/**
 * Active Projects always has one section per configured active status. Empty
 * sections are retained so the page communicates the same status structure
 * regardless of which group currently has records.
 */
export function groupActiveProjectStatusSections<T extends ProjectWithStatus>(
  projects: readonly T[],
  statuses: readonly ProjectStatusDefinition[],
) {
  return [...statuses]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((status) => ({
      ...status,
      projects: projects.filter(
        (project) => project.projectStatus?.toLowerCase() === status.stableKey,
      ),
    }));
}