import { readFileSync } from "node:fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
const port = Number(process.env.PORT ?? 4000);

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!serviceAccountPath)
  throw new Error("FIREBASE_SERVICE_ACCOUNT_PATH is required");
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT is invalid");

export const config = { port };
export const pool = new Pool({ connectionString: databaseUrl });

if (getApps().length === 0) {
  const serviceAccount = JSON.parse(
    readFileSync(serviceAccountPath, "utf8"),
  ) as Parameters<typeof cert>[0];
  initializeApp({ credential: cert(serviceAccount) });
}
export const firestore = getFirestore();
