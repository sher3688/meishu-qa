import express from "express";
const app = express();
app.get("/health", (req, res) => res.json({ status: "ok" }));
app.get("/api/test", (req, res) => res.json({ status: "ok", env: typeof process.env.DATABASE_URL }));
export default app;
