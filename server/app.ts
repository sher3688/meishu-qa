import "dotenv/config";
import express from "express";
import multer from "multer";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerStorageProxy } from "./_core/storageProxy";
import { appRouter } from "./routers";
import { createContext } from "./_core/context";
import { storagePut } from "./storage";
import { initializeDemoUsers } from "./password-auth";
import { initializeSchema } from "./db";

let schemaInitialized = false;
let demoUsersInitialized = false;

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

export async function initializeApplicationData() {
  await ensureSchema();
  await ensureDemoUsers();
}

export function createApp(): express.Express {
  const app = express();

  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    app.use(async (_req, _res, next) => {
      await initializeApplicationData();
      next();
    });
  }

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
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
      createContext,
    })
  );

  return app;
}
