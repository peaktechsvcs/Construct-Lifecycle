export type ProjectControlRole = "owner" | "admin" | "member" | "platform_admin";
export type ParticipantType = "owner" | "architect" | "subcontractor" | "supplier";

export function canApproveProjectChange(role: ProjectControlRole) {
  return role === "owner" || role === "admin" || role === "platform_admin";
}

export function canViewProjectControlArea(participantType: ParticipantType, area: "financials" | "schedule" | "issues" | "commitments" | "closeout") {
  if (participantType === "owner") return true;
  if (participantType === "architect") return area === "schedule" || area === "issues" || area === "closeout";
  if (participantType === "subcontractor") return area === "schedule" || area === "issues" || area === "commitments" || area === "closeout";
  return area === "commitments" || area === "closeout";
}