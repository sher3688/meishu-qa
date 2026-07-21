// Handler for Vercel serverless - imports the server bundle and creates the app
import { createApp } from "./server.mjs";

// Create the Express app (server.mjs's createApp handles all routes)
const app = createApp();

export default app;
