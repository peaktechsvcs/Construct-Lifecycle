import { createHmac } from "node:crypto";
import https from "node:https";
import type { NextFunction, Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, environmentHealthChecksTable, environmentResourcesTable, environmentsTable, membershipsTable } from "@workspace/db";
import type { TenantRequest } from "./tenantContext";
import { getProvisioningProvider, isIsolatedEnvironmentReady, isRecentHealthyCheck, isRuntimeSigningBoundaryReady } from "../lib/provisioning";
import { canonicalRuntimePath, createRuntimeNonce } from "./runtimeContext";
import { encodeRuntimeAuthorizationClaims } from "./runtimeContext";
import { permissionsForRole } from "./rbac";
import { resolveRuntimeHost, type ResolvedRuntimeAddress } from "./runtimeNetwork";

const forwardedHeaders = new Set([
  "accept",
  "content-type",
  "if-none-match",
  "if-modified-since",
]);


export async function dispatchToEnvironmentRuntime(
  req: TenantRequest,
  res: Response,
  next: NextFunction,
) {
  if (req.header("x-runtime-hop-count")) {
    res.status(400).json({ error: "Recursive runtime dispatch is forbidden" });
    return;
  }
  if (!req.tenantId || !req.environmentId) {
    res.status(401).json({ error: "Tenant environment context is required" });
    return;
  }
  if (!req.localUserId) {
    res.status(401).json({ error: "Authenticated control-plane user is required" });
    return;
  }
  const [membership] = await db.select({ role: membershipsTable.role })
    .from(membershipsTable)
    .where(and(
      eq(membershipsTable.userId, req.localUserId),
      eq(membershipsTable.tenantId, req.tenantId),
    ))
    .limit(1);
  if (!membership) {
    res.status(403).json({ error: "Workspace membership is required for runtime dispatch" });
    return;
  }
  const [environment] = await db.select({ isolationEnforced: environmentsTable.isolationEnforced })
    .from(environmentsTable)
    .where(and(
      eq(environmentsTable.id, req.environmentId),
      eq(environmentsTable.tenantId, req.tenantId),
    ))
    .limit(1);
  if (!environment?.isolationEnforced) {
    next();
    return;
  }
  const resources = await db.select().from(environmentResourcesTable)
    .where(eq(environmentResourcesTable.environmentId, req.environmentId));
  const [health] = await db.select().from(environmentHealthChecksTable)
    .where(eq(environmentHealthChecksTable.environmentId, req.environmentId))
    .orderBy(desc(environmentHealthChecksTable.checkedAt)).limit(1);
  if (!isIsolatedEnvironmentReady(resources) || !isRuntimeSigningBoundaryReady(resources) || !isRecentHealthyCheck(health)) {
    res.status(409).json({
      error: "Selected environment execution context is not ready",
      details: "All isolated resources and a recent successful health check are required",
    });
    return;
  }
  const runtime = resources.find((resource) => resource.resourceType === "runtime");
  if (!runtime?.endpoint) {
    res.status(503).json({ error: "Selected environment has no runtime endpoint" });
    return;
  }
  const keyReference = runtime.secretReference ??
    resources.find((resource) => resource.resourceType === "secrets")?.secretReference;
  if (!keyReference) {
    res.status(503).json({ error: "Selected environment has no runtime signing-key reference" });
    return;
  }
  let target: URL;
  try {
    target = new URL(runtime.endpoint);
  } catch {
    res.status(503).json({ error: "Selected environment runtime endpoint is invalid" });
    return;
  }
  const allowedHosts = (process.env.RUNTIME_ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (!allowedHosts.length || !["https:"].includes(target.protocol) || target.hostname === req.hostname ||
    target.username || target.password || (target.port && target.port !== "443") ||
    !allowedHosts.includes(target.hostname)) {
    res.status(503).json({ error: "Runtime endpoint cannot route recursively to the control plane" });
    return;
  }
  let resolvedAddresses: ResolvedRuntimeAddress[];
  try {
    resolvedAddresses = await resolveRuntimeHost(target.hostname);
  } catch {
    res.status(503).json({ error: "Runtime endpoint did not pass DNS safety checks" });
    return;
  }
  let secret: string;
  try {
    secret = await getProvisioningProvider().resolveRuntimeSigningKey({
      tenantId: req.tenantId,
      environmentId: req.environmentId,
      keyReference,
    });
  } catch {
    res.status(503).json({ error: "Selected environment signing key is unavailable" });
    return;
  }
  const timestamp = String(Date.now());
  const nonce = createRuntimeNonce();
  const authorizationClaims = encodeRuntimeAuthorizationClaims({
    role: membership.role,
    permissions: permissionsForRole(membership.role),
  });
  const forwardedUrl = new URL(req.originalUrl, "http://control-plane.invalid");
  const dispatchPath = forwardedUrl.pathname.replace(/^\/api\/runtime/, "") || "/";
  const path = `${target.pathname.replace(/\/+$/, "")}${dispatchPath}`;
  target.pathname = path;
  target.search = forwardedUrl.search;
  const signedPath = canonicalRuntimePath(`${target.pathname}${target.search}`);
  if (!signedPath) {
    res.status(503).json({ error: "Runtime endpoint produced an invalid signed path" });
    return;
  }
  const canonical = `${req.tenantId}.${req.environmentId}.${req.localUserId}.${authorizationClaims}.${timestamp}.${nonce}.${req.method}.${signedPath}`;
  const signature = createHmac("sha256", secret).update(canonical).digest("hex");
  const headers = new Headers();
  for (const name of forwardedHeaders) {
    const value = req.header(name);
    if (value) headers.set(name, value);
  }
  headers.set("x-forwarded-tenant-id", String(req.tenantId));
  headers.set("x-forwarded-environment-id", String(req.environmentId));
  headers.set("x-forwarded-user-id", String(req.localUserId ?? ""));
  headers.set("x-forwarded-authorization-claims", authorizationClaims);
  headers.set("x-forwarded-context-path", signedPath);
  headers.set("x-forwarded-context-timestamp", timestamp);
  headers.set("x-forwarded-context-nonce", nonce);
  headers.set("x-forwarded-context-signature", signature);
  headers.set("x-runtime-hop-count", "1");
  const body = ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body ?? {});
  try {
    const response = await new Promise<{ status: number; headers: Record<string, string>; body: Buffer }>((resolve, reject) => {
      const address = resolvedAddresses[0];
      const request = https.request({
        hostname: address.address,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: req.method,
        headers: { ...Object.fromEntries(headers.entries()), host: target.host },
        servername: target.hostname,
        rejectUnauthorized: true,
        timeout: Number(process.env.RUNTIME_DISPATCH_TIMEOUT_MS ?? 10_000),
        lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve({
          status: response.statusCode ?? 502,
          headers: Object.fromEntries(Object.entries(response.headers).flatMap(([key, value]) =>
            typeof value === "string" ? [[key, value]] : value ? [[key, value.join(", ")]] : [])),
          body: Buffer.concat(chunks),
        }));
      });
      request.setTimeout(Number(process.env.RUNTIME_DISPATCH_TIMEOUT_MS ?? 10_000), () => request.destroy(new Error("Runtime request timed out")));
      request.on("error", reject);
      if (body) request.write(body);
      request.end();
    });
    res.status(response.status);
    for (const [key, value] of Object.entries(response.headers)) {
      if (key !== "content-length" && key !== "transfer-encoding") res.setHeader(key, value);
    }
    res.send(response.body);
  } catch (error) {
    req.log?.error({ err: error, environmentId: req.environmentId }, "environment runtime dispatch failed");
    res.status(503).json({ error: "Environment runtime is unavailable" });
  }
}