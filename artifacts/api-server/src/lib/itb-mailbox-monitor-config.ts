import type { MailboxProvider } from "./itb-mailbox";

export type ItbMailboxMonitorConfig = {
  enabled: boolean;
  mailbox: string;
  query: string;
  intervalSeconds: number;
};

const DEFAULT_INTERVAL_SECONDS = 300;
const MIN_INTERVAL_SECONDS = 60;
const MAX_INTERVAL_SECONDS = 3600;

export const defaultItbMailboxQuery = (provider: MailboxProvider) =>
  provider === "outlook"
    ? "newer_than:30d bid tender invitation"
    : "newer_than:30d (bid OR tender OR invitation)";

export const defaultItbMailboxMonitorConfig = (provider: MailboxProvider): ItbMailboxMonitorConfig => ({
  enabled: false,
  mailbox: "me",
  query: defaultItbMailboxQuery(provider),
  intervalSeconds: DEFAULT_INTERVAL_SECONDS,
});

const parseJson = (value: string | null | undefined): Record<string, unknown> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

const boundedQuery = (value: unknown, provider: MailboxProvider) => {
  if (typeof value !== "string") return defaultItbMailboxQuery(provider);
  return value.replace(/\s+/g, " ").trim().slice(0, 180) || defaultItbMailboxQuery(provider);
};

const boundedInterval = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_INTERVAL_SECONDS;
  return Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, Math.round(parsed)));
};

const boundedMailbox = (value: unknown) => {
  if (typeof value !== "string") return "me";
  const normalized = value.trim();
  return /^[a-zA-Z0-9._-]{1,120}$/.test(normalized) ? normalized : "me";
};

export const parseItbMailboxMonitorConfig = (
  configuration: string | null | undefined,
  provider: MailboxProvider,
): ItbMailboxMonitorConfig => {
  const root = parseJson(configuration);
  const monitor = root.itbMailboxMonitor && typeof root.itbMailboxMonitor === "object"
    ? root.itbMailboxMonitor as Record<string, unknown>
    : {};
  const defaults = defaultItbMailboxMonitorConfig(provider);
  return {
    enabled: monitor.enabled === true,
    mailbox: boundedMailbox(monitor.mailbox ?? defaults.mailbox),
    query: boundedQuery(monitor.query ?? defaults.query, provider),
    intervalSeconds: boundedInterval(monitor.intervalSeconds ?? defaults.intervalSeconds),
  };
};

export const withItbMailboxMonitorConfig = (
  configuration: string | null | undefined,
  provider: MailboxProvider,
  patch: Partial<ItbMailboxMonitorConfig>,
) => {
  const root = parseJson(configuration);
  const current = parseItbMailboxMonitorConfig(configuration, provider);
  const next = {
    ...current,
    ...patch,
  };
  return JSON.stringify({
    ...root,
    itbMailboxMonitor: {
      enabled: Boolean(next.enabled),
      mailbox: boundedMailbox(next.mailbox),
      query: boundedQuery(next.query, provider),
      intervalSeconds: boundedInterval(next.intervalSeconds),
    },
  });
};

export const mailboxProviderFromIntegrationKey = (providerKey: string): MailboxProvider | null => {
  if (providerKey === "google_workspace") return "google-mail";
  if (providerKey === "microsoft_365") return "outlook";
  return null;
};

export const mailboxIntegrationKey = (provider: MailboxProvider) =>
  provider === "google-mail" ? "google_workspace" : "microsoft_365";