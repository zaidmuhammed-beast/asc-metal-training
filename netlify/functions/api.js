// Runs the Express API as a Netlify Function (modern format), storing data in
// Netlify Blobs with strong consistency. Express listens on a private local
// port inside the function instance; each request is forwarded to it.
// (server.js only picks its storage backend on first use, so setting this
// after the import below is hoisted is fine.)
process.env.STORAGE = 'blobs';

import app from '../../server.js';

let origin;
const start = () => new Promise((resolve, reject) => {
  const server = app.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  server.on('error', reject);
});

export default async req => {
  origin ||= await start();
  const url = new URL(req.url);
  const headers = new Headers(req.headers);
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
  headers.delete('host');
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer();
  const res = await fetch(origin + url.pathname + url.search, { method: req.method, headers, body, redirect: 'manual' });
  return new Response(res.body, { status: res.status, headers: res.headers });
};

export const config = { path: '/api/*' };
