import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import { getAllFAQs, createFAQ, updateFAQ, deleteFAQ } from "./db";
import { TRPCError } from "@trpc/server";
import { passwordAuthRouter } from "./auth-routes";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
    passwordAuth: passwordAuthRouter,
  }),

  faq: router({
    list: publicProcedure.query(async () => {
      return await getAllFAQs();
    }),
    create: protectedProcedure
      .input(
        z.object({
          question: z.string().min(1),
          answer: z.string().min(1),
          category: z.string().min(1),
          imageUrls: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user?.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only admins can create FAQs",
          });
        }
        return await createFAQ({
          question: input.question,
          answer: input.answer,
          category: input.category,
          imageUrls: input.imageUrls,
          createdBy: ctx.user.id,
        });
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          question: z.string().min(1).optional(),
          answer: z.string().min(1).optional(),
          category: z.string().min(1).optional(),
          imageUrls: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user?.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only admins can update FAQs",
          });
        }
        const { id, ...updateData } = input;
        return await updateFAQ(id, updateData);
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user?.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only admins can delete FAQs",
          });
        }
        return await deleteFAQ(input.id);
      }),
  }),
});

export type AppRouter = typeof appRouter;
