import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { initTRPC, TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
import { SignJWT, jwtVerify } from "jose";
import superjson from "superjson";
import { z } from "zod";
import { COOKIE_NAME, ONE_YEAR_MS } from "../shared/const";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB: any;
  JWT_SECRET?: string;
}

type DbUser = {
  id: number;
  openId: string;
  name: string;
  email: string | null;
  loginMethod: string | null;
  role: string;
  isActive: number;
  createdAt: string | null;
  updatedAt: string | null;
  lastSignedIn: string | null;
};

type Context = {
  req: Request;
  resHeaders: Headers;
  env: Env;
  user: DbUser | null;
};

function secretKey(secret?: string) {
  return new TextEncoder().encode(secret || "meishu-qa-change-this-secret");
}

async function createToken(env: Env, user: DbUser) {
  const now = Date.now();
  return new SignJWT({ userId: user.id, name: user.name, openId: user.openId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("commqa-dash")
    .setIssuedAt()
    .setExpirationTime(Math.floor((now + ONE_YEAR_MS) / 1000))
    .sign(secretKey(env.JWT_SECRET));
}

async function verifyToken(env: Env, token: string | undefined | null) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(env.JWT_SECRET), {
      issuer: "commqa-dash",
      algorithms: ["HS256"],
    });
    const userId = Number((payload as any).userId);
    return Number.isFinite(userId) ? userId : null;
  } catch {
    return null;
  }
}

async function findUserById(env: Env, id: number): Promise<DbUser | null> {
  return (await env.DB.prepare(
    `SELECT id, openId, name, email, loginMethod, role, isActive, createdAt, updatedAt, lastSignedIn
       FROM qa_users WHERE id = ? LIMIT 1`,
  ).bind(id).first()) as DbUser | null;
}

async function authenticateRequest(req: Request, env: Env) {
  let token: string | undefined;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) token = auth.slice(7);
  if (!token) {
    const cookies = parseCookie(req.headers.get("cookie") || "");
    token = cookies[COOKIE_NAME];
  }
  const userId = await verifyToken(env, token);
  return userId ? findUserById(env, userId) : null;
}

function setSessionCookie(headers: Headers, req: Request, token: string) {
  const secure = new URL(req.url).protocol === "https:";
  headers.append(
    "Set-Cookie",
    serializeCookie(COOKIE_NAME, token, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure,
      maxAge: Math.floor(ONE_YEAR_MS / 1000),
    }),
  );
}

function clearSessionCookie(headers: Headers, req: Request) {
  const secure = new URL(req.url).protocol === "https:";
  headers.append(
    "Set-Cookie",
    serializeCookie(COOKIE_NAME, "", {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure,
      maxAge: 0,
    }),
  );
}

const t = initTRPC.context<Context>().create({ transformer: superjson });
const router = t.router;
const publicProcedure = t.procedure;
const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Please login (10001)" });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

const faqSelect = `SELECT id, question, answer, category, imageUrls FROM qa_faqs`;

