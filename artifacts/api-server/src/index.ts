import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./stripeClient";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function initializeStripe() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Stripe integration");

  try {
    await runMigrations({ databaseUrl });
    const sync = await getStripeSync();
    const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
    if (!domain) throw new Error("REPLIT_DOMAINS is required for Stripe webhooks");

    await sync.findOrCreateManagedWebhook(`https://${domain}/api/stripe/webhook`);
    void sync.syncBackfill().then(
      (result) => logger.info({ result }, "Stripe backfill completed"),
      (error) => logger.error({ err: error }, "Stripe backfill failed"),
    );
    logger.info("Stripe sync initialized");
  } catch (error) {
    logger.warn({ err: error }, "Stripe sync is unavailable; connector proxy billing remains enabled");
  }
}

await initializeStripe();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
