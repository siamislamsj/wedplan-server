import { col } from "../db.js";

export const CATEGORIES = [
  "Photography & Videography",
  "Wedding Venues",
  "Decoration & Florist",
  "Catering Services",
  "Makeup & Styling",
  "Wedding Fashion",
];
export const FREE_LIMIT = 3;

export const isPremium = (u) =>
  u?.subscriptionPlan === "premium" &&
  !!u.subscriptionExpiresAt &&
  new Date(u.subscriptionExpiresAt) > new Date();

export const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");


export const lookupOne = (from, localField, as, fields) => [
  {
    $lookup: {
      from,
      localField,
      foreignField: "_id",
      pipeline: [{ $project: Object.fromEntries(fields.map((f) => [f, 1])) }],
      as,
    },
  },
  { $unwind: { path: `$${as}`, preserveNullAndEmptyArrays: true } },
];

export const vendorJoin = [
  ...lookupOne("user", "vendorId", "vendor", ["name", "image", "businessName", "subscriptionPlan", "subscriptionExpiresAt"]),
  {
    $addFields: {
      "vendor.isPremium": {
        $and: [{ $eq: ["$vendor.subscriptionPlan", "premium"] }, { $gt: ["$vendor.subscriptionExpiresAt", "$$NOW"] }],
      },
    },
  },
  { $project: { "vendor.subscriptionPlan": 0, "vendor.subscriptionExpiresAt": 0 } },
];


export const countActive = (vendorId) =>
  col("services").countDocuments({ vendorId, isActive: true, status: { $ne: "rejected" } });


export async function enforceFreeLimit(vendorId) {
  const active = await col("services")
    .find({ vendorId, isActive: true, status: { $ne: "rejected" } })
    .sort({ createdAt: 1 })
    .project({ _id: 1 })
    .toArray();
  const extra = active.slice(FREE_LIMIT).map((s) => s._id);
  if (extra.length) await col("services").updateMany({ _id: { $in: extra } }, { $set: { isActive: false } });
}
