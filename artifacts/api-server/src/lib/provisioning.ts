import type {
  EnvironmentResourceStatus,
  EnvironmentResourceType,
} from "@workspace/db";

export const ISOLATED_RESOURCE_TYPES: readonly EnvironmentResourceType[] = [
  "runtime",
  "database",
  "storage",
  "queue",
  "secrets",
  "jobs",
  "logs",
];

export const SANITIZATION_POLICIES = [
  "redact-secrets",
  "replace-identifiers",
  "full",
] as const;
export type SanitizationPolicy = (typeof SANITIZATION_POLICIES)[number];

export type ProviderResourceRequest = {
  tenantId: number;
  environmentId: number;
  resourceType: EnvironmentResourceType;
  idempotencyKey: string;
};

export type ProvisionedProviderResource = {
  externalId: string;
  endpoint?: string;
  /** Opaque provider key identifier only; never key material. */
  secretReference?: string;
  metadata?: Record<string, unknown>;
  providerOperationId?: string;
};

export type ProviderVerificationResult = Record<string, unknown> & {
  verified: true;
  healthy?: boolean;
};
export type RestoreOperationStatus = "pending" | "succeeded" | "failed";
export type RestoreOperation = {
  providerOperationId: string;
  status: RestoreOperationStatus;
  error?: string;
};

export function parseProviderVerificationResult(payload: unknown): ProviderVerificationResult {
  if (!payload || typeof payload !== "object" || (payload as Record<string, unknown>).verified !== true ||
    ("healthy" in payload && typeof (payload as Record<string, unknown>).healthy !== "boolean") ||
    (payload as Record<string, unknown>).healthy === false) {
    throw new ProvisioningProviderRequestError("Provisioning provider returned an unverified result");
  }
  return payload as ProviderVerificationResult;
}

export function redactProviderMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  const redact = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(redact);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/(secret|token|password|credential|private.?key|signing.?key|key.?material)/i.test(key))
      .map(([key, item]) => [key, redact(item)]));
  };
  return redact(metadata) as Record<string, unknown>;
}

export function isRuntimeSigningBoundaryReady(
  resources: Array<{ resourceType: string; secretReference?: string | null }>,
): boolean {
  const runtime = resources.find((resource) => resource.resourceType === "runtime");
  const secrets = resources.find((resource) => resource.resourceType === "secrets");
  return Boolean(runtime?.secretReference || secrets?.secretReference);
}

/**
 * The control plane never pretends that an unconfigured provider succeeded.
 * Deployments supply an adapter implementation at the application boundary;
 * this adapter is intentionally a hard failure for local/test environments.
 */
export interface ProvisioningProvider {
  readonly key: string;
  provisionResource(request: ProviderResourceRequest): Promise<ProvisionedProviderResource>;
  verifyResource(resource: ProviderResourceRequest & { externalId: string }): Promise<ProviderVerificationResult>;
  resolveRuntimeSigningKey(request: {
    tenantId: number;
    environmentId: number;
    keyReference: string;
  }): Promise<string>;
  createSnapshot(request: {
    tenantId: number;
    sourceEnvironmentId: number;
    targetEnvironmentId: number;
    sanitized: boolean;
    sanitizationPolicy?: SanitizationPolicy;
    idempotencyKey: string;
  }): Promise<{ backupReference: string; checksum: string; providerOperationId?: string }>;
  verifySnapshot(request: {
    tenantId: number;
    environmentId: number;
    backupReference: string;
    checksum: string;
    idempotencyKey: string;
  }): Promise<ProviderVerificationResult>;
  restoreSnapshot(request: {
    tenantId: number;
    targetEnvironmentId: number;
    backupReference: string;
    idempotencyKey: string;
  }): Promise<RestoreOperation>;
  getRestoreOperation(request: {
    tenantId: number;
    targetEnvironmentId: number;
    providerOperationId: string;
  }): Promise<RestoreOperation>;
  verifyRestoredTarget(request: {
    tenantId: number;
    targetEnvironmentId: number;
    providerOperationId: string;
  }): Promise<ProviderVerificationResult>;
}

export class ProvisioningProviderUnavailableError extends Error {
  readonly code = "PROVISIONING_PROVIDER_UNAVAILABLE";

  constructor(message = "No environment provisioning provider is configured") {
    super(message);
    this.name = "ProvisioningProviderUnavailableError";
  }
}

