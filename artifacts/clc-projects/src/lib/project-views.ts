export type ProjectStatusDefinition = {
  stableKey: string;
  displayName: string;
  displayOrder: number;
};

export type ActiveProjectStatusEmptyGuidance = {
  text: string;
  href: string;
  label: string;
};

export type ProjectWithStatus = {
  projectStatus?: string | null;
};

export function getActiveProjectStatusEmptyGuidance(
  status: Pick<ProjectStatusDefinition, 'stableKey' | 'displayName'>,
  waitingStatusName: string,
): ActiveProjectStatusEmptyGuidance {
  if (status.stableKey === 'active') {
    return {
      text: `Create a project or move a ${waitingStatusName.toLowerCase()} project into ${status.displayName} when work is ready.`,
      href: '/projects',
      label: 'Open project book',
    };
  }

  if (status.stableKey === 'waiting') {
    return {
      text: `Move a project to ${status.displayName} when progress is paused or your team is waiting on a decision.`,
      href: '/settings/administration/workflows',
      label: 'Review workflow',
    };
  }

  return {
    text: `Create a project or update a project to the ${status.displayName} status.`,
    href: '/projects',
    label: 'Open project book',
  };
}

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