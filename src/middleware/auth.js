import { createRemoteJWKSet, jwtVerify } from "jose";
import { ObjectId } from "mongodb";
import { col } from "../db.js";

const authUrl = (
  process.env.BETTER_AUTH_URL ||
  (process.env.CLIENT_URL || "http://localhost:3000")
    .split(",")[0].trim()
).replace(/\/+$/, "");

const jwks = createRemoteJWKSet(
  new URL(`${authUrl}/api/auth/jwks`)
);

export async function verifyJWT(req, res, next) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Authentication required"
    });
  }

  let payload;

  try {
    const verified = await jwtVerify(
      header.slice(7),
      jwks,
      {
        issuer: authUrl,
        audience: authUrl,
        requiredClaims: ["exp", "sub"]
      }
    );

    payload = verified.payload;
  } catch {
    return res.status(401).json({
      message: "Invalid or expired token"
    });
  }

  try {
    const userId = String(payload.sub);

    const matches = [
      { _id: userId },
      { id: userId }
    ];

    if (ObjectId.isValid(userId)) {
      matches.push({
        _id: new ObjectId(userId)
      });
    }

    const user = await col("user").findOne({
      $or: matches
    });

    if (!user) {
      return res.status(401).json({
        message: "User account not found"
      });
    }

    if (user.isBlocked) {
      return res.status(403).json({
        message: "Your account has been blocked"
      });
    }

    req.user = {
      ...user,
      id: user._id
    };

    next();
  } catch {
    return res.status(500).json({
      message: "Authentication service unavailable"
    });
  }
}

export const requireRole =
  (...roles) =>
  (req, res, next) =>
    roles.includes(req.user?.role)
      ? next()
      : res.status(403).json({
          message: `Only ${roles.join(" / ")} accounts can perform this action`
        });