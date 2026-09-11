import { useMemo } from 'react';
import {
  getGetWorkflowConfigQueryKey,
  useGetWorkflowConfig,
  type WorkflowState,
} from '@workspace/api-client-react';
import { stageColors, stageLabels, STAGE_ORDER } from '@/lib/stage-config';

export function useWorkflow() {
  const query = useGetWorkflowConfig({
    query: { queryKey: getGetWorkflowConfigQueryKey(), staleTime: 30_000 },
  });
  const states = useMemo<WorkflowState[]>(() => {
    const configured = query.data?.published.states.filter((state) => state.active).sort((a, b) => a.displayOrder - b.displayOrder);
    if (configured?.length) return configured;
    return STAGE_ORDER.map((stableKey, displayOrder) => ({
      id: displayOrder,
      workflowTemplateId: 0,
      stableKey,
      displayName: stageLabels[stableKey] ?? stableKey,
      normalizedCategory: 'EXECUTION',
      displayOrder,
      active: true,
      terminal: stableKey === 'closeout',
      allowManualEnter: true,
      allowManualLeave: true,
      defaultStatusKey: null,
      requiredFields: [],
      createdAt: '',
      updatedAt: '',
    }));
  }, [query.data]);
  const stateByKey = useMemo(() => new Map(states.map((state) => [state.stableKey, state])), [states]);
  const labels = useMemo(() => Object.fromEntries(states.map((state) => [state.stableKey, state.displayName])), [states]);

  return { ...query, states, stateByKey, labels };
}

export function workflowStageColor(state?: WorkflowState) {
  if (!state) return 'bg-status-neutral';
  if (state.normalizedCategory === 'FINANCIAL') return 'bg-primary';
  if (state.normalizedCategory === 'COMPLETED' || state.terminal) return 'bg-status-success';
  if (state.normalizedCategory === 'PRE_CONSTRUCTION') return 'bg-violet-500';
  if (state.normalizedCategory === 'PRE_SALES') return 'bg-status-warning';
  return stageColors[state.stableKey] ?? 'bg-status-info';
}