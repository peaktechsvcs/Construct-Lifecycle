import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
const isRuntimeMode = Boolean(process.env.RUNTIME_ENVIRONMENT_ID);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
if (!isRuntimeMode) {
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      const signatureHeader = req.headers["stripe-signature"];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
      if (!signature) {
        res.status(400).json({ error: "Missing Stripe signature" });
        return;
      }

      try {
        const { WebhookHandlers } = await import("./webhookHandlers");
        await WebhookHandlers.processWebhook(req.body as Buffer, signature);
        req.log.info("Stripe webhook processed");
        res.status(200).json({ received: true });
      } catch (error) {
        req.log.error({ err: error }, "Stripe webhook processing failed");
        res.status(400).json({ error: "Webhook processing failed" });
      }
    },
  );
}
app.use(cors());
if (!process.env.RUNTIME_ENVIRONMENT_ID) {
  const [{ clerkMiddleware }, { publishableKeyFromHost }, clerkProxy] = await Promise.all([
    import("@clerk/express"),
    import("@clerk/shared/keys"),
    import("./middlewares/clerkProxyMiddleware"),
  ]);
  app.use(clerkProxy.CLERK_PROXY_PATH, clerkProxy.clerkProxyMiddleware());
  app.use(clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(clerkProxy.getClerkProxyHost(req) ?? "", process.env.CLERK_PUBLISHABLE_KEY),
  })));
}
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
