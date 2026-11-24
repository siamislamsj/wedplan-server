import { createRemoteJWKSet, jwtVerify } from "jose";
import { col } from "../db.js";

const authUrl = process.env.BETTER_AUTH_URL || (process.env.CLIENT_URL || "http://localhost:3000").split(",")[0].trim();
const jwks = createRemoteJWKSet(new URL(`${authUrl}/api/auth/jwks`));

export async function verifyJWT(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return res.status(401).json({ message: "Authentication required" });
  try {
    const { payload } = await jwtVerify(header.slice(7), jwks); 
    const email = payload.email?.toLowerCase();
    if (!email) return res.status(401).json({ message: "Invalid token" });
    let user = await col("user").findOne({ email });
    if (!user) {
     
      const doc = {
        name: payload.name, email, image: payload.image || null,
        role: ["vendor", "customer"].includes(payload.role) ? payload.role : "customer",
        isBlocked: false, subscriptionPlan: "free", createdAt: new Date(),
      };
      const { insertedId } = await col("user").insertOne(doc);
      user = { ...doc, _id: insertedId };
    }
    if (user.isBlocked) return res.status(403).json({ message: "Your account has been blocked" });
    
    req.user = { ...user, id: user._id };
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}

export const requireRole =
  (...roles) =>
  (req, res, next) =>
    roles.includes(req.user?.role)
      ? next()
      : res.status(403).json({ message: `Only ${roles.join(" / ")} accounts can perform this action` });
