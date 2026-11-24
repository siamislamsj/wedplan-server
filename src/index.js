import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { connectDB } from "./db.js";
import services from "./routes/services.js";
import vendor from "./routes/vendor.js";
import bookings from "./routes/bookings.js";
import admin from "./routes/admin.js";
import payments, { webhook } from "./routes/payments.js";
import uploads from "./routes/uploads.js";

const app = express();
app.use(helmet());
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins, credentials: true }));

app.use(async (_req, _res, next) => {
  try { await connectDB(); next(); } catch (e) { next(e); }
});

app.post("/api/payments/webhook", express.raw({ type: "application/json" }), webhook);
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => res.json({ name: "WedPlan API", ok: true }));
app.use("/api/services", services);
app.use("/api/vendor", vendor);
app.use("/api/bookings", bookings);
app.use("/api/admin", admin);
app.use("/api/payments", payments);
app.use("/api/uploads", uploads);

app.use((_req, res) => res.status(404).json({ message: "Route not found" }));
app.use((err, _req, res, _next) => {
  if (err.name === "ZodError") return res.status(400).json({ message: err.issues[0]?.message || "Invalid data", issues: err.issues });
  if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ message: "Image must be 5 MB or smaller" });
  if (err.message === "Only image files are allowed") return res.status(400).json({ message: err.message });
  console.error(err);
  res.status(err.status || 500).json({ message: err.status ? err.message : "Something went wrong on the server" });
});

if (!process.env.VERCEL) {
  const port = process.env.PORT || 5000;
  app.listen(port, () => console.log(`WedPlan API running on :${port}`));
}
export default app;
