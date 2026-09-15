-- Persist verified Stripe webhook deliveries so retries are no-ops.
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stripe_webhook_events_processed_idx
  ON stripe_webhook_events (processed_at);