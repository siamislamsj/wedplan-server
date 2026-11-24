import { Router } from "express";
import { z } from "zod";
import { col, oid } from "../db.js";
import { verifyJWT, requireRole } from "../middleware/auth.js";
import { esc, vendorJoin, lookupOne } from "../lib/common.js";

const r = Router();
r.use(verifyJWT, requireRole("admin"));

r.get("/stats", async (_req, res) => {
  const [totalUsers, totalVendors, totalCustomers, totalServices, pendingServices, totalTransactions] = await Promise.all([
    col("user").countDocuments(),
    col("user").countDocuments({ role: "vendor" }),
    col("user").countDocuments({ role: "customer" }),
    col("services").countDocuments(),
    col("services").countDocuments({ status: "pending" }),
    col("transactions").countDocuments({ status: "paid" }),
  ]);
  res.json({ totalUsers, totalVendors, totalCustomers, totalServices, pendingServices, totalTransactions });
});

r.get("/users", async (req, res) => {
  const { q, role } = req.query;
  const filter = {};
  if (["admin", "vendor", "customer"].includes(role)) filter.role = role;
  if (q) filter.$or = [{ name: { $regex: esc(q), $options: "i" } }, { email: { $regex: esc(q), $options: "i" } }];
  res.json(
    await col("user")
      .find(filter, { projection: { name: 1, email: 1, image: 1, role: 1, isBlocked: 1, businessName: 1, subscriptionPlan: 1, subscriptionExpiresAt: 1, createdAt: 1, emailVerified: 1 } })
      .sort({ createdAt: -1 })
      .limit(300)
      .toArray()
  );
});

r.patch("/users/:id/block", async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid user ID" });
  const { isBlocked } = z.object({ isBlocked: z.boolean() }).parse(req.body);
  const target = await col("user").findOne({ _id: id });
  if (!target) return res.status(404).json({ message: "User not found" });
  if (target.role === "admin") return res.status(403).json({ message: "Admin accounts cannot be blocked" });
  await col("user").updateOne({ _id: id }, { $set: { isBlocked } });
  if (isBlocked) await col("session").deleteMany({ userId: { $in: [String(id), id] } }); 
  res.json({ message: isBlocked ? "User blocked" : "User unblocked" });
});

r.get("/services", async (req, res) => {
  const { q, status, category } = req.query;
  const match = {};
  if (["pending", "approved", "rejected"].includes(status)) match.status = status;
  if (category) match.category = category;
  if (q) match.serviceName = { $regex: esc(q), $options: "i" };
  res.json(await col("services").aggregate([{ $match: match }, { $sort: { createdAt: -1 } }, { $limit: 300 }, ...vendorJoin]).toArray());
});

r.patch("/services/:id/status", async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid service ID" });
  const { status } = z.object({ status: z.enum(["pending", "approved", "rejected"]) }).parse(req.body);
  const { matchedCount } = await col("services").updateOne({ _id: id }, { $set: { status, reviewedAt: new Date() } });
  if (!matchedCount) return res.status(404).json({ message: "Service not found" });
  res.json({ message: `Service ${status}` });
});

r.delete("/services/:id", async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid service ID" });
  const { deletedCount } = await col("services").deleteOne({ _id: id });
  if (!deletedCount) return res.status(404).json({ message: "Service not found" });
  res.json({ message: "Service deleted" });
});

r.get("/transactions", async (_req, res) => {
  res.json(
    await col("transactions")
      .aggregate([{ $sort: { createdAt: -1 } }, { $limit: 300 }, ...lookupOne("user", "vendorId", "vendor", ["name", "email", "businessName", "image"])])
      .toArray()
  );
});

export default r;
