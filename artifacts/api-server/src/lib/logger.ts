import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export function redactSensitiveUrl(url?: string) {
  if (!url) return url;
  return url
    .split("?")[0]
    .replace(
      /\/api\/tenant\/invitations\/token\/[^/]+/g,
      "/api/tenant/invitations/token/[redacted]",
    );
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
