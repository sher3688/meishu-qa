import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { InsertUser, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _pool: Pool | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: ENV.databaseUrl,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
    });
    _pool.on("error", (err) => {
      console.error("[Database] Unexpected pool error:", err);
    });
  }
  return _pool;
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && ENV.databaseUrl) {
    try {
      _db = drizzle(getPool());
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    // PostgreSQL uses ON CONFLICT instead of ON DUPLICATE KEY UPDATE
    const values: InsertUser = {
      openId: user.openId,
      name: user.name ?? null as any,
      email: user.email ?? null,
      loginMethod: user.loginMethod ?? null,
      role: user.role ?? 'user',
      isActive: user.isActive ?? 1,
      lastSignedIn: user.lastSignedIn ?? new Date(),
    };

    if (user.openId === ENV.ownerOpenId && !user.role) {
      values.role = 'admin';
    }

    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.openId,
      set: {
        name: values.name,
        email: values.email,
        loginMethod: values.loginMethod,
        role: values.role,
        isActive: values.isActive,
        lastSignedIn: values.lastSignedIn,
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(userId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

import { faqs, InsertFAQ } from "../drizzle/schema";

export async function getAllFAQs() {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get FAQs: database not available");
    return [];
  }

  try {
    return await db.select().from(faqs);
  } catch (error) {
    console.error("[Database] Failed to get FAQs:", error);
    throw error;
  }
}

export async function createFAQ(data: InsertFAQ) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot create FAQ: database not available");
    return null;
  }

  try {
    const result = await db.insert(faqs).values(data).returning();
    return result[0];
  } catch (error) {
    console.error("[Database] Failed to create FAQ:", error);
    throw error;
  }
}

export async function updateFAQ(id: number, data: Partial<InsertFAQ>) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot update FAQ: database not available");
    return null;
  }

  try {
    const result = await db.update(faqs).set({ ...data, updatedAt: new Date() }).where(eq(faqs.id, id)).returning();
    return result[0];
  } catch (error) {
    console.error("[Database] Failed to update FAQ:", error);
    throw error;
  }
}

export async function deleteFAQ(id: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot delete FAQ: database not available");
    return null;
  }

  try {
    const result = await db.delete(faqs).where(eq(faqs.id, id)).returning();
    return result[0];
  } catch (error) {
    console.error("[Database] Failed to delete FAQ:", error);
    throw error;
  }
}

export async function initializeSchema() {
  const pool = getPool();
  try {
    // Create qa_users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS qa_users (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        "openId" VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(64) NOT NULL,
        email VARCHAR(255),
        "loginMethod" VARCHAR(64),
        role VARCHAR(64) DEFAULT 'user' NOT NULL,
        "isActive" INTEGER DEFAULT 1 NOT NULL,
        "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
        "updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL,
        "lastSignedIn" TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    // Create qa_password_users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS qa_password_users (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        "userId" INTEGER NOT NULL UNIQUE,
        "passwordHash" VARCHAR(255) NOT NULL,
        "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
        "updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    // Create qa_faqs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS qa_faqs (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        category VARCHAR(64) NOT NULL,
        "imageUrls" TEXT,
        "createdBy" INTEGER,
        "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
        "updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    console.log("[Database] Schema initialized successfully");
    return true;
  } catch (error) {
    console.error("[Database] Schema initialization failed:", error);
    return false;
  }
}
