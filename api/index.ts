// Vercel serverless entry point.
//
// This previously imported '../server.js', a file that does not exist in the
// repo — `vercel-build` only ran `vite build` and never produced it, so every
// /api/* request depended on a module resolution that was never verified.
// Importing the TypeScript source directly lets Vercel's own build compile it.
//
// server.ts only calls app.listen() when process.env.VERCEL is unset, so
// importing it here starts no listener — it just exports the Express app.
import app from '../server';

export default app;
