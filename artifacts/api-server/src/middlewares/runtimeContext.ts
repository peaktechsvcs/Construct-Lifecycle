import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { TenantRequest } from "./tenantContext";

const CONTEXT_MAX_AGE_MS = 5 * 60_000;

export type RuntimeRequest = TenantRequest & {
  runtimeTenantId?: number;
  runtimeEnvironmentId?: number;
  runtimeUserId?: number;
  runtimeRole?: string;
  runtimePermissions?: string[];
};

export type RuntimeAuthorizationClaims = {
  role: string;
  permissions: string[];
};

export function encodeRuntimeAuthorizationClaims(claims: RuntimeAuthorizationClaims): string {
  return Buffer.from(JSON.stringify({
    role: claims.role,
    permissions: [...new Set(claims.permissions)].sort(),
  }), "utf8").toString("base64url");
}

export function decodeRuntimeAuthorizationClaims(value: string): RuntimeAuthorizationClaims | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof parsed.role !== "string" || !/^[a-z_]{1,40}$/.test(parsed.role) ||
      !Array.isArray(parsed.permissions) ||
      parsed.permissions.some((permission) => typeof permission !== "string" || !/^[a-z_:.]{1,80}$/.test(permission))) {
      return undefined;
    }
    return {
      role: parsed.role,
      permissions: [...new Set(parsed.permissions as string[])].sort(),
    };
  } catch {
    return undefined;
  }
}

export interface ReplayGuard {
  /**
   * Atomically consumes a nonce until expiresAt. Returning false means that
   * nonce was already consumed. Implementations must fail closed on backend
   * errors rather than treating an unavailable store as a new nonce.
   */
  consume(nonce: string, expiresAt: number): Promise<boolean>;
}

/** Explicitly single-process only; never claim this is safe for a cluster. */
export class InMemoryReplayGuard implements ReplayGuard {
  private readonly entries = new Map<string, number>();
  private readonly maxEntries: number;
  constructor(maxEntries = 10_000) {
    this.maxEntries = maxEntries;
  }

  async consume(nonce: string, expiresAt: number): Promise<boolean> {
    const now = Date.now();
    for (const [key, expiry] of this.entries) {
      if (expiry <= now) this.entries.delete(key);
    }
    if (this.entries.has(nonce)) return false;
    if (this.entries.size >= this.maxEntries) return false;
    this.entries.set(nonce, expiresAt);
    return true;
  }
}

/** Shared/provider-backed guard for horizontally scaled runtime instances. */
export class HttpReplayGuard implements ReplayGuard {
  private readonly endpoint: string;
  private readonly token?: string;
  private readonly timeoutMs: number;
  constructor(
    endpoint: string,
    token?: string,
    timeoutMs = 2_000,
  ) {
    this.endpoint = endpoint;
    this.token = token;
    this.timeoutMs = timeoutMs;
  }

  async consume(nonce: string, expiresAt: number): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({ nonce, expiresAt }),
        signal: controller.signal,
        redirect: "error",
      });
      if (response.status === 409) return false;
      if (!response.ok) throw new Error(`Replay guard returned ${response.status}`);
      return true;
    } finally {
      clearTimeout(timeout);
    }
  }
}

let replayGuard: ReplayGuard = new InMemoryReplayGuard();
let replayGuardConfigured = false;

export function configureRuntimeReplayGuard(env: NodeJS.ProcessEnv = process.env): void {
  const mode = env.RUNTIME_REPLAY_GUARD_MODE;
  if (mode === "http") {
    if (!env.RUNTIME_REPLAY_GUARD_URL) {
      throw new Error("HTTP runtime replay protection requires RUNTIME_REPLAY_GUARD_URL");
    }
    replayGuard = new HttpReplayGuard(env.RUNTIME_REPLAY_GUARD_URL, env.RUNTIME_REPLAY_GUARD_TOKEN);
    replayGuardConfigured = true;
    return;
  }
  if (mode === "single-process") {
    replayGuard = new InMemoryReplayGuard();
    replayGuardConfigured = true;
    return;
  }
  throw new Error("Runtime replay protection requires RUNTIME_REPLAY_GUARD_MODE=http or single-process");
}

