export type ComplianceGate = "award" | "mobilization" | "billing" | "closeout";

export type ComplianceDocumentForGate = {
  status: string;
  expiresOn?: string | null;
};

export type ComplianceRequirementForGate = {
  title: string;
  status: string;
  blocksAward: boolean;
  blocksMobilization: boolean;
  blocksBilling: boolean;
  blocksCloseout: boolean;
};

export function scopeMatches(
  left: { tenantId: number; environmentId: number },
  right: { tenantId: number; environmentId: number },
) {
  return left.tenantId === right.tenantId && left.environmentId === right.environmentId;
}

export function isComplianceDocumentExpired(document: ComplianceDocumentForGate, today = new Date().toISOString().slice(0, 10)) {
  return document.status === "expired" || Boolean(document.expiresOn && document.expiresOn < today);
}

export function evaluateComplianceGate(input: {
  qualificationStatus: string;
  documents: ComplianceDocumentForGate[];
  requirements: ComplianceRequirementForGate[];
  gate: ComplianceGate;
}) {
  const blockers = new Set<string>();
  if (input.qualificationStatus !== "approved") blockers.add("Trade partner qualification is not approved");
  if (input.documents.some((document) => isComplianceDocumentExpired(document))) {
    blockers.add("One or more compliance documents are expired");
  }
  const requirementKey = {
    award: "blocksAward",
    mobilization: "blocksMobilization",
    billing: "blocksBilling",
    closeout: "blocksCloseout",
  }[input.gate] as keyof ComplianceRequirementForGate;
  input.requirements
    .filter((requirement) => requirement[requirementKey] && !["approved", "waived"].includes(requirement.status))
    .forEach((requirement) => blockers.add(requirement.title));

  return { allowed: blockers.size === 0, blockers: [...blockers] };
}

export function calculatePayApplicationAmounts(grossAmount: number, retainageAmount: number) {
  if (!Number.isFinite(grossAmount) || grossAmount < 0) throw new Error("Gross amount must be non-negative");
  if (!Number.isFinite(retainageAmount) || retainageAmount < 0) throw new Error("Retainage must be non-negative");
  return {
    grossAmount,
    retainageAmount,
    netAmount: Math.max(0, grossAmount - retainageAmount),
  };
}

export function canReviewCompliance(role?: string) {
  return role === "owner" || role === "admin";
}