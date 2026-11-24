import { MongoClient, ObjectId } from "mongodb";

let client;
let db;
let connecting;

export async function connectDB() {
  if (db) return db;
  if (!process.env.MONGODB_URI) {
    const error = new Error("MongoDB is not configured. Add MONGODB_URI to the server environment.");
    error.status = 503;
    throw error;
  }

  if (!connecting) {
    connecting = (async () => {
      client = new MongoClient(process.env.MONGODB_URI);
      await client.connect();
      const database = client.db(process.env.DB_NAME || "wedplan");
      await Promise.all([
        database.collection("services").createIndex({ status: 1, isActive: 1, createdAt: -1 }),
        database.collection("services").createIndex({ vendorId: 1 }),
        database.collection("bookings").createIndex({ customerId: 1 }),
        database.collection("bookings").createIndex({ vendorId: 1 }),
        database.collection("transactions").createIndex({ stripeSessionId: 1 }, { unique: true }),
      ]);
      db = database;
      return db;
    })();
  }

  try {
    return await connecting;
  } catch (error) {
    connecting = null;
    if (client) await client.close().catch(() => {});
    client = null;
    throw error;
  }
}

export const col = (name) => {
  if (!db) throw new Error("Database connection is not ready");
  return db.collection(name);
};

export const oid = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);
