import { Hono } from 'hono';
import { serveStatic } from 'hono/cloudflare-workers';
// @ts-expect-error
import manifest from '__STATIC_CONTENT_MANIFEST';

const app = new Hono();

app.get(
  '/*',
  serveStatic({
    root: '.',
    manifest,
  }),
);

// URL rewrite for SPA, as the last route
app.get(
  '/*',
  serveStatic({
    root: '.',
    manifest,
    rewriteRequestPath(reqPath) {
      return '/index.html';
    },
  }),
);

export default app;
