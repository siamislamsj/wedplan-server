import { Router } from "express";
import { z } from "zod";
import { col, oid } from "../db.js";
import { verifyJWT, requireRole } from "../middleware/auth.js";
import { CATEGORIES, FREE_LIMIT, isPremium, countActive, enforceFreeLimit } from "../lib/common.js";

const r = Router();
r.use(verifyJWT, requireRole("vendor"));

const schema = z.object({
  serviceName: z.string().trim().min(3, "Service name must be at least 3 characters").max(120),
  category: z.enum(CATEGORIES, { message: "Choose a valid category" }),
  description: z.string().trim().min(20, "Description must be at least 20 characters").max(3000),
  price: z.coerce.number({ message: "Price must be a number" }).positive("Price must be greater than 0").max(10000000),
  offerPrice: z.preprocess((v) => v === null || v === "" || v === undefined ? null : Number(v), z.number().positive().nullable().optional()),
  location: z.string().trim().min(2, "Location is required").max(120),
  images: z.array(z.string().url()).min(1, "Upload at least one image").max(6),
});

const limitError = (res) =>
  res.status(403).json({ message: `Free plan allows ${FREE_LIMIT} active services. Upgrade to Premium to publish more.`, code: "PLAN_LIMIT" });

r.get("/stats", async (req, res) => {
  const v = req.user._id;
  if (!isPremium(req.user)) await enforceFreeLimit(v);
  const [totalServices, activeServices, pendingBookings, acceptedBookings] = await Promise.all([
    col("services").countDocuments({ vendorId: v }),
    col("services").countDocuments({ vendorId: v, status: "approved", isActive: true }),
    col("bookings").countDocuments({ vendorId: v, status: "pending" }),
    col("bookings").countDocuments({ vendorId: v, status: "accepted" }),
  ]);
  res.json({
    totalServices, activeServices, pendingBookings, acceptedBookings,
    plan: isPremium(req.user) ? "premium" : "free",
    subscriptionExpiresAt: req.user.subscriptionExpiresAt || null,
    cancelAtPeriodEnd: !!req.user.subscriptionCancelAtPeriodEnd,
    activeCount: await countActive(v),
    limit: isPremium(req.user) ? null : FREE_LIMIT,
  });
});

r.get("/services", async (req, res) => {
  if (!isPremium(req.user)) await enforceFreeLimit(req.user._id);
  res.json(await col("services").find({ vendorId: req.user._id }).sort({ createdAt: -1 }).toArray());
});

r.get("/services/:id", async (req, res) => {
  const id = oid(req.params.id);
  const svc = id && (await col("services").findOne({ _id: id, vendorId: req.user._id }));
  if (!svc) return res.status(404).json({ message: "Service not found" });
  res.json(svc);
});

r.post("/services", async (req, res) => {
  const data = schema.parse(req.body);
  if (data.offerPrice !== undefined && data.offerPrice >= data.price) return res.status(400).json({ message: "Offer price must be lower than the regular price" });
  if (!isPremium(req.user) && (await countActive(req.user._id)) >= FREE_LIMIT) return limitError(res);
  const doc = { ...data, vendorId: req.user._id, status: "pending", isActive: true, createdAt: new Date() };
  const { insertedId } = await col("services").insertOne(doc);
  res.status(201).json({ ...doc, _id: insertedId });
});

r.patch("/services/:id", async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid service ID" });
  const svc = await col("services").findOne({ _id: id, vendorId: req.user._id });
  if (!svc) return res.status(404).json({ message: "Service not found" });


  if (Object.keys(req.body).length === 1 && "isActive" in req.body) {
    const isActive = z.boolean().parse(req.body.isActive);
    if (isActive && !svc.isActive && !isPremium(req.user) && (await countActive(req.user._id)) >= FREE_LIMIT) return limitError(res);
    await col("services").updateOne({ _id: id }, { $set: { isActive } });
    return res.json({ message: isActive ? "Service is now available" : "Service paused" });
  }
 
  const data = schema.parse(req.body);
  if (data.offerPrice !== undefined && data.offerPrice >= data.price) return res.status(400).json({ message: "Offer price must be lower than the regular price" });
  await col("services").updateOne({ _id: id }, { $set: { ...data, status: "pending", updatedAt: new Date() } });
  res.json({ message: "Service updated and sent for review" });
});

r.delete("/services/:id", async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid service ID" });
  const { deletedCount } = await col("services").deleteOne({ _id: id, vendorId: req.user._id });
  if (!deletedCount) return res.status(404).json({ message: "Service not found" });
  res.json({ message: "Service deleted" });
});

export default r;
