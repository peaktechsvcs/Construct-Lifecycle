import assert from "node:assert/strict";
import test from "node:test";
import { createItbMailboxClient, type MailboxConnector } from "../src/lib/itb-mailbox.ts";

const base64 = (value: string) => Buffer.from(value, "utf8").toString("base64");

const fakeConnector = (
  handler: (provider: string, path: string, options?: { method?: string; headers?: Record<string, string> }) => any,
) => {
  const calls: Array<{ provider: string; path: string; options?: { method?: string; headers?: Record<string, string> } }> = [];
  const connector: MailboxConnector = {
    proxy: async (provider, path, options) => {
      calls.push({ provider, path, options });
      const result = await handler(provider, path, options);
      return {
        ok: true,
        status: 200,
        json: async () => result,
      };
    },
  };
  return { connector, calls };
};

test("previews Gmail threads through the managed connector response shape", async () => {
  const { connector, calls } = fakeConnector((_provider, path) => {
    assert.match(path, /\/gmail\/v1\/users\/me\/threads:search\?/);
    return {
      threads: [{
        id: "thread-g",
        messages: [
          { id: "older", subject: "Older", sender: "old@example.com", date: "2026-09-01T10:00:00Z", snippet: "old" },
          { id: "message-g", subject: "ITB North Campus", sender: "bids@example.com", date: "2026-09-12T10:00:00Z", snippet: "Please bid." },
        ],
      }],
      nextPageToken: "gmail-next",
    };
  });

  const result = await createItbMailboxClient(connector).preview("google-mail", "newer_than:30d (bid OR tender)", 10);

  assert.equal(calls[0].provider, "google-mail");
  assert.equal(result.nextPageToken, "gmail-next");
  assert.deepEqual(result.previews, [{
    provider: "google-mail",
    threadId: "thread-g",
    messageId: "message-g",
    subject: "ITB North Campus",
    sender: "bids@example.com",
    receivedAt: "2026-09-12T10:00:00Z",
    snippet: "Please bid.",
    imported: false,
  }]);
});

test("previews Outlook messages with Graph search, recent-date filtering, and pagination", async () => {
  const { connector, calls } = fakeConnector((_provider, path, options) => {
    assert.match(path, /\/v1\.0\/me\/messages\?/);
    assert.match(path, /\$search=/);
    assert.match(path, /\$filter=receivedDateTime%20ge%20/);
    assert.equal(options?.headers?.ConsistencyLevel, "eventual");
    return {
      value: [{
        id: "message-o",
        conversationId: "conversation-o",
        subject: "Outlook ITB",
        from: { emailAddress: { name: "GC Bids", address: "bids@builder.example" } },
        receivedDateTime: "2026-09-12T11:00:00Z",
        bodyPreview: "Bid due September 30.",
      }],
      "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/messages?$skiptoken=next",
    };
  });

  const result = await createItbMailboxClient(connector).preview("outlook", "newer_than:30d bid tender", 10);

  assert.equal(calls[0].provider, "outlook");
  assert.equal(result.nextPageToken, "https://graph.microsoft.com/v1.0/me/messages?$skiptoken=next");
  assert.deepEqual(result.previews[0], {
    provider: "outlook",
    threadId: "conversation-o",
    messageId: "message-o",
    subject: "Outlook ITB",
    sender: "GC Bids",
    receivedAt: "2026-09-12T11:00:00Z",
    snippet: "Bid due September 30.",
    imported: false,
  });
});

test("imports a Gmail message, decodes its body, and retrieves protected attachment bytes", async () => {
  const { connector, calls } = fakeConnector((_provider, path) => {
    if (path.includes("/threads/thread-g?format=full")) {
      return {
        messages: [{
          id: "message-g",
          date: "2026-09-12T10:00:00Z",
          payload: {
            mimeType: "multipart/mixed",
            headers: [
              { name: "From", value: "Estimating <bids@example.com>" },
              { name: "Subject", value: "ITB: North Campus" },
            ],
            parts: [
              { mimeType: "text/plain", body: { data: base64("Issuer: Northline Construction\nBid due: September 30, 2026") } },
              { filename: "plans.pdf", mimeType: "application/pdf", body: { attachmentId: "attachment-g", size: 3 } },
            ],
          },
        }],
      };
    }
    assert.match(path, /\/messages\/message-g\/attachments\/attachment-g$/);
    return { data: base64("pdf") };
  });

  const result = await createItbMailboxClient(connector).importMessage("google-mail", "thread-g", "message-g");

  assert.equal(result.sourceType, "gmail");
  assert.equal(result.sourceProvider, "google-mail");
  assert.equal(result.sourceMessageId, "message-g");
  assert.equal(result.sourceThreadId, "thread-g");
  assert.equal(result.sourceSenderEmail, "bids@example.com");
  assert.match(result.sourceBody, /Issuer: Northline Construction/);
  assert.deepEqual(result.attachments.map(({ bytes: _bytes, ...attachment }) => attachment), [{
    originalName: "plans.pdf",
    contentType: "application/pdf",
    size: 3,
    sourceAttachmentId: "attachment-g",
  }]);
  assert.equal(result.attachments[0].bytes.toString("utf8"), "pdf");
  assert.equal(calls.length, 2);
});

test("imports an Outlook message, resolves Graph attachment content, and skips inline attachments", async () => {
  const { connector, calls } = fakeConnector((_provider, path) => {
    if (path.includes("/messages/message-o?")) {
      return {
        id: "message-o",
        conversationId: "conversation-o",
        subject: "Outlook ITB",
        from: { emailAddress: { name: "GC Bids", address: "bids@builder.example" } },
        receivedDateTime: "2026-09-12T11:00:00Z",
        body: { contentType: "html", content: "<style>.x{}</style><p>Issuer: Builder Co</p><p>Bid due: September 30, 2026</p>" },
        bodyPreview: "Issuer: Builder Co",
        hasAttachments: true,
      };
    }
    if (path.endsWith("/attachments?$top=20")) {
      return {
        value: [
          { id: "inline-logo", name: "logo.png", contentType: "image/png", isInline: true, contentBytes: base64("logo") },
          { id: "attachment-o", name: "bid.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", isInline: false },
        ],
      };
    }
    assert.match(path, /\/attachments\/attachment-o$/);
    return { contentBytes: base64("workbook") };
  });

  const result = await createItbMailboxClient(connector).importMessage("outlook", "conversation-o", "message-o");

  assert.equal(result.sourceType, "outlook");
  assert.equal(result.sourceProvider, "outlook");
  assert.equal(result.sourceThreadId, "conversation-o");
  assert.equal(result.sourceSenderEmail, "bids@builder.example");
  assert.equal(result.sourceBody, "Issuer: Builder Co Bid due: September 30, 2026");
  assert.deepEqual(result.attachments.map(({ bytes: _bytes, ...attachment }) => attachment), [{
    originalName: "bid.xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: 8,
    sourceAttachmentId: "attachment-o",
  }]);
  assert.equal(result.attachments[0].bytes.toString("utf8"), "workbook");
  assert.equal(calls.length, 3);
});

test("mailbox adapter preserves connector status for fail-closed route handling", async () => {
  const connector: MailboxConnector = {
    proxy: async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    }),
  };

  await assert.rejects(
    () => createItbMailboxClient(connector).preview("outlook", "newer_than:30d bid", 10),
    (error: any) => error.status === 401,
  );
});