import { Router } from "express";
import { z } from "zod";
import { col, oid } from "../db.js";
import { verifyJWT, requireRole } from "../middleware/auth.js";
import { lookupOne } from "../lib/common.js";

const r = Router();
r.use(verifyJWT);

const today = () => new Date().toISOString().slice(0, 10);

const schema = z.object({
  serviceId: z.string(),
  eventDate: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid event date")
    .refine(d => d > today(), "Event date must be in the future"),
  eventLocation: z.string()
    .trim()
    .min(2, "Event location is required")
    .max(200),
  message: z.string().trim().max(1000).optional().default("")
});

const join = [
  ...lookupOne("services", "serviceId", "service", [
    "serviceName", "images", "price", "offerPrice", "location"
  ]),
  ...lookupOne("user", "customerId", "customer", [
    "name", "email", "image"
  ]),
  ...lookupOne("user", "vendorId", "vendor", [
    "name", "email", "image", "businessName"
  ])
];

const paymentJoin = {
  $lookup: {
    from: "transactions",
    let: { bid: "$_id", cid: "$customerId" },
    pipeline: [
      {
        $match: {
          $expr: {
            $and: [
              { $eq: ["$bookingId", "$$bid"] },
              { $eq: ["$customerId", "$$cid"] },
              { $eq: ["$plan", "wedding_service"] }
            ]
          }
        }
      },
      { $sort: { createdAt: -1 } },
      {
        $project: {
          status: 1,
          amount: 1,
          currency: 1,
          createdAt: 1,
          paidAt: 1
        }
      }
    ],
    as: "payments"
  }
};

r.post("/", requireRole("customer"), async (req, res) => {
  const data = schema.parse(req.body);
  const serviceId = oid(data.serviceId);

  const service = serviceId && await col("services").findOne({
    _id: serviceId,
    status: "approved",
    isActive: true
  });

  if (!service) {
    return res.status(404).json({
      message: "This service is not available for booking"
    });
  }

  if (String(service.vendorId) === String(req.user._id)) {
    return res.status(403).json({
      message: "You cannot book your own service"
    });
  }

  const duplicate = await col("bookings").findOne({
    serviceId,
    customerId: req.user._id,
    eventDate: data.eventDate,
    status: { $in: ["pending", "accepted"] }
  });

  if (duplicate) {
    return res.status(409).json({
      message: "You already have an active request for this service on that date"
    });
  }

  const doc = {
    serviceId,
    vendorId: service.vendorId,
    customerId: req.user._id,
    eventDate: data.eventDate,
    eventLocation: data.eventLocation,
    message: data.message,
    status: "pending",
    createdAt: new Date()
  };

  const { insertedId } = await col("bookings").insertOne(doc);

  res.status(201).json({
    ...doc,
    _id: insertedId
  });
});

r.get("/mine", requireRole("customer"), async (req, res) => {
  const items = await col("bookings").aggregate([
    { $match: { customerId: req.user._id } },
    { $sort: { createdAt: -1 } },
    ...join,
    paymentJoin
  ]).toArray();

  const count = status =>
    items.filter(b => b.status === status).length;

  res.json({
    items,
    stats: {
      total: items.length,
      pending: count("pending"),
      accepted: count("accepted"),
      rejected: count("rejected"),
      cancelled: count("cancelled")
    }
  });
});

r.patch("/:id/cancel", requireRole("customer"), async (req, res) => {
  const id = oid(req.params.id);

  if (!id) {
    return res.status(400).json({
      message: "Invalid booking ID"
    });
  }

  const { matchedCount } = await col("bookings").updateOne(
    {
      _id: id,
      customerId: req.user._id,
      status: "pending"
    },
    {
      $set: {
        status: "cancelled",
        updatedAt: new Date()
      }
    }
  );

  if (!matchedCount) {
    const exists = await col("bookings").findOne({
      _id: id,
      customerId: req.user._id
    });

    return res.status(exists ? 409 : 404).json({
      message: exists
        ? `A ${exists.status} booking cannot be cancelled`
        : "Booking not found"
    });
  }

  res.json({ message: "Booking cancelled" });
});

r.get("/vendor", requireRole("vendor"), async (req, res) => {
  const items = await col("bookings").aggregate([
    { $match: { vendorId: req.user._id } },
    { $sort: { createdAt: -1 } },
    ...join,
    paymentJoin
  ]).toArray();

  res.json(items);
});

r.patch("/:id/status", requireRole("vendor"), async (req, res) => {
  const id = oid(req.params.id);

  if (!id) {
    return res.status(400).json({
      message: "Invalid booking ID"
    });
  }

  const { status } = z.object({
    status: z.enum(["accepted", "rejected"])
  }).parse(req.body);

  const { matchedCount } = await col("bookings").updateOne(
    {
      _id: id,
      vendorId: req.user._id,
      status: "pending"
    },
    {
      $set: {
        status,
        updatedAt: new Date()
      }
    }
  );

  if (!matchedCount) {
    const exists = await col("bookings").findOne({
      _id: id,
      vendorId: req.user._id
    });

    return res.status(exists ? 409 : 404).json({
      message: exists
        ? `This request is already ${exists.status}`
        : "Booking not found"
    });
  }

  res.json({ message: `Booking ${status}` });
});

export default r;