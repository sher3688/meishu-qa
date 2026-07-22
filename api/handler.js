export default async function handler(req, res) {
  try {
    const { createApp } = await import("./server.mjs");
    const app = createApp();
    return app(req, res);
  } catch (err) {
    console.error("FULL ERROR STACK:", err.stack);
    res.status(500).json({ error: err.message });
  }
}
