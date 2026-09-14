import type { ReplitConnectors } from "@replit/connectors-sdk";
import type {
  SignatureProvider,
  SignatureProviderContext,
  SignatureProviderRequestInput,
} from "./provider";

const connectorName = "docusign";
const apiPrefix = "/restapi/v2.1";

const withTimeout = async <T>(promise: Promise<T>, timeoutMs = 30_000): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Signature provider request timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const safeFileName = (value: string) =>
  value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 180) || "signed-document";

const responseJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    throw new Error(`DocuSign request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
};

const responseBytes = async (response: Response): Promise<Buffer> => {
  if (!response.ok) {
    throw new Error(`DocuSign document download failed (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
};

const createProvider = (connectors: ReplitConnectors): SignatureProvider => {
  const request = (path: string, options?: { method?: string; body?: unknown; headers?: Record<string, string> }) =>
    withTimeout(connectors.proxy(connectorName, path, options));

  const getAccountId = async () => {
    const body = await responseJson<{ accounts?: Array<{ accountId?: string }> }>(
      await request(`${apiPrefix}/accounts`),
    );
    const accountId = body.accounts?.find((account) => account.accountId)?.accountId;
    if (!accountId) throw new Error("DocuSign account is not available");
    return accountId;
  };

  const provider: SignatureProvider = {
    providerKey: connectorName,
    capabilities: new Set(["send", "status", "cancel", "download_signed_document"]),
    send: async (_context: SignatureProviderContext, input: SignatureProviderRequestInput) => {
      const accountId = await getAccountId();
      const body = await responseJson<{ envelopeId?: string }>(
        await request(`${apiPrefix}/accounts/${encodeURIComponent(accountId)}/envelopes`, {
          method: "POST",
          body: {
            emailSubject: input.title,
            status: "sent",
            documents: [{
              documentBase64: input.documentBytes.toString("base64"),
              documentId: "1",
              name: safeFileName(input.fileName),
              fileExtension: input.fileName.toLowerCase().endsWith(".pdf") ? "pdf" : undefined,
            }],
            recipients: {
              signers: input.signers.map((signer, index) => ({
                name: signer.name,
                email: signer.email,
                recipientId: String(index + 1),
                routingOrder: String(signer.signingOrder),
              })),
            },
          },
        }),
      );
      if (!body.envelopeId) throw new Error("DocuSign returned no envelope id");
      return { providerRequestId: body.envelopeId, metadata: { providerStatus: "sent" } };
    },
    getStatus: async (_context: SignatureProviderContext, providerRequestId: string) => {
      const accountId = await getAccountId();
      const body = await responseJson<{ status?: string }>(
        await request(`${apiPrefix}/accounts/${encodeURIComponent(accountId)}/envelopes/${encodeURIComponent(providerRequestId)}`),
      );
      const providerStatus = body.status?.toLowerCase();
      const status = providerStatus === "completed"
        ? "completed"
        : providerStatus === "declined"
          ? "declined"
          : providerStatus === "voided"
            ? "canceled"
            : "sent";
      return { status, metadata: { providerStatus: body.status ?? "unknown" } };
    },
    cancel: async (_context: SignatureProviderContext, providerRequestId: string) => {
      const accountId = await getAccountId();
      await responseJson(
        await request(`${apiPrefix}/accounts/${encodeURIComponent(accountId)}/envelopes/${encodeURIComponent(providerRequestId)}`, {
          method: "PUT",
          body: { status: "voided", voidedReason: "Canceled from Construct Lifecycle" },
        }),
      );
    },
    downloadSignedDocument: async (_context: SignatureProviderContext, providerRequestId: string) => {
      const accountId = await getAccountId();
      const response = await request(
        `${apiPrefix}/accounts/${encodeURIComponent(accountId)}/envelopes/${encodeURIComponent(providerRequestId)}/documents/combined`,
        { headers: { Accept: "application/pdf" } },
      );
      return {
        fileName: `signed-${safeFileName(providerRequestId)}.pdf`,
        contentType: "application/pdf",
        bytes: await responseBytes(response),
      };
    },
  };
  return provider;
};

export const registerDocuSignSignatureProvider = (connectors: ReplitConnectors, register: (provider: SignatureProvider) => void) => {
  register(createProvider(connectors));
};