export function createRuntimeNonce(): string {
  return randomBytes(24).toString("base64url");
}

export function canonicalRuntimePath(value: string): string | undefined {
  if (!value.startsWith("/") || value.includes("#")) return undefined;
  try {
    const parsed = new URL(value, "http://runtime.invalid");
    const canonical = `${parsed.pathname || "/"}${parsed.search}`;
    return canonical === value ? canonical : undefined;
  } catch {
    return undefined;
  }
}

export function assertRuntimeProcessConfiguration(env: NodeJS.ProcessEnv = process.env): void {
  const runtimeConfigurationPresent = Boolean(
    env.RUNTIME_ENVIRONMENT_ID ||
    env.RUNTIME_TENANT_ID ||
    env.RUNTIME_DATABASE_URL ||
    env.RUNTIME_FORWARDING_SIGNING_SECRET ||
    env.RUNTIME_REPLAY_GUARD_MODE ||
    env.RUNTIME_REPLAY_GUARD_URL ||
    env.RUNTIME_REPLAY_GUARD_TOKEN,
  );
  if (!runtimeConfigurationPresent) return;
  if (!env.RUNTIME_ENVIRONMENT_ID) {
    throw new Error("Partial runtime configuration is forbidden: RUNTIME_ENVIRONMENT_ID is required");
  }
  if (!env.RUNTIME_TENANT_ID || !env.RUNTIME_DATABASE_URL || !env.RUNTIME_FORWARDING_SIGNING_SECRET) {
    throw new Error("Runtime processes require RUNTIME_TENANT_ID, RUNTIME_ENVIRONMENT_ID, RUNTIME_DATABASE_URL, and RUNTIME_FORWARDING_SIGNING_SECRET");
  }
  if (env.RUNTIME_DATABASE_URL === env.DATABASE_URL) {
    throw new Error("Runtime process DATABASE_URL must be isolated from the control-plane DATABASE_URL");
  }
  if (env.RUNTIME_REPLAY_GUARD_MODE === "http" && !env.RUNTIME_REPLAY_GUARD_URL) {
    throw new Error("HTTP runtime replay protection requires RUNTIME_REPLAY_GUARD_URL");
  }
  if (env.RUNTIME_REPLAY_GUARD_MODE === "http" && env.RUNTIME_REPLAY_GUARD_URL) {
    const replayUrl = new URL(env.RUNTIME_REPLAY_GUARD_URL);
    if (replayUrl.protocol !== "https:" || replayUrl.username || replayUrl.password) {
      throw new Error("Runtime replay guard URL must be HTTPS without credentials");
    }
  }
  if (!["http", "single-process"].includes(env.RUNTIME_REPLAY_GUARD_MODE ?? "")) {
    throw new Error("Runtime replay protection requires RUNTIME_REPLAY_GUARD_MODE=http or single-process");
  }
}

const forwardedHeader = (req: Request, name: string) => {
  const value = req.header(name);
  return typeof value === "string" ? value : undefined;
};

/**
 * Runtime processes accept only a short-lived, HMAC-signed forwarding
 * envelope. The nonce is consumed after signature/path validation.
 */
