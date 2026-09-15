import { eq, sql } from "drizzle-orm";
import { db, stripeWebhookEventsTable } from "@workspace/db";
import { getStripeSync, type VerifiedStripeSync } from "./stripeClient";

type StripeWebhookProcessor = {
  processWebhook(payload: Buffer, signature: string): Promise<void>;
  verifyWebhook?: VerifiedStripeSync["verifyWebhook"];
  processEvent?: VerifiedStripeSync["processEvent"];
};

type WebhookMetadata = {
  eventId: string;
  eventType: string;
};

const EVENT_ID_PATTERN = /^evt_[A-Za-z0-9]+$/;
const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_.]{1,127}$/;

function readWebhookMetadata(payload: Buffer): WebhookMetadata | null {
  try {
    const parsed = JSON.parse(payload.toString("utf8")) as Record<string, unknown>;
    if (
      typeof parsed.id !== "string"
      || !EVENT_ID_PATTERN.test(parsed.id)
      || typeof parsed.type !== "string"
      || !EVENT_TYPE_PATTERN.test(parsed.type)
    ) {
      return null;
    }
    return { eventId: parsed.id, eventType: parsed.type };
  } catch {
    return null;
  }
}

async function processOnce(
  metadata: WebhookMetadata,
  process: () => Promise<void>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${metadata.eventId}, 0))`);
    const [alreadyProcessed] = await tx.select({ eventId: stripeWebhookEventsTable.eventId })
      .from(stripeWebhookEventsTable)
      .where(eq(stripeWebhookEventsTable.eventId, metadata.eventId))
      .limit(1);
    if (alreadyProcessed) return;

    await process();
    await tx.insert(stripeWebhookEventsTable).values({
      eventId: metadata.eventId,
      eventType: metadata.eventType,
    });
  });
}

export class WebhookHandlers {
  static async processWebhook(
    payload: Buffer,
    signature: string,
    syncOverride?: StripeWebhookProcessor,
  ): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error("Stripe webhook payload must be a raw Buffer");
    }

    const sync = syncOverride ?? await getStripeSync();
    const metadata = readWebhookMetadata(payload);
    if (!metadata) {
      await sync.processWebhook(payload, signature);
      return;
    }

    const verifiedEvent = sync.verifyWebhook
      ? await sync.verifyWebhook(payload, signature)
      : undefined;
    await processOnce(metadata, () => verifiedEvent && sync.processEvent
      ? sync.processEvent(verifiedEvent)
      : sync.processWebhook(payload, signature));
  }
}