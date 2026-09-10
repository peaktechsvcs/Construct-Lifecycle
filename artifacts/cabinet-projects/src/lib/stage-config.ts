// Canonical lifecycle stage ordering and metadata
// Pre-Construction is inserted between Contracted and In Progress

export const STAGE_ORDER = [
  'lead',
  'proposal',
  'awarded',
  'contracted',
  'pre_construction',
  'in_progress',
  'billing',
  'closeout',
  'follow_up',
  'lost',
] as const;

export type StageKey = (typeof STAGE_ORDER)[number];

export const stageLabels: Record<string, string> = {
  lead: 'Lead',
  proposal: 'Proposal',
  awarded: 'Awarded',
  contracted: 'Contracted',
  pre_construction: 'Pre-Construction',
  in_progress: 'In Progress',
  billing: 'Billing',
  closeout: 'Closeout',
  follow_up: 'Follow-up',
  lost: 'Lost',
};

export const stageColors: Record<string, string> = {
  lead: 'bg-status-neutral',
  proposal: 'bg-status-warning',
  awarded: 'bg-status-warning',
  contracted: 'bg-status-info',
  pre_construction: 'bg-violet-500',
  in_progress: 'bg-status-info',
  billing: 'bg-primary',
  closeout: 'bg-status-success',
  follow_up: 'bg-status-danger',
  lost: 'bg-status-neutral/50',
};

// Stages to display in the lifecycle stepper (no terminal stages)
export const LIFECYCLE_STAGES = [
  'lead',
  'proposal',
  'awarded',
  'contracted',
  'pre_construction',
  'in_progress',
  'billing',
  'closeout',
];
