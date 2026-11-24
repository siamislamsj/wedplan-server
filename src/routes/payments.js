import { Router } from "express";
import Stripe from "stripe";
import { col, oid } from "../db.js";
import { verifyJWT, requireRole } from "../middleware/auth.js";
import { isPremium, enforceFreeLimit } from "../lib/common.js";

let stripeClient;

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    const error = new Error("Stripe is not configured. Add STRIPE_SECRET_KEY to the server environment.");
    error.status = 503;
    throw error;
  }
  if (!stripeClient) stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}

const r = Router();
const CLIENT = () => (process.env.CLIENT_URL || "http://localhost:3000").split(",")[0].trim();
const price = () => Math.round(parseFloat(process.env.PREMIUM_PRICE_USD || "19.99") * 100);

const periodEnd = (sub) => new Date((sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end) * 1000);


r.post("/checkout", verifyJWT, requireRole("vendor"), async (req, res) => {
  if (isPremium(req.user)) return res.status(400).json({ message: "You already have an active Premium subscription" });
  const vendorId = String(req.user._id);
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: req.user.email,
    client_reference_id: vendorId,
    metadata: { vendorId },
    subscription_data: { metadata: { vendorId } },
    line_items: [
      process.env.STRIPE_PREMIUM_PRICE_ID
        ? { price: process.env.STRIPE_PREMIUM_PRICE_ID, quantity: 1 }
        : { quantity: 1, price_data: { currency: "usd", unit_amount: price(), recurring: { interval: "month" }, product_data: { name: "WedPlan Premium Vendor" } } },
    ],
    success_url: `${CLIENT()}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${CLIENT()}/payment/cancel`,
  });
  await col("transactions").insertOne({
    vendorId: req.user._id, plan: "premium", amount: price() / 100, currency: "usd",
    stripeSessionId: session.id, stripeSubscriptionId: null, status: "pending", createdAt: new Date(),
  });
  res.json({ url: session.url });
});


r.post("/service-checkout", verifyJWT, requireRole("customer"), async (req, res) => {
  const id = oid(req.body?.serviceId);
  if (!id) return res.status(400).json({ message: "Invalid service ID" });
  const svc = await col("services").findOne({ _id: id, status: "approved", isActive: true });
  if (!svc) return res.status(404).json({ message: "Service unavailable" });
  const usd = Number(svc.offerPrice > 0 && svc.offerPrice < svc.price ? svc.offerPrice : svc.price);
  if (!Number.isFinite(usd) || usd <= 0 || Math.round(usd * 100) < 50) return res.status(400).json({ message: "Invalid service price" });
  const customerId = String(req.user._id);
  const session = await getStripe().checkout.sessions.create({
    mode: "payment", customer_email: req.user.email, client_reference_id: customerId,
    metadata: { kind: "wedding_service", customerId, serviceId: String(id), vendorId: String(svc.vendorId) },
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: Math.round(usd * 100), product_data: { name: svc.serviceName.slice(0, 120) } } }],
    success_url: `${CLIENT()}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${CLIENT()}/payment/cancel`,
  });
  await col("transactions").insertOne({ customerId: req.user._id, vendorId: svc.vendorId, serviceId: id,
    plan: "wedding_service", amount: Math.round(usd * 100) / 100, currency: "usd",
    stripeSessionId: session.id, stripeSubscriptionId: null, status: "pending", createdAt: new Date() });
  res.json({ url: session.url });
});

r.get("/session/:sessionId", verifyJWT, async (req, res) => {
  const tx = await col("transactions").findOne({ stripeSessionId: req.params.sessionId, $or: [{ vendorId: req.user._id, plan: "premium" }, { customerId: req.user._id, plan: "wedding_service" }] });
  if (!tx) return res.status(404).json({ message: "Transaction not found" });
  let session;
  try { session = await getStripe().checkout.sessions.retrieve(req.params.sessionId); }
  catch { return res.status(404).json({ message: "Payment session not found" }); }
  if (session.client_reference_id !== String(req.user._id)) return res.status(403).json({ message: "This payment belongs to another account" });
  res.json({ kind: tx.plan, status: tx.status, stripeStatus: session.status, paymentStatus: session.payment_status, amount: tx.amount, currency: tx.currency, createdAt: tx.createdAt });
});

