import type { Logger } from "pino";

export const INVITATION_DELIVERY_OUTCOMES = ["sent", "failed", "not_configured"] as const;
export type InvitationDeliveryOutcome = (typeof INVITATION_DELIVERY_OUTCOMES)[number];

type InvitationEmailInput = {
  invitationId: number;
  tenantId: number;
  actorId: number;
  recipient: string;
  customerName: string;
  role: string;
  token: string;
  expiresAt: Date;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const DELIVERY_TIMEOUT_MS = 10_000;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const rateLimits = new Map<string, RateLimitEntry>();
type InvitationLog = {
  info?: Logger["info"];
  warn?: Logger["warn"];
};

function configuredAppEnvironment() {
  return process.env.APP_ENV ?? "development";
}

function providerName() {
  return (process.env.INVITATION_EMAIL_PROVIDER ?? "resend").trim().toLowerCase();
}

function configuredFromAddress() {
  return process.env.INVITATION_EMAIL_FROM?.trim() || process.env.EMAIL_FROM?.trim();
}

function configuredPublicUrl() {
  return process.env.INVITATION_PUBLIC_URL?.trim() || process.env.PUBLIC_APP_URL?.trim();
}

function configuredBasePath() {
  return process.env.INVITATION_BASE_PATH?.trim() || process.env.BASE_PATH?.trim() || "/";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildAcceptanceUrl(token: string) {
  const publicUrl = configuredPublicUrl();
  if (!publicUrl) return null;

  try {
    const origin = new URL(publicUrl);
    const basePath = configuredBasePath();
    const normalizedBasePath = `/${basePath.replace(/^\/+|\/+$/g, "")}/`;
    const path = `${normalizedBasePath}accept-invitation/${encodeURIComponent(token)}`;
    return new URL(path, origin).toString();
  } catch {
    return null;
  }
}

function formatExpiry(expiresAt: Date) {
  return expiresAt.toISOString();
}

function buildMessage(input: InvitationEmailInput, acceptanceUrl: string) {
  const recipient = escapeHtml(input.recipient);
  const customerName = escapeHtml(input.customerName);
  const role = escapeHtml(input.role);
  const expiry = formatExpiry(input.expiresAt);
  const safeExpiry = escapeHtml(expiry);
  const safeUrl = escapeHtml(acceptanceUrl);

  return {
    subject: `Invitation to join ${input.customerName}`,
    text: [
      `You have been invited to join ${input.customerName} as ${input.role}.`,
      "",
      `Recipient: ${input.recipient}`,
      `Role: ${input.role}`,
      `Accept and sign in: ${acceptanceUrl}`,
      `This one-time invitation expires in seven days (${expiry}).`,
    ].join("\n"),
    html: [
      "<!doctype html>",
      '<html lang="en"><body style="font-family:Arial,sans-serif;line-height:1.5;color:#10243e">',
      `<h1>You're invited to ${customerName}</h1>`,
      `<p>${recipient}, you have been invited to join <strong>${customerName}</strong> as <strong>${role}</strong>.</p>`,
      `<p><a href="${safeUrl}">Sign in and accept this invitation</a></p>`,
      `<p>This one-time invitation expires in seven days (${safeExpiry}).</p>`,
      "</body></html>",
    ].join(""),
  };
}

function providerConfiguration() {
  const provider = providerName();
  if (configuredAppEnvironment() !== "production") {
    return { provider, configured: false };
  }

  if (
    provider !== "resend"
    || !process.env.RESEND_API_KEY?.trim()
    || !configuredFromAddress()
    || !configuredPublicUrl()
    || !buildAcceptanceUrl("configuration-check")
  ) {
    return { provider, configured: false };
  }

  return { provider, configured: true };
}

async function sendWithResend(input: InvitationEmailInput, acceptanceUrl: string) {
  const from = configuredFromAddress();
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!from || !apiKey) throw new Error("Resend invitation configuration is incomplete");

  const message = buildMessage(input, acceptanceUrl);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.recipient],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`Invitation provider returned ${response.status}`);
}

export function checkInvitationRateLimit(
  tenantId: number,
  actorId: number,
  now = Date.now(),
) {
  const key = `${tenantId}:${actorId}`;
  const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (current.count >= RATE_LIMIT_MAX) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetInvitationRateLimits() {
  rateLimits.clear();
}

export async function deliverInvitationEmail(
  input: InvitationEmailInput,
  log: InvitationLog,
): Promise<InvitationDeliveryOutcome> {
  const startedAt = Date.now();
  const configuration = providerConfiguration();
  let outcome: InvitationDeliveryOutcome = "not_configured";

  if (configuration.configured) {
    const acceptanceUrl = buildAcceptanceUrl(input.token);
    if (acceptanceUrl) {
      try {
        if (configuration.provider === "resend") {
          await sendWithResend(input, acceptanceUrl);
          outcome = "sent";
        }
      } catch {
        outcome = "failed";
      }
    } else {
      outcome = "not_configured";
    }
  }

  const details = {
    invitationId: input.invitationId,
    tenantId: input.tenantId,
    actorId: input.actorId,
    provider: configuration.provider,
    outcome,
    durationMs: Date.now() - startedAt,
  };
  if (outcome === "failed") log.warn?.(details, "Invitation email delivery failed");
  else log.info?.(details, "Invitation email delivery completed");
  return outcome;
}