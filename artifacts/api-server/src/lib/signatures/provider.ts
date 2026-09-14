export type SignatureProviderCapability =
  | "send"
  | "status"
  | "cancel"
  | "download_signed_document";

export type SignatureProviderContext = {
  tenantId: number;
  environmentId: number;
  integrationId: number;
};

export type SignatureProviderSigner = {
  name: string;
  email: string;
  role: string | null;
  signingOrder: number;
};

export type SignatureProviderRequestInput = {
  title: string;
  fileName: string;
  contentType: string;
  documentBytes: Buffer;
  signers: SignatureProviderSigner[];
};

export type SignatureProviderDocument = {
  fileName: string;
  contentType: string;
  bytes?: Buffer;
  objectPath?: string;
};

export type SignatureProvider = {
  providerKey: string;
  capabilities: ReadonlySet<SignatureProviderCapability>;
  send: (context: SignatureProviderContext, input: SignatureProviderRequestInput) => Promise<{
    providerRequestId: string;
    metadata?: Record<string, unknown>;
  }>;
  getStatus: (context: SignatureProviderContext, providerRequestId: string) => Promise<{
    status: string;
    metadata?: Record<string, unknown>;
  }>;
  cancel: (context: SignatureProviderContext, providerRequestId: string) => Promise<void>;
  downloadSignedDocument: (
    context: SignatureProviderContext,
    providerRequestId: string,
  ) => Promise<SignatureProviderDocument>;
};

const providers = new Map<string, SignatureProvider>();

export const registerSignatureProvider = (provider: SignatureProvider) => {
  if (!provider.providerKey.trim()) {
    throw new Error("Signature provider keys cannot be empty");
  }
  providers.set(provider.providerKey, provider);
};

export const getSignatureProvider = (providerKey: string | null | undefined) =>
  providerKey ? providers.get(providerKey) : undefined;

export const getSignatureProviderAvailability = (connectedProviderKeys: string[] = []) => {
  const availableProviderKeys = connectedProviderKeys.filter((providerKey) => providers.has(providerKey));
  return {
    available: availableProviderKeys.length > 0,
    providerKey: availableProviderKeys.length === 1 ? availableProviderKeys[0] : null,
  };
};