r.post("/cancel", verifyJWT, requireRole("vendor"), async (req, res) => {
  if (!isPremium(req.user) || !req.user.stripeSubscriptionId) return res.status(400).json({ message: "No active subscription to cancel" });
  await getStripe().subscriptions.update(req.user.stripeSubscriptionId, { cancel_at_period_end: true });
  await col("user").updateOne({ _id: req.user._id }, { $set: { subscriptionCancelAtPeriodEnd: true } });
  res.json({ message: "Subscription will end at the close of the current billing period" });
});

export default r;

export async function webhook(req, res) {
  if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_SECRET_KEY) {
    return res.status(503).send("Stripe webhook is not configured");
  }
  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).send(`Webhook signature verification failed: ${e.message}`);
  }
  try {
    await handleEvent(event);
    res.json({ received: true });
  } catch (e) {
    console.error("Webhook handler error", e);
    res.status(500).send("Webhook handler failed"); 
  }
}

async function handleEvent(event) {
  const obj = event.data.object;
  switch (event.type) {
    case "checkout.session.completed": {
      if (obj.mode === "payment" && obj.metadata?.kind === "wedding_service") {
        if (obj.payment_status !== "paid") return;
        const tx = await col("transactions").findOne({ stripeSessionId: obj.id, plan: "wedding_service" });
        if (!tx || tx.status === "paid" || String(tx.customerId) !== obj.metadata.customerId || String(tx.serviceId) !== obj.metadata.serviceId || obj.amount_total !== Math.round(tx.amount * 100) || obj.currency !== tx.currency) return;
        await col("transactions").updateOne({ _id: tx._id, status: "pending" }, { $set: { status: "paid", paidAt: new Date() } });
        return;
      }
      if (obj.mode !== "subscription" || obj.payment_status !== "paid") return;
      const tx = await col("transactions").findOne({ stripeSessionId: obj.id });
      if (!tx || tx.status === "paid") return;
      if (String(tx.vendorId) !== obj.metadata?.vendorId) return;
      const stripe = getStripe();
      const sub = await stripe.subscriptions.retrieve(obj.subscription);
      await col("transactions").updateOne(
        { _id: tx._id },
        { $set: { status: "paid", amount: obj.amount_total / 100, currency: obj.currency, stripeSubscriptionId: obj.subscription, paidAt: new Date() } }
      );
      await col("user").updateOne(
        { _id: tx.vendorId },
        { $set: { subscriptionPlan: "premium", subscriptionExpiresAt: periodEnd(sub), stripeSubscriptionId: obj.subscription, subscriptionCancelAtPeriodEnd: false } }
      );
      return;
    }
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed":
      await col("transactions").updateOne({ stripeSessionId: obj.id, status: "pending" }, { $set: { status: obj.id && event.type.endsWith("expired") ? "expired" : "failed" } });
      return;
    case "invoice.paid":
    case "invoice.payment_succeeded": {
      if (obj.billing_reason !== "subscription_cycle") return; 
      const subId = obj.subscription ?? obj.parent?.subscription_details?.subscription;
      const user = subId && (await col("user").findOne({ stripeSubscriptionId: subId }));
      if (!user) return;
      const sub = await getStripe().subscriptions.retrieve(subId);
      await col("user").updateOne({ _id: user._id }, { $set: { subscriptionPlan: "premium", subscriptionExpiresAt: periodEnd(sub) } });
      await col("transactions").updateOne(
        { stripeSessionId: `invoice_${obj.id}` },
        { $setOnInsert: { vendorId: user._id, plan: "premium", amount: obj.amount_paid / 100, currency: obj.currency, stripeSubscriptionId: subId, status: "paid", createdAt: new Date() } },
        { upsert: true }
      );
      return;
    }
    case "customer.subscription.updated":
      await col("user").updateOne({ stripeSubscriptionId: obj.id }, { $set: { subscriptionCancelAtPeriodEnd: !!obj.cancel_at_period_end } });
      return;
    case "customer.subscription.deleted": {
      const user = await col("user").findOne({ stripeSubscriptionId: obj.id });
      if (!user) return;
      await col("user").updateOne({ _id: user._id }, { $set: { subscriptionPlan: "free", subscriptionExpiresAt: new Date(), subscriptionCancelAtPeriodEnd: false } });
      await enforceFreeLimit(user._id);
      return;
    }
  }
}
