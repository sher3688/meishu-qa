/**
 * tRPC 帳密驗證路由
 * 使用 JWT token 進行身份驗證
 */
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import { sdk } from "./_core/sdk";
import {
  authenticatePasswordUser,
  registerPasswordUser,
  initializeDemoUsers,
} from "./password-auth";

export const passwordAuthRouter = router({
  /**
   * 帳密登入
   * 返回使用者資訊和 session token（同時設定 cookie）
   */
  login: publicProcedure
    .input(
      z.object({
        username: z.string().min(3, "使用者名稱至少 3 個字符"),
        password: z.string().min(1, "密碼不能為空"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const user = await authenticatePasswordUser(input.username, input.password);
      if (!user) {
        throw new Error("使用者名稱或密碼錯誤");
      }
      // Create JWT token
      const token = await sdk.createSessionToken(user.id, {
        openId: user.openId,
        name: user.name,
        expiresInMs: ONE_YEAR_MS,
      });
      // Set cookie for browser-based auth
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      return {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        token: token,
      };
    }),
  /**
   * 帳密註冊（僅管理者可用）
   */
  register: publicProcedure
    .input(
      z.object({
        username: z.string().min(3, "使用者名稱至少 3 個字符"),
        password: z.string().min(6, "密碼至少 6 個字符"),
        name: z.string().min(1, "名稱不能為空"),
        role: z.enum(["admin", "user"]).optional().default("user"),
      })
    )
    .mutation(async ({ input }) => {
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
          role: user.role,
        };
      } catch (error: any) {
        throw new Error(error.message || "註冊失敗");
      }
    }),
  /**
   * 初始化示例使用者（開發用）
   */
  initDemo: publicProcedure.mutation(async () => {
    try {
      await initializeDemoUsers();
      return { success: true };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }),
});
