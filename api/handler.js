// Test: just return a simple response without importing server.mjs
export default async function handler(req, res) {
  try {
    // Try to import server.mjs
    const { createApp } = await import("./server.mjs");
    const app = createApp();
    return app(req, res);
  } catch (err) {
    console.error("Handler error:", err.message);
    res.status(500).json({ error: err.message });
  }
}
