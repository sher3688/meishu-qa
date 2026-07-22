// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import { createServer } from "http";
import net from "net";
import multer from "multer";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// server/_core/storageProxy.ts
function registerStorageProxy(app) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = req.params[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }
    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/"
      );
      forgeUrl.searchParams.set("path", key);
      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` }
      });
      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }
      const { url } = await forgeResp.json();
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/routers.ts
import { z as z3 } from "zod";

// server/db.ts
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// drizzle/schema.ts
import { integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
var users = pgTable("qa_users", {
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
  lastSignedIn: timestamp("lastSignedIn", { mode: "date" }).defaultNow().notNull()
});
var passwordUsers = pgTable("qa_password_users", {
  id: integer("id").generatedAlwaysAsIdentity({ startWith: 1, increment: 1 }).primaryKey(),
  userId: integer("userId").notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull()
});
var faqs = pgTable("qa_faqs", {
  id: integer("id").generatedAlwaysAsIdentity({ startWith: 1, increment: 1 }).primaryKey(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  category: varchar("category", { length: 64 }).notNull(),
  imageUrls: text("imageUrls"),
  // JSON array of image URLs
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull()
});

// server/db.ts
var _pool = null;
var _db = null;
function getPool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 3e4
    });
    _pool.on("error", (err) => {
      console.error("[Database] Unexpected pool error:", err);
    });
  }
  return _pool;
}
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(getPool());
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
async function getUserById(userId) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return void 0;
  }
  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function getAllFAQs() {
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
async function createFAQ(data) {
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
async function updateFAQ(id, data) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot update FAQ: database not available");
    return null;
  }
  try {
    const result = await db.update(faqs).set({ ...data, updatedAt: /* @__PURE__ */ new Date() }).where(eq(faqs.id, id)).returning();
    return result[0];
  } catch (error) {
    console.error("[Database] Failed to update FAQ:", error);
    throw error;
  }
}
async function deleteFAQ(id) {
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
async function initializeSchema() {
  const pool = getPool();
  try {
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS qa_password_users (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        "userId" INTEGER NOT NULL UNIQUE,
        "passwordHash" VARCHAR(255) NOT NULL,
        "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
        "updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
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

// server/routers.ts
import { TRPCError as TRPCError3 } from "@trpc/server";

// server/auth-routes.ts
import { z as z2 } from "zod";

// server/_core/sdk.ts
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString2 = (value) => typeof value === "string" && value.length > 0;
var JWT_SECRET = new TextEncoder().encode(ENV.cookieSecret || "default-secret-change-in-production");
var JWT_ISSUER = "commqa-dash";
var sdk = {
  /**
   * Create a JWT session token for a user by userId
   */
  async createSessionToken(userId, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    return new SignJWT({
      userId,
      name: options.name || "",
      openId: options.openId || ""
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuer(JWT_ISSUER).setIssuedAt().setExpirationTime(expirationSeconds).sign(JWT_SECRET);
  },
  /**
   * Verify a JWT session token and return the payload
   */
  async verifySession(token) {
    if (!token) {
      console.warn("[Auth] Missing session token");
      return null;
    }
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET, {
        issuer: JWT_ISSUER,
        algorithms: ["HS256"]
      });
      const userId = payload.userId;
      const name = payload.name || "";
      if (!isNonEmptyString2(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        userId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  },
  /**
   * Authenticate a request using cookie-based JWT
   */
  async authenticateRequest(req) {
    const cookies = parseCookieHeader(req.headers.cookie || "");
    const sessionToken = cookies[COOKIE_NAME];
    const session = await this.verifySession(sessionToken);
    if (!session) {
      return null;
    }
    const user = await getUserById(session.userId);
    if (!user) {
      return null;
    }
    return user;
  }
};

// server/password-auth.ts
import bcrypt from "bcryptjs";
import { eq as eq2 } from "drizzle-orm";
async function authenticatePasswordUser(username, password) {
  try {
    const db = await getDb();
    if (!db) return null;
    const userResult = await db.select().from(users).where(eq2(users.name, username)).limit(1);
    const user = userResult[0];
    if (!user) {
      return null;
    }
    const passwordResult = await db.select().from(passwordUsers).where(eq2(passwordUsers.userId, user.id)).limit(1);
    const passwordRecord = passwordResult[0];
    if (!passwordRecord) {
      return null;
    }
    const isValid = await bcrypt.compare(password, passwordRecord.passwordHash);
    if (!isValid) {
      return null;
    }
    return {
      id: user.id,
      username: user.name,
      name: user.name,
      email: user.email || "",
      role: user.role || "user",
      openId: user.openId,
      isActive: true
    };
  } catch (error) {
    console.error("Authentication error:", error);
    return null;
  }
}
async function registerPasswordUser(username, password, name, email, role = "user") {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const existingResult = await db.select().from(users).where(eq2(users.name, username)).limit(1);
    if (existingResult.length > 0) {
      throw new Error("\u4F7F\u7528\u8005\u540D\u7A31\u5DF2\u88AB\u4F7F\u7528");
    }
    const now = /* @__PURE__ */ new Date();
    const openId = `password_${username}_${Date.now()}`;
    const insertResult = await db.insert(users).values({
      openId,
      name: username,
      email,
      role,
      loginMethod: "password",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now
    }).returning();
    const newUser = insertResult[0];
    if (!newUser) {
      throw new Error("Failed to create user");
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await db.insert(passwordUsers).values({
      userId: newUser.id,
      passwordHash,
      createdAt: now,
      updatedAt: now
    });
    return {
      id: newUser.id,
      username: newUser.name,
      name: newUser.name,
      email: newUser.email || "",
      role: newUser.role || "user",
      isActive: true
    };
  } catch (error) {
    throw new Error(error.message || "\u8A3B\u518A\u5931\u6557");
  }
}
async function initializeDemoUsers() {
  try {
    const db = await getDb();
    if (!db) {
      console.warn("[Password Auth] Database not available, skipping demo user init");
      return { success: false };
    }
    let adminResult;
    try {
      adminResult = await db.select().from(users).where(eq2(users.name, "admin")).limit(1);
    } catch (e) {
      console.warn("[Password Auth] Cannot query users table yet (schema migration pending):", e.message);
      return { success: false };
    }
    if (adminResult.length === 0) {
      try {
        await registerPasswordUser(
          "admin",
          "admin123",
          "\u7BA1\u7406\u54E1",
          "admin@example.com",
          "admin"
        );
        console.log("[Password Auth] Admin user initialized");
      } catch (e) {
        console.warn("[Password Auth] Failed to create admin:", e.message);
      }
    }
    let userResult;
    try {
      userResult = await db.select().from(users).where(eq2(users.name, "user")).limit(1);
    } catch (e) {
      console.warn("[Password Auth] Cannot query users table:", e.message);
      return { success: false };
    }
    if (userResult.length === 0) {
      try {
        await registerPasswordUser(
          "user",
          "user123",
          "\u4E00\u822C\u4F7F\u7528\u8005",
          "user@example.com",
          "user"
        );
        console.log("[Password Auth] User user initialized");
      } catch (e) {
        console.warn("[Password Auth] Failed to create user:", e.message);
      }
    }
    console.log("[Password Auth] Demo users initialized successfully");
    return { success: true };
  } catch (error) {
    console.error("[Password Auth] Initialize demo users error (non-fatal):", error);
    return { success: false };
  }
}

// server/auth-routes.ts
var passwordAuthRouter = router({
  /**
   * 帳密登入
   * 返回使用者資訊和 session token（同時設定 cookie）
   */
  login: publicProcedure.input(
    z2.object({
      username: z2.string().min(3, "\u4F7F\u7528\u8005\u540D\u7A31\u81F3\u5C11 3 \u500B\u5B57\u7B26"),
      password: z2.string().min(1, "\u5BC6\u78BC\u4E0D\u80FD\u70BA\u7A7A")
    })
  ).mutation(async ({ input, ctx }) => {
    const user = await authenticatePasswordUser(input.username, input.password);
    if (!user) {
      throw new Error("\u4F7F\u7528\u8005\u540D\u7A31\u6216\u5BC6\u78BC\u932F\u8AA4");
    }
    const token = await sdk.createSessionToken(user.id, {
      openId: user.openId,
      name: user.name,
      expiresInMs: ONE_YEAR_MS
    });
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      token
    };
  }),
  /**
   * 帳密註冊（僅管理者可用）
   */
  register: publicProcedure.input(
    z2.object({
      username: z2.string().min(3, "\u4F7F\u7528\u8005\u540D\u7A31\u81F3\u5C11 3 \u500B\u5B57\u7B26"),
      password: z2.string().min(6, "\u5BC6\u78BC\u81F3\u5C11 6 \u500B\u5B57\u7B26"),
      name: z2.string().min(1, "\u540D\u7A31\u4E0D\u80FD\u70BA\u7A7A"),
      role: z2.enum(["admin", "user"]).optional().default("user")
    })
  ).mutation(async ({ input }) => {
    try {
      const user = await registerPasswordUser(
        input.username,
        input.password,
        input.name,
        input.username + "@example.com",
        input.role
      );
      return {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role
      };
    } catch (error) {
      throw new Error(error.message || "\u8A3B\u518A\u5931\u6557");
    }
  }),
  /**
   * 初始化示例使用者（開發用）
   */
  initDemo: publicProcedure.mutation(async () => {
    try {
      await initializeDemoUsers();
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  })
});

// server/routers.ts
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true
      };
    }),
    passwordAuth: passwordAuthRouter
  }),
  faq: router({
    list: publicProcedure.query(async () => {
      return await getAllFAQs();
    }),
    create: protectedProcedure.input(
      z3.object({
        question: z3.string().min(1),
        answer: z3.string().min(1),
        category: z3.string().min(1),
        imageUrls: z3.string().optional()
      })
    ).mutation(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError3({
          code: "FORBIDDEN",
          message: "Only admins can create FAQs"
        });
      }
      return await createFAQ({
        question: input.question,
        answer: input.answer,
        category: input.category,
        imageUrls: input.imageUrls,
        createdBy: ctx.user.id
      });
    }),
    update: protectedProcedure.input(
      z3.object({
        id: z3.number(),
        question: z3.string().min(1).optional(),
        answer: z3.string().min(1).optional(),
        category: z3.string().min(1).optional(),
        imageUrls: z3.string().optional()
      })
    ).mutation(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError3({
          code: "FORBIDDEN",
          message: "Only admins can update FAQs"
        });
      }
      const { id, ...updateData } = input;
      return await updateFAQ(id, updateData);
    }),
    delete: protectedProcedure.input(z3.object({ id: z3.number() })).mutation(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError3({
          code: "FORBIDDEN",
          message: "Only admins can delete FAQs"
        });
      }
      return await deleteFAQ(input.id);
    })
  })
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
    if (!user) {
      const authHeader = opts.req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        const session = await sdk.verifySession(token);
        if (session) {
          const dbUser = await getUserById(session.userId);
          if (dbUser) {
            user = dbUser;
          }
        }
      }
    }
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/vite.ts
import express from "express";
import fs2 from "fs";
import { nanoid } from "nanoid";
import path2 from "path";
import { createServer as createViteServer } from "vite";

// vite.config.ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
var PROJECT_ROOT = import.meta.dirname;
var LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
var MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024;
var TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6);
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}
function trimLogFile(logPath, maxSize) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }
    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines = [];
    let keptBytes = 0;
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}
`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }
    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
  }
}
function writeToLogFile(source, entries) {
  if (entries.length === 0) return;
  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);
  const lines = entries.map((entry) => {
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });
  fs.appendFileSync(logPath, `${lines.join("\n")}
`, "utf-8");
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}
function vitePluginManusDebugCollector() {
  return {
    name: "manus-debug-collector",
    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true
            },
            injectTo: "head"
          }
        ]
      };
    },
    configureServer(server) {
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }
        const handlePayload = (payload) => {
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };
        const reqBody = req.body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    }
  };
}
var plugins = [react(), tailwindcss(), vitePluginManusRuntime(), vitePluginManusDebugCollector()];
var vite_config_default = defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1"
    ],
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/_core/vite.ts
async function setupVite(app, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    server: serverOptions,
    appType: "custom"
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );
      let template = await fs2.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app) {
  const distPath = process.env.NODE_ENV === "development" ? path2.resolve(import.meta.dirname, "../..", "dist", "public") : path2.resolve(import.meta.dirname, "public");
  if (!fs2.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/storage.ts
function getForgeConfig() {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;
  if (!forgeUrl || !forgeKey) {
    throw new Error(
      "Storage config missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY"
    );
  }
  return { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey };
}
function normalizeKey(relKey) {
  return relKey.replace(/^\/+/, "");
}
function appendHashSuffix(relKey) {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}
async function storagePut(relKey, data, contentType = "application/octet-stream") {
  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = appendHashSuffix(normalizeKey(relKey));
  const presignUrl = new URL("v1/storage/presign/put", forgeUrl + "/");
  presignUrl.searchParams.set("path", key);
  const presignResp = await fetch(presignUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` }
  });
  if (!presignResp.ok) {
    const msg = await presignResp.text().catch(() => presignResp.statusText);
    throw new Error(`Storage presign failed (${presignResp.status}): ${msg}`);
  }
  const { url: s3Url } = await presignResp.json();
  if (!s3Url) throw new Error("Forge returned empty presign URL");
  const blob = typeof data === "string" ? new Blob([data], { type: contentType }) : new Blob([data], { type: contentType });
  const uploadResp = await fetch(s3Url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob
  });
  if (!uploadResp.ok) {
    throw new Error(`Storage upload to S3 failed (${uploadResp.status})`);
  }
  return { key, url: `/manus-storage/${key}` };
}

// server/_core/index.ts
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
var schemaInitialized = false;
var demoUsersInitialized = false;
async function ensureSchema() {
  if (schemaInitialized) return;
  schemaInitialized = true;
  try {
    await initializeSchema();
    console.log("[Server] Database schema initialized");
  } catch (error) {
    console.error("[Server] Failed to initialize schema:", error);
  }
}
async function ensureDemoUsers() {
  if (demoUsersInitialized) return;
  demoUsersInitialized = true;
  try {
    await initializeDemoUsers();
    console.log("[Server] Demo users initialized");
  } catch (error) {
    console.error("[Server] Failed to initialize demo users:", error);
  }
}
function createApp() {
  const app = express2();
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    app.use(async (_req, _res, next) => {
      if (!schemaInitialized) {
        await ensureSchema();
      }
      if (!demoUsersInitialized) {
        await ensureDemoUsers();
      }
      next();
    });
  }
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  const upload = multer({ storage: multer.memoryStorage() });
  app.post("/api/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }
      const { originalname, buffer, mimetype } = req.file;
      const fileExtension = originalname.split(".").pop();
      const fileName = `faq-images/${Date.now()}.${fileExtension}`;
      const { url } = await storagePut(fileName, buffer, mimetype);
      res.json({ url });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ error: "Upload failed" });
    }
  });
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  return app;
}
async function startServer() {
  try {
    await initializeSchema();
    console.log("Database schema initialized");
  } catch (error) {
    console.error("Failed to initialize schema:", error);
  }
  try {
    await initializeDemoUsers();
    console.log("Demo users initialized successfully");
  } catch (error) {
    console.error("Failed to initialize demo users:", error);
  }
  const app = createApp();
  const server = createServer(app);
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  startServer().catch(console.error);
}
export {
  createApp
};
