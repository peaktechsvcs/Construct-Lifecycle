export type SignatureSignerInput = {
  name: string;
  email: string;
  role?: string | null;
  signingOrder?: number;
};

export type NormalizedSignatureSigner = {
  name: string;
  email: string;
  role: string | null;
  signingOrder: number;
};

export type SignatureSignerValidation =
  | { ok: true; signers: NormalizedSignatureSigner[] }
  | { ok: false; error: string };

export const validateAndNormalizeSignatureSigners = (
  input: readonly SignatureSignerInput[],
): SignatureSignerValidation => {
  if (input.length < 1 || input.length > 20) {
    return { ok: false, error: "Signature requests must have between 1 and 20 signers" };
  }
  const signers: NormalizedSignatureSigner[] = [];
  const emails = new Set<string>();
  for (const [index, signer] of input.entries()) {
    const name = signer.name.trim();
    const email = signer.email.trim().toLowerCase();
    const role = signer.role?.trim() || null;
    const signingOrder = signer.signingOrder ?? index + 1;
    if (!name || name.length > 180) {
      return { ok: false, error: "Signer names must be between 1 and 180 characters" };
    }
    if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, error: "Signer emails must be valid email addresses" };
    }
    if (role && role.length > 180) {
      return { ok: false, error: "Signer roles must be 180 characters or fewer" };
    }
    if (!Number.isInteger(signingOrder) || signingOrder < 1 || signingOrder > 50) {
      return { ok: false, error: "Signer signing order must be an integer from 1 to 50" };
    }
    if (emails.has(email)) {
      return { ok: false, error: "Each signer must have a unique email address" };
    }
    emails.add(email);
    signers.push({ name, email, role, signingOrder });
  }
  return { ok: true, signers };
};