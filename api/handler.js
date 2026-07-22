// Handler for Vercel serverless - uses dynamic import for ESM server
let app = null;

async function getHandler() {
  if (!app) {
    const { createApp } = await import("./server.mjs");
    app = createApp();
  }
  return app;
}

module.exports = async (req, res) => {
  const handler = await getHandler();
  handler(req, res);
};