const appRouter = router({
  system: router({
    health: publicProcedure.input(z.object({ timestamp: z.number().min(0) })).query(() => ({ ok: true })),
    notifyOwner: protectedProcedure
      .input(z.object({ title: z.string(), content: z.string() }))
      .mutation(() => ({ success: false })),
  }),
  auth: router({
    me: publicProcedure.query(({ ctx }) => ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      clearSessionCookie(ctx.resHeaders, ctx.req);
      return { success: true } as const;
    }),
    passwordAuth: router({
      login: publicProcedure
        .input(z.object({ username: z.string().min(3), password: z.string().min(1) }))
        .mutation(async ({ input, ctx }) => {
          const row = (await ctx.env.DB.prepare(
            `SELECT u.id, u.openId, u.name, u.email, u.loginMethod, u.role,
                    u.isActive, u.createdAt, u.updatedAt, u.lastSignedIn,
                    p.passwordHash
               FROM qa_users u
               JOIN qa_password_users p ON p.userId = u.id
              WHERE u.name = ?
              LIMIT 1`,
          ).bind(input.username).first()) as (DbUser & { passwordHash: string }) | null;

          if (!row || !(await bcrypt.compare(input.password, row.passwordHash))) {
            throw new TRPCError({ code: "UNAUTHORIZED", message: "使用者名稱或密碼錯誤" });
          }
          const token = await createToken(ctx.env, row);
          setSessionCookie(ctx.resHeaders, ctx.req, token);
          return { id: row.id, username: row.name, name: row.name, role: row.role, token };
        }),
      register: protectedProcedure
        .input(z.object({
          username: z.string().min(3),
          password: z.string().min(6),
          name: z.string().min(1),
          role: z.enum(["admin", "user"]).default("user"),
        }))
        .mutation(async ({ input, ctx }) => {
          if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Only admins can register users" });
          const exists = await ctx.env.DB.prepare("SELECT id FROM qa_users WHERE name = ? LIMIT 1").bind(input.username).first();
          if (exists) throw new TRPCError({ code: "CONFLICT", message: "使用者名稱已被使用" });

          const now = new Date().toISOString();
          const openId = `password_${input.username}_${Date.now()}`;
          const result = await ctx.env.DB.prepare(
            `INSERT INTO qa_users (openId, name, email, loginMethod, role, isActive, createdAt, updatedAt, lastSignedIn)
             VALUES (?, ?, ?, 'password', ?, 1, ?, ?, ?)`,
          ).bind(openId, input.username, `${input.username}@example.com`, input.role, now, now, now).run();
          const userId = Number(result.meta?.last_row_id);
          const passwordHash = await bcrypt.hash(input.password, 10);
          await ctx.env.DB.prepare(
            `INSERT INTO qa_password_users (userId, passwordHash, createdAt, updatedAt) VALUES (?, ?, ?, ?)`,
          ).bind(userId, passwordHash, now, now).run();
          return { id: userId, username: input.username, name: input.name, role: input.role };
        }),
      initDemo: publicProcedure.mutation(() => ({ success: true })),
    }),
  }),
  faq: router({
    list: publicProcedure.query(async ({ ctx }) => {
      const result = await ctx.env.DB.prepare(`${faqSelect} ORDER BY id ASC`).all();
      return result.results ?? [];
    }),
    create: protectedProcedure
      .input(z.object({
        question: z.string().min(1),
        answer: z.string().min(1),
        category: z.string().min(1),
        imageUrls: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const result = await ctx.env.DB.prepare(
          `INSERT INTO qa_faqs (question, answer, category, imageUrls) VALUES (?, ?, ?, ?)`,
        ).bind(input.question, input.answer, input.category, input.imageUrls ?? null).run();
        return await ctx.env.DB.prepare(`${faqSelect} WHERE id = ?`).bind(Number(result.meta?.last_row_id)).first();
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        question: z.string().min(1).optional(),
        answer: z.string().min(1).optional(),
        category: z.string().min(1).optional(),
        imageUrls: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const old = (await ctx.env.DB.prepare(`${faqSelect} WHERE id = ? LIMIT 1`).bind(input.id).first()) as any;
        if (!old) throw new TRPCError({ code: "NOT_FOUND" });
        await ctx.env.DB.prepare(
          `UPDATE qa_faqs SET question = ?, answer = ?, category = ?, imageUrls = ? WHERE id = ?`,
        ).bind(
          input.question ?? old.question,
          input.answer ?? old.answer,
          input.category ?? old.category,
          input.imageUrls ?? old.imageUrls,
          input.id,
        ).run();
        return await ctx.env.DB.prepare(`${faqSelect} WHERE id = ?`).bind(input.id).first();
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const old = await ctx.env.DB.prepare(`${faqSelect} WHERE id = ? LIMIT 1`).bind(input.id).first();
        if (!old) return null;
        await ctx.env.DB.prepare("DELETE FROM qa_faqs WHERE id = ?").bind(input.id).run();
        return old;
      }),
  }),
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!env.DB) {
      if (url.pathname.startsWith("/api/")) {
        return Response.json({ error: "D1 database binding DB is not configured" }, { status: 503 });
      }
      return env.ASSETS.fetch(request);
    }

    if (url.pathname === "/api/upload") {
      return Response.json({ fallback: "inline" }, { status: 503 });
    }

    if (url.pathname.startsWith("/api/trpc")) {
      return fetchRequestHandler({
        endpoint: "/api/trpc",
        req: request,
        router: appRouter,
        createContext: async ({ req, resHeaders }) => ({
          req,
          resHeaders,
          env,
          user: await authenticateRequest(req, env),
        }),
      });
    }

    return env.ASSETS.fetch(request);
  },
};
