// Vercel serverless entry point.
//
// server.ts is bundled into server.bundled.js via esbuild so all TypeScript
// module imports (src/types, auth, etc.) resolve cleanly in Node serverless.
// @ts-ignore
import app from './server.bundled.js';

export default app;

