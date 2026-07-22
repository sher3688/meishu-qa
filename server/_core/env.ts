export const ENV = {
  appId: process.env.VITE_APP_ID ?? "meishu-qa",
  cookieSecret: process.env.JWT_SECRET ?? "meishu-qa-jwt-secret-2026",
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://neondb_owner:npg_knpNu8lB2FWR@ep-dry-glade-azg6pbwu.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};
