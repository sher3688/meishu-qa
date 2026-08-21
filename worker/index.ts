import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { initTRPC, TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
import { SignJWT, jwtVerify } from "jose";
import { Pool } from "pg";
import superjson from "superjson";
import { z } from "zod";
import { COOKIE_NAME, ONE_YEAR_MS } from "../shared/const";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DATABASE_URL: string;
  JWT_SECRET: string;
}

type DbUser = {
  id: number;
  openId: string;
  name: string;
  email: string | null;
  loginMethod: string | null;
  role: string;
  isActive: number;
  createdAt: Date | string;
  updatedAt: Date | string;
  lastSignedIn: Date | string;
};

type Context = {
  req: Request;
  resHeaders: Headers;
  env: Env;
  user: DbUser | null;
};

const pools = new Map<string, Pool>();
function getPool(databaseUrl: string) {
  let pool = pools.get(databaseUrl);
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false },
      max: 2,
      idleTimeoutMillis: 20_000,
    });
    pools.set(databaseUrl, pool);
  }
  return pool;
}

function secretKey(secret: string) {
  return new TextEncoder().encode(secret || "change-me");
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
  const { rows } = await getPool(env.DATABASE_URL).query(
    'SELECT id, "openId", name, email, "loginMethod", role, "isActive", "createdAt", "updatedAt", "lastSignedIn" FROM qa_users WHERE id = $1 LIMIT 1',
    [id],
  );
  return rows[0] ?? null;
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

const appRouter = router({
  system: router({
    health: publicProcedure
      .input(z.object({ timestamp: z.number().min(0) }))
      .query(() => ({ ok: true })),
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
          const { rows } = await getPool(ctx.env.DATABASE_URL).query(
            `SELECT u.id, u."openId", u.name, u.email, u."loginMethod", u.role,
                    u."isActive", u."createdAt", u."updatedAt", u."lastSignedIn",
                    p."passwordHash"
               FROM qa_users u
               JOIN qa_password_users p ON p."userId" = u.id
              WHERE u.name = $1
              LIMIT 1`,
            [input.username],
          );
          const row = rows[0];
          if (!row || !(await bcrypt.compare(input.password, row.passwordHash))) {
            throw new TRPCError({ code: "UNAUTHORIZED", message: "使用者名稱或密碼錯誤" });
          }
          const user: DbUser = row;
          const token = await createToken(ctx.env, user);
          setSessionCookie(ctx.resHeaders, ctx.req, token);
          return {
            id: user.id,
            username: user.name,
            name: user.name,
            role: user.role,
            token,
          };
        }),
      register: protectedProcedure
        .input(
          z.object({
            username: z.string().min(3),
            password: z.string().min(6),
            name: z.string().min(1),
            role: z.enum(["admin", "user"]).default("user"),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          if (ctx.user.role !== "admin") {
            throw new TRPCError({ code: "FORBIDDEN", message: "Only admins can register users" });
          }
          const pool = getPool(ctx.env.DATABASE_URL);
          const exists = await pool.query("SELECT id FROM qa_users WHERE name = $1 LIMIT 1", [input.username]);
          if (exists.rowCount) throw new TRPCError({ code: "CONFLICT", message: "使用者名稱已被使用" });
          const openId = `password_${input.username}_${Date.now()}`;
          const inserted = await pool.query(
            `INSERT INTO qa_users ("openId", name, email, "loginMethod", role, "isActive", "createdAt", "updatedAt", "lastSignedIn")
             VALUES ($1,$2,$3,'password',$4,1,NOW(),NOW(),NOW()) RETURNING id, "openId", name, email, "loginMethod", role, "isActive", "createdAt", "updatedAt", "lastSignedIn"`,
            [openId, input.username, `${input.username}@example.com`, input.role],
          );
          const user: DbUser = inserted.rows[0];
          const passwordHash = await bcrypt.hash(input.password, 10);
          await pool.query(
            `INSERT INTO qa_password_users ("userId", "passwordHash", "createdAt", "updatedAt") VALUES ($1,$2,NOW(),NOW())`,
            [user.id, passwordHash],
          );
          return { id: user.id, username: user.name, name: user.name, role: user.role };
        }),
      initDemo: publicProcedure.mutation(() => ({ success: true })),
    }),
  }),
  faq: router({
    list: publicProcedure.query(async ({ ctx }) => {
      const { rows } = await getPool(ctx.env.DATABASE_URL).query(
        `SELECT id, question, answer, category, "imageUrls", "createdBy", "createdAt", "updatedAt" FROM qa_faqs ORDER BY id ASC`,
      );
      return rows;
    }),
    create: protectedProcedure
      .input(
        z.object({
          question: z.string().min(1),
          answer: z.string().min(1),
          category: z.string().min(1),
          imageUrls: z.string().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { rows } = await getPool(ctx.env.DATABASE_URL).query(
          `INSERT INTO qa_faqs (question, answer, category, "imageUrls", "createdBy", "createdAt", "updatedAt")
           VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
           RETURNING id, question, answer, category, "imageUrls", "createdBy", "createdAt", "updatedAt"`,
          [input.question, input.answer, input.category, input.imageUrls ?? null, ctx.user.id],
        );
        return rows[0];
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          question: z.string().min(1).optional(),
          answer: z.string().min(1).optional(),
          category: z.string().min(1).optional(),
          imageUrls: z.string().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const current = await getPool(ctx.env.DATABASE_URL).query(
          `SELECT question, answer, category, "imageUrls" FROM qa_faqs WHERE id = $1 LIMIT 1`,
          [input.id],
        );
        if (!current.rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
        const old = current.rows[0];
        const { rows } = await getPool(ctx.env.DATABASE_URL).query(
          `UPDATE qa_faqs SET question=$1, answer=$2, category=$3, "imageUrls"=$4, "updatedAt"=NOW()
           WHERE id=$5 RETURNING id, question, answer, category, "imageUrls", "createdBy", "createdAt", "updatedAt"`,
          [
            input.question ?? old.question,
            input.answer ?? old.answer,
            input.category ?? old.category,
            input.imageUrls ?? old.imageUrls,
            input.id,
          ],
        );
        return rows[0];
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { rows } = await getPool(ctx.env.DATABASE_URL).query(
          `DELETE FROM qa_faqs WHERE id=$1 RETURNING id, question, answer, category, "imageUrls", "createdBy", "createdAt", "updatedAt"`,
          [input.id],
        );
        return rows[0] ?? null;
      }),
  }),
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!env.DATABASE_URL || !env.JWT_SECRET) {
      if (url.pathname.startsWith("/api/")) {
        return Response.json({ error: "Cloudflare secrets are not configured" }, { status: 503 });
      }
      return env.ASSETS.fetch(request);
    }

    if (url.pathname === "/api/upload") {
      // The client compresses the selected image and stores it with the FAQ record
      // when this endpoint is unavailable, so no retired Manus storage is required.
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
