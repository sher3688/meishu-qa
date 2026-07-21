import { integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Core user table backing auth flow.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = pgTable("qa_users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: integer("id").generatedAlwaysAsIdentity({ startWith: 1, increment: 1 }).primaryKey(),
  /** Identifier (openId for OAuth, or synthetic for password auth). Unique per user. */
  openId: varchar("openId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 64 }).notNull(),
  email: varchar("email", { length: 255 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: varchar("role", { length: 64 }).default("user").notNull(),
  isActive: integer("isActive").default(1).notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn", { mode: "date" }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Password users table - stores password hashes for password-based auth
 */
export const passwordUsers = pgTable("qa_password_users", {
  id: integer("id").generatedAlwaysAsIdentity({ startWith: 1, increment: 1 }).primaryKey(),
  userId: integer("userId").notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
});

export type PasswordUserRecord = typeof passwordUsers.$inferSelect;
export type InsertPasswordUserRecord = typeof passwordUsers.$inferInsert;

export const faqs = pgTable("qa_faqs", {
  id: integer("id").generatedAlwaysAsIdentity({ startWith: 1, increment: 1 }).primaryKey(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  category: varchar("category", { length: 64 }).notNull(),
  imageUrls: text("imageUrls"), // JSON array of image URLs
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
});

export type FAQ = typeof faqs.$inferSelect;
export type InsertFAQ = typeof faqs.$inferInsert;
