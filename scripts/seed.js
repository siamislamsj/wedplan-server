import "dotenv/config";
import { connectDB, col } from "../src/db.js";

const img = (id, w = 1200) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`;
await connectDB();

if (process.argv.includes("--clear")) {
  const vendors = await col("user").find({ isDemo: true }).project({ _id: 1 }).toArray();
  const ids = vendors.map((v) => v._id);
  const s = await col("services").deleteMany({ vendorId: { $in: ids } });
  const u = await col("user").deleteMany({ isDemo: true });
  console.log(`Removed ${u.deletedCount} demo vendors and ${s.deletedCount} services`);
  process.exit(0);
}

const vendors = [
  { key: "lumiere", name: "Lumière Studio", businessName: "Lumière Studio" },
  { key: "maison", name: "Maison Verte", businessName: "Maison Verte Events" },
  { key: "atelier", name: "Atelier Rose", businessName: "Atelier Rose" },
  { key: "thyme", name: "Table & Thyme", businessName: "Table & Thyme Catering" },
];
const services = [
  ["lumiere", "Cinematic Wedding Photography", "Photography & Videography", "Dhaka", 360.72, ["1520854221256-17451cc331bf", "1532712938310-34cb3982ef74"], "A two-photographer team with a cinematic highlight film. Includes the ceremony, couple portraits and an edited gallery delivered within three weeks."],
  ["maison", "Garden Gazebo Ceremony Venue", "Wedding Venues", "Sylhet", 641.28, ["1523438885200-e635ba2c371e", "1769812343890-4e406a33cfbe"], "A private garden with a white gazebo, seating for 150 guests and a covered reception area. Setup and styling coordination included."],
  ["maison", "Floral Ceiling & Stage Decoration", "Decoration & Florist", "Dhaka", 521.04, ["1529636798458-92182e662485", "1641834919507-b0271fe5186b"], "Hanging floral installations, draped backdrops and warm lighting for stages and entrances. Designed to your palette, installed the day before."],
  ["thyme", "Signature Reception Dining", "Catering Services", "Dhaka", 1282.57, ["1767050292710-8e5da59ec5d8", "1775126964424-913480443772"], "A plated three-course menu with live stations, full table styling, glassware and service staff for up to 200 guests."],
  ["atelier", "Bridal Makeup & Hair Styling", "Makeup & Styling", "Chattogram", 200.4, ["1622277430358-f4d134452e2e"], "Trial session plus wedding-day makeup and hair for the bride, with a touch-up kit and a stylist on hand through the ceremony."],
  ["atelier", "Couture Bridal Gowns & Suits", "Wedding Fashion", "Dhaka", 480.96, ["1620315118895-4f3ed831d14d"], "Made-to-measure gowns and tailored suits with two fittings, alterations and steaming on the wedding morning."],
  ["lumiere", "Beachfront Ceremony Package", "Wedding Venues", "Cox's Bazar", 1202.4, ["1700304096367-dae5ae5e5401", "1763560836989-d3636e2f82d8"], "A sunset ceremony on the sand with a white arch, aisle styling, seating for 80 and sound system. Permits and setup handled for you."],
  ["maison", "Blush & Ivory Floral Arch", "Decoration & Florist", "Chattogram", 280.56, ["1738025277281-582526f674c4", "1769812344081-92b3e2ac39c0"], "A hand-built floral arch in blush and ivory with aisle flowers and bouquets for the bridal party, installed and cleared by our team."],
];

const byKey = {};
for (const v of vendors) {
  const email = `demo+${v.key}@wedplan.example`;
  await col("user").updateOne(
    { email },
    { $setOnInsert: { name: v.name, email, emailVerified: true, image: null, role: "vendor", isBlocked: false, businessName: v.businessName, subscriptionPlan: "free", isDemo: true, createdAt: new Date(), updatedAt: new Date() } },
    { upsert: true }
  );
  byKey[v.key] = (await col("user").findOne({ email }))._id;
}
let added = 0;
for (const [k, serviceName, category, location, price, ids, description] of services) {
  const r = await col("services").updateOne(
    { vendorId: byKey[k], serviceName },
    { $set: { price, description }, $setOnInsert: { vendorId: byKey[k], serviceName, category, location, images: ids.map((i) => img(i)), status: "approved", isActive: true, createdAt: new Date() } },
    { upsert: true }
  );
  added += r.upsertedCount;
}
console.log(`Done. ${added} new services added (4 demo vendors).`);
process.exit(0);
