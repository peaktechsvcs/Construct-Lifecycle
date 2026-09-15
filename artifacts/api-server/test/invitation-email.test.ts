import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { deliverInvitationEmail } from "../src/lib/invitation-email.ts";

const originalEnvironment = { ...process.env };
const originalFetch = globalThis.fetch;

afterEach(() => {
  process.env = { ...originalEnvironment };
  globalThis.fetch = originalFetch;
});

function input() {
  return {
    invitationId: 41,
    tenantId: 7,
    actorId: 13,
    recipient: "invitee@example.test",
    customerName: "Northwind Builders",
    role: "member",
    token: "one-time-token",
    expiresAt: new Date("2026-09-22T12:00:00.000Z"),
  };
}

test("disables invitation email outside production even when provider secrets exist", async () => {
  process.env.APP_ENV = "test";
  process.env.RESEND_API_KEY = "test-key";
  process.env.INVITATION_EMAIL_FROM = "no-reply@example.test";
  process.env.INVITATION_PUBLIC_URL = "https://app.example.test";
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, { status: 200 });
  };

  const result = await deliverInvitationEmail(input(), { info() {}, warn() {} });
  assert.equal(result, "not_configured");
  assert.equal(calls, 0);
});

test("reports missing production configuration without attempting delivery", async () => {
  process.env.APP_ENV = "production";
  delete process.env.RESEND_API_KEY;
  delete process.env.INVITATION_EMAIL_FROM;
  delete process.env.INVITATION_PUBLIC_URL;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, { status: 200 });
  };

  const result = await deliverInvitationEmail(input(), { info() {}, warn() {} });
  assert.equal(result, "not_configured");
  assert.equal(calls, 0);
});

test("sends a safe invitation message through the configured provider", async () => {
  process.env.APP_ENV = "production";
  process.env.RESEND_API_KEY = "test-key";
  process.env.INVITATION_EMAIL_FROM = "no-reply@example.test";
  process.env.INVITATION_PUBLIC_URL = "https://app.example.test";
  process.env.INVITATION_BASE_PATH = "/construct/";
  let requestBody: Record<string, unknown> | undefined;
  let requestUrl = "";
  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(null, { status: 200 });
  };

  const result = await deliverInvitationEmail(input(), { info() {}, warn() {} });
  assert.equal(result, "sent");
  assert.equal(requestUrl, "https://api.resend.com/emails");
  assert.deepEqual(requestBody?.to, ["invitee@example.test"]);
  assert.match(String(requestBody?.text), /Northwind Builders/);
  assert.match(String(requestBody?.text), /member/);
  assert.match(String(requestBody?.text), /https:\/\/app\.example\.test\/construct\/accept-invitation\/one-time-token/);
  assert.doesNotMatch(JSON.stringify(requestBody), /tokenHash|sha256/);
});

test("keeps the invitation pending when the provider fails", async () => {
  process.env.APP_ENV = "production";
  process.env.RESEND_API_KEY = "test-key";
  process.env.INVITATION_EMAIL_FROM = "no-reply@example.test";
  process.env.INVITATION_PUBLIC_URL = "https://app.example.test";
  const logs: unknown[] = [];
  globalThis.fetch = async () => new Response(null, { status: 503 });

  const result = await deliverInvitationEmail(input(), {
    info(details) { logs.push(details); },
    warn(details) { logs.push(details); },
  });
  assert.equal(result, "failed");
  assert.equal(logs.length, 1);
  assert.doesNotMatch(JSON.stringify(logs), /invitee@example\.test|one-time-token/);
});