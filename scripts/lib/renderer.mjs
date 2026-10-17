// Static file server + Playwright screenshot helper (approach from Baskerville42/outage-data-ua).

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

export async function startStaticServer(rootDir) {
  const root = path.resolve(rootDir);
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const abs = path.resolve(root, '.' + pathname);
      if (!abs.startsWith(root + path.sep)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const body = await readFile(abs);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { address, port } = server.address();
  return { server, baseURL: `http://${address}:${port}` };
}

export async function createBrowser() {
  const { chromium } = await import('playwright');
  return chromium.launch({ headless: true });
}

/** Renders `view` with the template and saves a screenshot of `.container` to outPath. */
export async function renderView({ context, baseURL, templatePath, view, outPath, timeoutMs = 30000 }) {
  const page = await context.newPage();
  try {
    // Block every request that does not go to the local server: no network fonts or assets.
    await page.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith(baseURL + '/') || u.startsWith('data:')) return route.continue();
      return route.abort();
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript((v) => { window.__VIEW__ = v; }, view);
    await page.goto(`${baseURL}/${templatePath}`, { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForSelector('body[data-ready="1"]', { timeout: timeoutMs }).catch((e) => {
      throw new Error(`Template did not finish rendering: ${errors.join('; ') || e.message}`);
    });
    if (errors.length) throw new Error(`Template script error: ${errors.join('; ')}`);
    await page.locator('.container').screenshot({ path: outPath, type: 'png', animations: 'disabled' });
  } finally {
    await page.close();
  }
}
