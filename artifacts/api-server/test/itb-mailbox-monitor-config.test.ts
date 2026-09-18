import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultItbMailboxMonitorConfig,
  mailboxProviderFromIntegrationKey,
  parseItbMailboxMonitorConfig,
  withItbMailboxMonitorConfig,
} from "../src/lib/itb-mailbox-monitor-config.ts";

test("uses provider-specific bounded monitor defaults", () => {
  assert.equal(defaultItbMailboxMonitorConfig("google-mail").enabled, false);
  assert.match(defaultItbMailboxMonitorConfig("google-mail").query, /bid OR tender OR invitation/);
  assert.match(defaultItbMailboxMonitorConfig("outlook").query, /bid tender invitation/);
  assert.equal(mailboxProviderFromIntegrationKey("google_workspace"), "google-mail");
  assert.equal(mailboxProviderFromIntegrationKey("microsoft_365"), "outlook");
  assert.equal(mailboxProviderFromIntegrationKey("stripe"), null);
});

test("preserves unrelated connector configuration while bounding monitor inputs", () => {
  const configuration = withItbMailboxMonitorConfig(
    JSON.stringify({ connectorName: "google-workspace", otherSetting: "preserved" }),
    "google-mail",
    {
      enabled: true,
      query: "  bid\r\n invitation  ",
      mailbox: "primary.inbox",
      intervalSeconds: 10,
    },
  );
  const parsed = JSON.parse(configuration) as Record<string, unknown>;
  assert.equal(parsed.connectorName, "google-workspace");
  assert.equal(parsed.otherSetting, "preserved");
  assert.deepEqual(parseItbMailboxMonitorConfig(configuration, "google-mail"), {
    enabled: true,
    mailbox: "primary.inbox",
    query: "bid invitation",
    intervalSeconds: 60,
  });
});

test("fails closed to safe defaults for malformed stored configuration", () => {
  assert.deepEqual(parseItbMailboxMonitorConfig("{not-json", "outlook"), defaultItbMailboxMonitorConfig("outlook"));
  assert.equal(parseItbMailboxMonitorConfig(JSON.stringify({
    itbMailboxMonitor: { enabled: true, mailbox: "../secrets", query: "", intervalSeconds: 99999 },
  }), "outlook").mailbox, "me");
});