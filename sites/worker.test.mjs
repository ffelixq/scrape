import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import test from 'node:test';

import worker from './worker.js';

const contentTypes = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.png': 'image/png',
};

const env = {
  ASSETS: {
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
      try {
        const body = await readFile(resolve('dist/client', relativePath));
        return new Response(body, {
          headers: {
            'content-type': contentTypes[extname(relativePath)] ?? 'application/octet-stream',
          },
        });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    },
  },
};

test('serves the built Proofline shell with security headers', async () => {
  const response = await worker.fetch(
    new Request('https://proofline.example/', { headers: { accept: 'text/html' } }),
    env,
  );

  assert.equal(response.status, 200);
  assert.match(await response.text(), /<title>Proofline — Evidence before answers<\/title>/);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.match(response.headers.get('content-security-policy') ?? '', /object-src 'none'/);
});

test('uses the application shell for client-side routes', async () => {
  const response = await worker.fetch(
    new Request('https://proofline.example/investigations/demo', {
      headers: { accept: 'text/html' },
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.match(await response.text(), /<div id="root"><\/div>/);
});

test('rejects state-changing methods at the static preview edge', async () => {
  const response = await worker.fetch(
    new Request('https://proofline.example/', { method: 'POST' }),
    env,
  );
  assert.equal(response.status, 405);
});
