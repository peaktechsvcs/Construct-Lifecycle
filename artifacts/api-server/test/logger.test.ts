import assert from "node:assert/strict";
import { test } from "node:test";
import { redactSensitiveUrl } from "../src/lib/logger.ts";

test("redacts invitation tokens from request URLs", () => {
  assert.equal(
    redactSensitiveUrl("/api/tenant/invitations/token/plaintext-token/accept?source=email"),
    "/api/tenant/invitations/token/[redacted]/accept",
  );
  assert.equal(redactSensitiveUrl("/api/projects?tenantId=7"), "/api/projects");
});