export class ProvisioningProviderRequestError extends Error {
  readonly code = "PROVISIONING_PROVIDER_REQUEST_FAILED";
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
    this.name = "ProvisioningProviderRequestError";
  }
}

type HttpProviderOptions = {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  allowInsecureHttp?: boolean;
  localOnly?: boolean;
};

const providerPathSegment = (value: string) => encodeURIComponent(value);

/**
 * Provider-neutral HTTP adapter. The adapter deliberately only accepts a
 * configured URL and bearer token; it never falls back to an in-process mock.
 * The provider owns the actual runtime, database, storage, queue, secrets,
 * jobs, logs, and backup resources.
 */
export class HttpProvisioningProvider implements ProvisioningProvider {
  readonly key = "http";
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;
  private readonly options: HttpProviderOptions;

  constructor(options: HttpProviderOptions) {
    this.options = options;
    const parsed = new URL(options.baseUrl);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && options.allowInsecureHttp && options.localOnly &&
      process.env.NODE_ENV !== "production" && process.env.APP_ENV !== "production")) {
      throw new Error("PROVISIONING_PROVIDER_URL must use HTTPS (HTTP is available only to explicit non-production local/test adapters)");
    }
    if (parsed.username || parsed.password) {
      throw new Error("PROVISIONING_PROVIDER_URL must not contain credentials");
    }
    this.baseUrl = new URL(parsed.toString().replace(/\/+$/, "") + "/");
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private async request<T>(
    path: string,
    init: { method: string; body?: Record<string, unknown>; idempotencyKey: string },
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = new URL(path.replace(/^\/+/, ""), this.baseUrl);
      const response = await fetch(url, {
        method: init.method,
        signal: controller.signal,
        redirect: "error",
        headers: {
          authorization: `Bearer ${this.options.token}`,
          "content-type": "application/json",
          "idempotency-key": init.idempotencyKey,
          accept: "application/json",
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      const text = await response.text();
      let payload: unknown = {};
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { message: text.slice(0, 500) };
        }
      }
      if (!response.ok) {
        const message = payload && typeof payload === "object" && "message" in payload
          ? String((payload as { message: unknown }).message)
          : `Provisioning provider returned HTTP ${response.status}`;
        throw new ProvisioningProviderRequestError(message, response.status);
      }
    return payload as T;
    } catch (error) {
      if (error instanceof ProvisioningProviderRequestError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ProvisioningProviderRequestError("Provisioning provider request timed out");
      }
      throw new ProvisioningProviderRequestError(
        error instanceof Error ? error.message : "Provisioning provider request failed",
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async provisionResource(request: ProviderResourceRequest): Promise<ProvisionedProviderResource> {
    const resource = await this.request<ProvisionedProviderResource>("v1/resources", {
      method: "POST",
      idempotencyKey: request.idempotencyKey,
      body: request,
    });
    if (!resource || typeof resource.externalId !== "string" || !resource.externalId) {
      throw new ProvisioningProviderRequestError("Provisioning provider returned no external resource ID");
    }
    return resource;
  }

  async verifyResource(resource: ProviderResourceRequest & { externalId: string }): Promise<ProviderVerificationResult> {
    return parseProviderVerificationResult(await this.request<unknown>(
      `v1/resources/${providerPathSegment(resource.externalId)}/verify`,
      { method: "POST", idempotencyKey: resource.idempotencyKey, body: resource },
    ));
  }

  async resolveRuntimeSigningKey(request: {
    tenantId: number;
    environmentId: number;
    keyReference: string;
  }): Promise<string> {
    const payload = await this.request<unknown>("v1/runtime-signing-keys/resolve", {
      method: "POST",
      idempotencyKey: `runtime-key:${request.environmentId}:${request.keyReference}`,
      body: request,
    });
    const key = payload && typeof payload === "object" ? (payload as Record<string, unknown>).signingKey : undefined;
    if (typeof key !== "string" || key.length < 32) {
      throw new ProvisioningProviderRequestError("Provisioning provider returned no valid runtime signing key");
    }
    return key;
  }

  async createSnapshot(request: {
    tenantId: number;
    sourceEnvironmentId: number;
    targetEnvironmentId: number;
    sanitized: boolean;
    sanitizationPolicy?: SanitizationPolicy;
    idempotencyKey: string;
  }): Promise<{ backupReference: string; checksum: string; providerOperationId?: string }> {
    const snapshot = await this.request<{ backupReference?: unknown; checksum?: unknown; providerOperationId?: string }>("v1/snapshots", {
      method: "POST",
      idempotencyKey: request.idempotencyKey,
      body: request,
    });
    if (typeof snapshot.backupReference !== "string" || typeof snapshot.checksum !== "string") {
      throw new ProvisioningProviderRequestError("Provisioning provider returned an invalid snapshot");
    }
    return snapshot as { backupReference: string; checksum: string; providerOperationId?: string };
  }

  async verifySnapshot(request: {
    tenantId: number;
    environmentId: number;
    backupReference: string;
    checksum: string;
    idempotencyKey: string;
  }): Promise<ProviderVerificationResult> {
    return parseProviderVerificationResult(await this.request("v1/snapshots/verify", {
      method: "POST",
      idempotencyKey: request.idempotencyKey,
      body: request,
    }));
  }

  async restoreSnapshot(request: {
    tenantId: number;
    targetEnvironmentId: number;
    backupReference: string;
    idempotencyKey: string;
  }): Promise<RestoreOperation> {
    const operation = await this.request<Record<string, unknown>>("v1/snapshots/restore", {
      method: "POST",
      idempotencyKey: request.idempotencyKey,
      body: request,
    });
    if (typeof operation.providerOperationId !== "string" || !operation.providerOperationId) {
      throw new ProvisioningProviderRequestError("Provisioning provider returned no restore operation ID");
    }
    const status = operation.status === "succeeded" || operation.status === "failed"
      ? operation.status
      : "pending";
    return {
      providerOperationId: operation.providerOperationId,
      status,
      ...(typeof operation.error === "string" ? { error: operation.error } : {}),
    };
  }

  async getRestoreOperation(request: {
    tenantId: number;
    targetEnvironmentId: number;
    providerOperationId: string;
  }): Promise<RestoreOperation> {
    const operation = await this.request<Record<string, unknown>>("v1/snapshots/restore/status", {
      method: "POST",
      idempotencyKey: `restore-status:${request.providerOperationId}`,
      body: request,
    });
    if (typeof operation.providerOperationId !== "string" || !operation.providerOperationId ||
      !["pending", "succeeded", "failed"].includes(String(operation.status))) {
      throw new ProvisioningProviderRequestError("Provisioning provider returned an invalid restore operation status");
    }
    return {
      providerOperationId: operation.providerOperationId,
      status: operation.status as RestoreOperationStatus,
      ...(typeof operation.error === "string" ? { error: operation.error } : {}),
    };
  }

  async verifyRestoredTarget(request: {
    tenantId: number;
    targetEnvironmentId: number;
    providerOperationId: string;
  }): Promise<ProviderVerificationResult> {
    return parseProviderVerificationResult(await this.request("v1/snapshots/restore/verify", {
      method: "POST",
      idempotencyKey: `restore-verify:${request.providerOperationId}`,
      body: request,
    }));
  }
}

export function createProvisioningProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ProvisioningProvider {
  const baseUrl = env.PROVISIONING_PROVIDER_URL?.trim();
  const token = env.PROVISIONING_PROVIDER_TOKEN?.trim();
  if (!baseUrl || !token) return unavailableProvisioningProvider;
  const timeoutMs = Number(env.PROVISIONING_PROVIDER_TIMEOUT_MS ?? 30_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) {
    throw new Error("PROVISIONING_PROVIDER_TIMEOUT_MS must be between 1000 and 120000");
  }
  const allowInsecureHttp = env.PROVISIONING_PROVIDER_ALLOW_INSECURE_HTTP === "true";
  const localOnly = env.PROVISIONING_PROVIDER_LOCAL_ONLY === "true";
  if (allowInsecureHttp && (env.NODE_ENV === "production" || env.APP_ENV === "production")) {
    throw new Error("PROVISIONING_PROVIDER_ALLOW_INSECURE_HTTP cannot be enabled in production");
  }
  return new HttpProvisioningProvider({ baseUrl, token, timeoutMs, allowInsecureHttp, localOnly });
}

export const unavailableProvisioningProvider: ProvisioningProvider = {
  key: "unconfigured",
  async provisionResource() {
    throw new ProvisioningProviderUnavailableError(
      "Environment provisioning is unavailable: configure a runtime/database/storage/queue provider adapter before provisioning",
    );
  },
  async verifyResource() {
    throw new ProvisioningProviderUnavailableError(
      "Environment verification is unavailable: configure the resource provider adapter",
    );
  },
  async resolveRuntimeSigningKey() {
    throw new ProvisioningProviderUnavailableError(
      "Runtime signing keys are unavailable: configure the secret provider",
    );
  },
  async createSnapshot() {
    throw new ProvisioningProviderUnavailableError(
      "Environment snapshots are unavailable: configure the backup provider adapter",
    );
  },
  async restoreSnapshot() {
    throw new ProvisioningProviderUnavailableError(
      "Environment restore is unavailable: configure the backup provider adapter",
    );
  },
  async getRestoreOperation() {
    throw new ProvisioningProviderUnavailableError(
      "Restore operation status is unavailable: configure the backup provider adapter",
    );
  },
  async verifyRestoredTarget() {
    throw new ProvisioningProviderUnavailableError(
      "Restored target verification is unavailable: configure the backup provider adapter",
    );
  },
  async verifySnapshot() {
    throw new ProvisioningProviderUnavailableError(
      "Snapshot verification is unavailable: configure the backup provider adapter",
    );
  },
};

let activeProvisioningProvider: ProvisioningProvider = unavailableProvisioningProvider;

/** Register the deployment's real provider adapter during application startup. */
export function configureProvisioningProvider(provider: ProvisioningProvider): void {
  activeProvisioningProvider = provider;
}

export function getProvisioningProvider(): ProvisioningProvider {
  return activeProvisioningProvider;
}

export function deriveEnvironmentProvisioningStatus(
  resources: ReadonlyArray<{ resourceType: string; status: string }>,
  operations: ReadonlyArray<{ status: string }>,
): "requested" | "provisioning" | "ready" | "failed" {
  if (operations.some((operation) => operation.status === "running" || operation.status === "requested")) {
    return "provisioning";
  }
  if (isIsolatedEnvironmentReady(resources)) {
    return "ready";
  }
  if (resources.some((resource) => resource.status === "failed" || resource.status === "degraded")) {
    return "failed";
  }
  return resources.length ? "requested" : "requested";
}

export function isRecentHealthyCheck(
  check: { status: string; checkedAt: Date | string } | undefined,
  now = Date.now(),
  maxAgeMs = Number(process.env.ENVIRONMENT_HEALTH_MAX_AGE_MS ?? 5 * 60_000),
): boolean {
  if (!check || check.status !== "healthy") return false;
  const checkedAt = new Date(check.checkedAt).getTime();
  return Number.isFinite(checkedAt) && now - checkedAt >= 0 && now - checkedAt <= maxAgeMs;
}

const transitions: Record<EnvironmentResourceStatus, readonly EnvironmentResourceStatus[]> = {
  requested: ["provisioning", "failed"],
  provisioning: ["ready", "degraded", "failed"],
  ready: ["degraded", "deprovisioning"],
  degraded: ["provisioning", "ready", "failed", "deprovisioning"],
  failed: ["provisioning", "deprovisioning"],
  deprovisioning: ["deprovisioned", "failed"],
  deprovisioned: ["provisioning"],
};

export function canTransitionResource(
  from: EnvironmentResourceStatus,
  to: EnvironmentResourceStatus,
): boolean {
  return from === to || transitions[from].includes(to);
}

export function assertResourceTransition(
  from: EnvironmentResourceStatus,
  to: EnvironmentResourceStatus,
): void {
  if (!canTransitionResource(from, to)) {
    throw new Error(`Invalid environment resource transition: ${from} -> ${to}`);
  }
}

export function isIsolatedEnvironmentReady(
  resources: ReadonlyArray<{ resourceType: string; status: string }>,
): boolean {
  return ISOLATED_RESOURCE_TYPES.every((type) =>
    resources.some((resource) => resource.resourceType === type && resource.status === "ready"),
  );
}

export function assertProductionToDtdRefresh(
  source: { tenantId: number; kind: string },
  target: { tenantId: number; kind: string },
  sanitizationPolicy: string,
): asserts sanitizationPolicy is SanitizationPolicy {
  if (source.tenantId !== target.tenantId) {
    throw new Error("Production-to-DTD refresh cannot cross customer boundaries");
  }
  if (source.kind !== "production" || target.kind !== "dtd") {
    throw new Error("Refresh source must be Production and target must be the combined D/T/D environment");
  }
  if (!SANITIZATION_POLICIES.includes(sanitizationPolicy as SanitizationPolicy)) {
    throw new Error(`Refresh requires an explicit sanitization policy: ${SANITIZATION_POLICIES.join(", ")}`);
  }
}
