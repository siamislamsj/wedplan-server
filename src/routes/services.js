import { Router } from "express";
import { col, oid } from "../db.js";
import { verifyJWT } from "../middleware/auth.js";
import { CATEGORIES, esc, vendorJoin } from "../lib/common.js";

const r = Router();
const PUBLIC = { status: "approved", isActive: true };


r.get("/", async (req, res) => {
  const { q, category, location, sort, page, limit } = req.query;
  const match = { ...PUBLIC };
  if (q) match.serviceName = { $regex: esc(q), $options: "i" };
  if (category && CATEGORIES.includes(category)) match.category = category;
  if (location) match.location = { $regex: esc(location), $options: "i" };
  const order = sort === "price_asc" ? { effectivePrice: 1, _id: 1 } : sort === "price_desc" ? { effectivePrice: -1, _id: 1 } : { createdAt: -1, _id: 1 };
  const p = Math.max(1, parseInt(page) || 1);
  const l = Math.min(24, Math.max(1, parseInt(limit) || 12));
  const [items, total] = await Promise.all([
    col("services").aggregate([
      { $match: match },
      { $addFields: { effectivePrice: { $ifNull: ["$offerPrice", "$price"] } } },
      { $sort: order },
      { $skip: (p - 1) * l },
      { $limit: l },
      ...vendorJoin,
      { $project: { effectivePrice: 0 } },
    ]).toArray(),
    col("services").countDocuments(match),
  ]);
  res.json({ items, total, page: p, pages: Math.max(1, Math.ceil(total / l)) });
});

r.get("/featured", async (_req, res) => {
  const items = await col("services")
    .aggregate([{ $match: PUBLIC }, { $sort: { createdAt: -1 } }, { $limit: 6 }, ...vendorJoin])
    .toArray();
  res.json(items);
});

r.get("/offers", async (_req, res) => {
  const items = await col("services")
    .aggregate([
      { $match: { ...PUBLIC, $expr: { $and: [{ $gt: ["$offerPrice", 0] }, { $lt: ["$offerPrice", "$price"] }] } } },
      { $sort: { createdAt: -1 } },
      { $limit: 6 },
      ...vendorJoin,
    ])
    .toArray();
  res.json(items);
});

r.get("/categories", async (_req, res) => {
  const counts = await col("services").aggregate([{ $match: PUBLIC }, { $group: { _id: "$category", count: { $sum: 1 } } }]).toArray();
  res.json(CATEGORIES.map((name) => ({ name, count: counts.find((c) => c._id === name)?.count || 0 })));
});


r.get("/:id", verifyJWT, async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid service ID" });
  const [svc] = await col("services").aggregate([{ $match: { _id: id } }, ...vendorJoin]).toArray();
  if (!svc) return res.status(404).json({ message: "Service not found" });
  const visible = svc.status === "approved" && svc.isActive;
  const privileged = req.user.role === "admin" || String(svc.vendorId) === String(req.user._id);
  if (!visible && !privileged) return res.status(404).json({ message: "This service is not available" });
  res.json({ ...svc, bookable: visible });
});

export default r;
