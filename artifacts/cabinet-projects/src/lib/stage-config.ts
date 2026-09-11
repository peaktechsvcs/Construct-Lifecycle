export const STAGE_ORDER = [
  'opportunity',
  'bid',
  'award',
  'contract',
  'procure',
  'deliver',
  'financial',
  'closeout',
] as const;

export type StageKey = (typeof STAGE_ORDER)[number];

export const stageLabels: Record<string, string> = {
  opportunity: 'Opportunity',
  bid: 'Bid',
  award: 'Award',
  contract: 'Contract',
  procure: 'Procure',
  deliver: 'Deliver',
  financial: 'Financial',
  closeout: 'Closeout',
};

export const stageColors: Record<string, string> = {
  opportunity: 'bg-status-neutral',
  bid: 'bg-status-warning',
  award: 'bg-status-warning',
  contract: 'bg-status-info',
  procure: 'bg-violet-500',
  deliver: 'bg-status-info',
  financial: 'bg-primary',
  closeout: 'bg-status-success',
};

export const LIFECYCLE_STAGES = STAGE_ORDER;
