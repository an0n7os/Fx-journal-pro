// Netlify Functions entry point for the Express API.
//
// Netlify has no long-running process, so the server cannot listen on a port
// here. server.ts checks IS_SERVERLESS (NETLIFY is set during the build and at
// runtime) and skips app.listen(), the static-file middleware and the MT5
// background interval, exporting the bare Express app instead. serverless-http
// adapts that app to the Lambda handler signature Netlify invokes.
//
// netlify.toml rewrites /api/* to this function WITHOUT stripping the prefix,
// so req.path still reads /api/... and every route in server.ts matches the
// path it was written with.
import serverless from 'serverless-http';
import app from '../../server';

export const handler = serverless(app, {
  // Netlify invokes the function at its own path, so the request arrives as
  // /.netlify/functions/api/api/<route>. Stripping the function's own prefix
  // leaves /api/<route>, which is what the routes are registered under.
  basePath: '/.netlify/functions/api',
  // Anything that is not obviously text has to survive as base64 or the body
  // arrives corrupted. The Excel and PDF exports are the cases that matter.
  binary: [
    'application/octet-stream',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'image/*',
    'font/*',
  ],
});
