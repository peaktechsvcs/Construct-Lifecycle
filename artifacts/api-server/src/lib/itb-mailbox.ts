export type MailboxProvider = "google-mail" | "outlook";

export type MailboxConnector = {
  proxy: (
    provider: MailboxProvider,
    path: string,
    options?: { method?: string; headers?: Record<string, string> },
  ) => Promise<{
    ok: boolean;
    status: number;
    json(): Promise<any>;
  }>;
};

export type MailboxPreview = {
  provider: MailboxProvider;
  threadId: string;
  messageId: string;
  subject: string;
  sender: string;
  receivedAt: string;
  snippet: string;
  imported: boolean;
  intakeId: number | null;
};

export type MailboxAttachment = {
  originalName: string;
  contentType: string;
  size: number;
  sourceAttachmentId: string;
  bytes: Buffer;
};

export type ImportedMailboxMessage = {
  sourceType: "gmail" | "outlook";
  sourceProvider: MailboxProvider;
  sourceMessageId: string;
  sourceThreadId: string;
  sourceSender: string;
  sourceSenderEmail: string | null;
  sourceSubject: string;
  sourceReceivedAt: string;
  sourceBody: string;
  attachments: MailboxAttachment[];
};

const MAX_SOURCE_CHARS = 200_000;
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

const clean = (value: string | undefined | null, max = 500) => value?.replace(/\s+/g, " ").trim().slice(0, max) || null;
const decodeBase64Url = (value: string) => Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const extractEmail = (text: string) => text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() ?? null;
const headerValue = (headers: Array<{ name?: string; value?: string }> | undefined, name: string) =>
  headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

const outlookSender = (value: any) => {
  const address = value?.emailAddress?.address;
  const name = value?.emailAddress?.name;
  return clean(name || address, 180) ?? "(unknown sender)";
};

const stripHtml = (value: string) => value
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/\s+/g, " ")
  .trim();

const collectMessageParts = (
  payload: any,
  result: { body: string; attachments: Array<{ id: string; name: string; contentType: string; size: number }> },
) => {
  if (!payload) return;
  const mime = payload.mimeType ?? "";
  if (payload.filename && payload.body?.attachmentId) {
    result.attachments.push({
      id: payload.body.attachmentId,
      name: payload.filename,
      contentType: mime || "application/octet-stream",
      size: Number(payload.body.size ?? 0),
    });
  }
  if (payload.body?.data && (mime === "text/plain" || mime === "text/html")) {
    const decoded = decodeBase64Url(payload.body.data).toString("utf8");
    if (!result.body || mime === "text/plain") result.body = decoded.replace(/<[^>]+>/g, " ");
  }
  for (const part of payload.parts ?? []) collectMessageParts(part, result);
};

const outlookSearchTerms = (query: string) => {
  const terms = query
    .replace(/\b(?:in|newer_than|older_than):[^\s)]+/gi, " ")
    .match(/[a-z0-9][a-z0-9@._-]{1,63}/gi) ?? [];
  return [...new Set(terms.map((term) => term.toLowerCase()))].slice(0, 8);
};

const outlookSearchQuery = (query: string) => {
  const terms = outlookSearchTerms(query);
  return terms.length ? `"${terms.join('" OR "')}"` : "\"bid\" OR \"tender\" OR \"invitation\"";
};

const outlookDateFilter = (query: string) => {
  const match = query.match(/\bnewer_than:(\d+)([dwmy])\b/i);
  if (!match) return "";
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === "w" ? 7 : unit === "m" ? 30 : unit === "y" ? 365 : 1;
  const since = new Date(Date.now() - amount * multiplier * 24 * 60 * 60 * 1000);
  return `receivedDateTime ge ${since.toISOString()}`;
};

