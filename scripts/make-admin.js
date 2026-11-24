import "dotenv/config";
import { connectDB, col } from "../src/db.js";

const email = process.argv[2];
if (!email) { console.error("Provide an email: npm run make-admin -- you@example.com"); process.exit(1); }
await connectDB();
const { matchedCount } = await col("user").updateOne({ email: email.toLowerCase() }, { $set: { role: "admin", isBlocked: false } });
if (!matchedCount) {
  console.error(`No user found with email ${email}. Register the account first.`);
  process.exit(1);
}
console.log(`${email} is now an admin`);
process.exit(0);