export async function requireSignedRuntimeContext(
  req: RuntimeRequest,
  res: Response,
  next: NextFunction,
) {
  const environmentId = process.env.RUNTIME_ENVIRONMENT_ID;
  const runtimeTenantId = process.env.RUNTIME_TENANT_ID;
  const databaseUrl = process.env.RUNTIME_DATABASE_URL;
  const secret = process.env.RUNTIME_FORWARDING_SIGNING_SECRET;
  if (!environmentId || !runtimeTenantId || !databaseUrl || !secret) {
    res.status(503).json({ error: "Runtime isolation is not configured" });
    return;
  }
  if (!replayGuardConfigured) {
    res.status(503).json({ error: "Runtime replay protection is not configured" });
    return;
  }
  if (process.env.RUNTIME_DATABASE_URL === process.env.DATABASE_URL) {
    res.status(503).json({ error: "Runtime must use its isolated DATABASE_URL" });
    return;
  }
  if (forwardedHeader(req, "x-runtime-hop-count") !== "1") {
    res.status(400).json({ error: "Recursive runtime dispatch is forbidden" });
    return;
  }
  const tenantId = forwardedHeader(req, "x-forwarded-tenant-id");
  const forwardedEnvironmentId = forwardedHeader(req, "x-forwarded-environment-id");
  const forwardedUserId = forwardedHeader(req, "x-forwarded-user-id");
  const authorizationClaims = forwardedHeader(req, "x-forwarded-authorization-claims");
  const timestamp = forwardedHeader(req, "x-forwarded-context-timestamp");
  const nonce = forwardedHeader(req, "x-forwarded-context-nonce");
  const forwardedPath = forwardedHeader(req, "x-forwarded-context-path");
  const signature = forwardedHeader(req, "x-forwarded-context-signature");
  if (!tenantId || !forwardedEnvironmentId || !forwardedUserId || !authorizationClaims ||
    !timestamp || !nonce || !forwardedPath || !signature) {
    res.status(401).json({ error: "Signed runtime context is required" });
    return;
  }
  if (forwardedEnvironmentId !== environmentId) {
    res.status(403).json({ error: "Runtime environment binding mismatch" });
    return;
  }
  if (tenantId !== runtimeTenantId) {
    res.status(403).json({ error: "Runtime tenant binding mismatch" });
    return;
  }
  const claims = decodeRuntimeAuthorizationClaims(authorizationClaims);
  if (!claims) {
    res.status(401).json({ error: "Invalid signed runtime authorization claims" });
    return;
  }
  const actualPath = canonicalRuntimePath(req.originalUrl);
  const signedPath = canonicalRuntimePath(forwardedPath);
  if (!actualPath || !signedPath || actualPath !== signedPath) {
    res.status(401).json({ error: "Signed runtime path mismatch" });
    return;
  }
  const timestampMs = Number(timestamp);
  if (!Number.isInteger(timestampMs) || Math.abs(Date.now() - timestampMs) > CONTEXT_MAX_AGE_MS) {
    res.status(401).json({ error: "Signed runtime context has expired" });
    return;
  }
  const canonical = `${tenantId}.${forwardedEnvironmentId}.${forwardedUserId}.${authorizationClaims}.${timestamp}.${nonce}.${req.method}.${signedPath}`;
  const expected = createHmac("sha256", secret).update(canonical).digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const suppliedBuffer = Buffer.from(signature, "utf8");
  if (expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    res.status(401).json({ error: "Invalid signed runtime context" });
    return;
  }
  try {
    if (!await replayGuard.consume(nonce, timestampMs + CONTEXT_MAX_AGE_MS)) {
      res.status(401).json({ error: "Signed runtime context has already been used" });
      return;
    }
  } catch {
    res.status(503).json({ error: "Runtime replay protection is unavailable" });
    return;
  }
  req.runtimeTenantId = Number(tenantId);
  req.runtimeEnvironmentId = Number(forwardedEnvironmentId);
  req.runtimeUserId = Number(forwardedUserId);
  req.runtimeRole = claims.role;
  req.runtimePermissions = claims.permissions;
  if (!Number.isInteger(req.runtimeTenantId) || req.runtimeTenantId < 1 || !Number.isInteger(req.runtimeEnvironmentId) || req.runtimeEnvironmentId < 1 || !Number.isInteger(req.runtimeUserId) || req.runtimeUserId < 1) {
    res.status(401).json({ error: "Invalid forwarded tenant context" });
    return;
  }
  req.tenantId = req.runtimeTenantId;
  req.environmentId = req.runtimeEnvironmentId;
  req.localUserId = req.runtimeUserId;
  req.environmentLabel = "isolated-runtime";
  next();
}