const connectorPath = (value: string) => {
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}`;
  } catch {
    return value.startsWith("/") ? value : "";
  }
};

export const createItbMailboxClient = (connector: MailboxConnector) => {
  const request = async (provider: MailboxProvider, path: string, options: { method?: string; headers?: Record<string, string> } = { method: "GET" }) => {
    const response = await connector.proxy(provider, path, options);
    if (!response.ok) {
      const error = new Error(`${provider} mailbox connector returned ${response.status}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return response.json();
  };

  const preview = async (provider: MailboxProvider, query: string, pageSize: number, nextPageToken?: string): Promise<{ previews: MailboxPreview[]; nextPageToken: string | null }> => {
    if (provider === "google-mail") {
      const pageToken = nextPageToken ? `&pageToken=${encodeURIComponent(nextPageToken)}` : "";
      const result = await request(provider, `/gmail/v1/users/me/threads:search?q=${encodeURIComponent(query)}&pageSize=${pageSize}&view=THREAD_VIEW_MINIMAL${pageToken}`);
      const previews = (result.threads ?? []).flatMap((thread: any) => (thread.messages ?? []).slice(-1).map((message: any) => ({
        provider,
        threadId: String(thread.id),
        messageId: String(message.id),
        subject: clean(message.subject, 300) ?? "(no subject)",
        sender: clean(message.sender, 180) ?? "(unknown sender)",
        receivedAt: message.date ?? new Date().toISOString(),
        snippet: clean(message.snippet, 500) ?? "",
        imported: false,
         intakeId: null,
      })));
      return { previews, nextPageToken: result.nextPageToken ?? null };
    }

    const path = nextPageToken
      ? connectorPath(nextPageToken)
      : (() => {
        const dateFilter = outlookDateFilter(query);
        const filterParam = dateFilter ? `&$filter=${encodeURIComponent(dateFilter)}` : "";
        return `/v1.0/me/messages?$select=id,conversationId,subject,from,receivedDateTime,bodyPreview&$top=${pageSize}&$search=${encodeURIComponent(outlookSearchQuery(query))}${filterParam}`;
      })();
    const result = await request(provider, path, { method: "GET", headers: { ConsistencyLevel: "eventual" } });
    const previews = (result.value ?? []).map((message: any) => ({
      provider,
      threadId: String(message.conversationId ?? message.id),
      messageId: String(message.id),
      subject: clean(message.subject, 300) ?? "(no subject)",
      sender: outlookSender(message.from),
      receivedAt: message.receivedDateTime ?? new Date().toISOString(),
      snippet: clean(message.bodyPreview, 500) ?? "",
      imported: false,
       intakeId: null,
    }));
    return { previews, nextPageToken: result["@odata.nextLink"] ?? null };
  };

  const importMessage = async (provider: MailboxProvider, threadId: string, messageId?: string): Promise<ImportedMailboxMessage> => {
    if (provider === "outlook") {
      const message = await request("outlook", `/v1.0/me/messages/${encodeURIComponent(messageId ?? threadId)}?$select=id,conversationId,subject,from,receivedDateTime,body,bodyPreview,hasAttachments`);
      if (!message?.id) throw Object.assign(new Error("Mailbox message not found"), { status: 404 });
      const sourceMessageId = String(message.id);
      const attachments: MailboxAttachment[] = [];
      if (message.hasAttachments) {
        const attachmentList = await request("outlook", `/v1.0/me/messages/${encodeURIComponent(sourceMessageId)}/attachments?$top=20`);
        for (const attachment of (attachmentList.value ?? []).slice(0, 20)) {
          if (attachment.isInline) continue;
          let contentBytes = attachment.contentBytes;
          if (!contentBytes && attachment.id) {
            const fullAttachment = await request("outlook", `/v1.0/me/messages/${encodeURIComponent(sourceMessageId)}/attachments/${encodeURIComponent(attachment.id)}`);
            contentBytes = fullAttachment.contentBytes;
          }
          if (!contentBytes) continue;
          const bytes = Buffer.from(contentBytes, "base64");
          if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) continue;
          attachments.push({
            originalName: clean(attachment.name, 255) ?? "attachment",
            contentType: clean(attachment.contentType, 120) ?? "application/octet-stream",
            size: bytes.length,
            sourceAttachmentId: String(attachment.id),
            bytes,
          });
        }
      }
      return {
        sourceType: "outlook",
        sourceProvider: "outlook",
        sourceMessageId,
        sourceThreadId: String(message.conversationId ?? threadId),
        sourceSender: outlookSender(message.from),
        sourceSenderEmail: clean(message.from?.emailAddress?.address, 320),
        sourceSubject: clean(message.subject, 300) ?? "",
        sourceReceivedAt: message.receivedDateTime ?? new Date().toISOString(),
        sourceBody: stripHtml(String(message.body?.content ?? message.bodyPreview ?? "")).slice(0, MAX_SOURCE_CHARS),
        attachments,
      };
    }

    const thread = await request("google-mail", `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`);
    const messages = Array.isArray(thread.messages) ? thread.messages : [];
    const message = messageId ? messages.find((candidate: any) => candidate.id === messageId) : messages[messages.length - 1];
    if (!message) throw Object.assign(new Error("Mailbox message not found"), { status: 404 });
    const headers = message.payload?.headers as Array<{ name?: string; value?: string }> | undefined;
    const bodyResult = { body: message.snippet ?? "", attachments: [] as Array<{ id: string; name: string; contentType: string; size: number }> };
    collectMessageParts(message.payload, bodyResult);
    const sender = headerValue(headers, "From");
    const attachments: MailboxAttachment[] = [];
    for (const attachment of bodyResult.attachments.slice(0, 20)) {
      if (attachment.size > MAX_ATTACHMENT_BYTES) continue;
      try {
        const attachmentBody = await request("google-mail", `/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachment.id)}`) as { data?: string };
        if (!attachmentBody.data) continue;
        const bytes = decodeBase64Url(attachmentBody.data);
        if (bytes.length > MAX_ATTACHMENT_BYTES) continue;
        attachments.push({
          originalName: attachment.name,
          contentType: attachment.contentType,
          size: bytes.length,
          sourceAttachmentId: attachment.id,
          bytes,
        });
      } catch {
        // Attachment failures do not discard the otherwise reviewable message.
      }
    }
    return {
      sourceType: "gmail",
      sourceProvider: "google-mail",
      sourceMessageId: String(message.id),
      sourceThreadId: String(threadId),
      sourceSender: clean(sender, 180) ?? "",
      sourceSenderEmail: extractEmail(sender),
      sourceSubject: clean(headerValue(headers, "Subject") || message.subject, 300) ?? "",
      sourceReceivedAt: message.date ?? (message.internalDate ? new Date(Number(message.internalDate)).toISOString() : new Date().toISOString()),
      sourceBody: bodyResult.body.slice(0, MAX_SOURCE_CHARS),
      attachments,
    };
  };

  return { preview, importMessage, request };
};