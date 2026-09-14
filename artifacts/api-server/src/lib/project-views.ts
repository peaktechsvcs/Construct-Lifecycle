type ActiveProjectCandidate = {
  stage: string;
  projectStatus?: string | null;
};

type WorkflowStateCategory = {
  stableKey: string;
  normalizedCategory: string;
};

/**
 * Active Projects is defined by both lifecycle category and project status.
 * Keeping the predicate separate makes the drilldown contract testable without
 * requiring a database or an authenticated request.
 */
export function filterActiveProjects<T extends ActiveProjectCandidate>(
  projects: readonly T[],
  states: readonly WorkflowStateCategory[],
  allowedStatusKeys: ReadonlySet<string>,
): T[] {
  const categoryByStage = new Map(
    states.map((state) => [state.stableKey, state.normalizedCategory]),
  );

  return projects.filter((project) => {
    const category = categoryByStage.get(project.stage);
    return !!category
      && !["PRE_SALES", "COMPLETED", "CANCELED"].includes(category)
      && allowedStatusKeys.has(project.projectStatus?.toLowerCase() ?? "");
  });
}