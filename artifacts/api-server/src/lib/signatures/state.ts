export const signatureRequestStatuses = [
  "draft",
  "ready",
  "sent",
  "partially_signed",
  "completed",
  "declined",
  "expired",
  "canceled",
] as const;

export type SignatureRequestStatus = typeof signatureRequestStatuses[number];

export const activeSignatureRequestStatuses: readonly SignatureRequestStatus[] = [
  "draft",
  "ready",
  "sent",
  "partially_signed",
];

const allowedTransitions: Record<SignatureRequestStatus, readonly SignatureRequestStatus[]> = {
  draft: ["draft", "ready", "canceled"],
  ready: ["ready", "sent", "canceled"],
  sent: ["sent", "partially_signed", "completed", "declined", "expired", "canceled"],
  partially_signed: ["partially_signed", "completed", "declined", "expired", "canceled"],
  completed: ["completed"],
  declined: ["declined"],
  expired: ["expired"],
  canceled: ["canceled"],
};

export const canTransitionSignatureRequestStatus = (
  from: SignatureRequestStatus,
  to: SignatureRequestStatus,
) => allowedTransitions[from].includes(to);