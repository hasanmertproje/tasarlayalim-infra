import http from 'node:http';
import { chromium } from 'playwright';

const port = Number(process.env.PORT || 3100);
const secret = process.env.TASO_BROWSER_WORKER_SECRET || '';
const allowHosts = new Set((process.env.TASO_BROWSER_ALLOWED_HOSTS || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean));
const maxBody = 256 * 1024;
const maxScreenshotBytes = 1_500_000;

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function authorized(req) {
  if (!secret) return false;
  return req.headers.authorization === `Bearer ${secret}`;
}

function parseTarget(raw) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http/https targets are allowed.');
  if (url.username || url.password) throw new Error('URL credentials are not allowed.');
  const host = url.hostname.toLowerCase();
  if (!allowHosts.has(host)) throw new Error(`Host is not allowlisted: ${host}`);
  return url;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBody) throw new Error('Request body too large.');
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

const viewports = {
  desktop: { width: 1440, height: 1000, isMobile: false, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, isMobile: true, deviceScaleFactor: 1 },
};

async function runOne(browser, target, viewportName, actions = []) {
  const viewport = viewports[viewportName] || viewports.desktop;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    deviceScaleFactor: viewport.deviceScaleFactor,
    ignoreHTTPSErrors: false,
  });
  const page = await context.newPage();
  const consoleEntries = [];
  const requestFailures = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type())) consoleEntries.push({ type: msg.type(), text: msg.text().slice(0, 1000) });
  });
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error).slice(0, 1000)));
  page.on('requestfailed', (request) => requestFailures.push({ url: request.url(), error: request.failure()?.errorText || 'failed' }));

  const response = await page.goto(target.toString(), { waitUntil: 'networkidle', timeout: 30_000 });
  for (const action of actions.slice(0, 20)) {
    const selector = String(action?.selector || '').slice(0, 500);
    const kind = String(action?.type || '');
    if (!selector && !['wait'].includes(kind)) throw new Error(`Selector is required for ${kind}.`);
    if (kind === 'click') await page.locator(selector).first().click({ timeout: 8_000 });
    else if (kind === 'fill') await page.locator(selector).first().fill(String(action.value ?? '').slice(0, 5000));
    else if (kind === 'select') await page.locator(selector).first().selectOption(String(action.value ?? '').slice(0, 500));
    else if (kind === 'check') await page.locator(selector).first().check();
    else if (kind === 'press') await page.locator(selector).first().press(String(action.value || 'Enter').slice(0, 40));
    else if (kind === 'wait') await page.waitForTimeout(Math.min(5000, Math.max(0, Number(action.ms) || 250)));
    else throw new Error(`Unsupported browser action: ${kind}`);
  }

  await page.waitForLoadState('domcontentloaded').catch(() => {});
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const all = [...document.querySelectorAll('*')];
    const overflowers = all.filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && (rect.right > window.innerWidth + 1 || rect.left < -1);
    }).slice(0, 30).map((el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      className: typeof el.className === 'string' ? el.className.slice(0, 160) : undefined,
    }));
    return {
      title: document.title,
      url: location.href,
      links: document.querySelectorAll('a[href]').length,
      forms: document.forms.length,
      buttons: document.querySelectorAll('button,[role="button"]').length,
      horizontalOverflow: Math.max(doc.scrollWidth, body?.scrollWidth || 0) > window.innerWidth + 1,
      documentWidth: Math.max(doc.scrollWidth, body?.scrollWidth || 0),
      viewportWidth: window.innerWidth,
      overflowers,
    };
  });

  const screenshot = await page.screenshot({ fullPage: true, type: 'png' });
  const screenshotBase64 = screenshot.length <= maxScreenshotBytes ? screenshot.toString('base64') : undefined;
  const result = {
    viewport: viewportName,
    dimensions: { width: viewport.width, height: viewport.height },
    httpStatus: response?.status() ?? null,
    ...metrics,
    console: consoleEntries.slice(0, 100),
    pageErrors: pageErrors.slice(0, 50),
    requestFailures: requestFailures.slice(0, 100),
    screenshot: screenshotBase64 ? { mime: 'image/png', base64: screenshotBase64, bytes: screenshot.length } : { omitted: true, bytes: screenshot.length },
  };
  await context.close();
  return result;
}

async function execute(body) {
  const target = parseTarget(String(body?.url || ''));
  const requested = Array.isArray(body?.viewports) ? body.viewports.filter((v) => ['desktop', 'mobile'].includes(v)) : ['desktop', 'mobile'];
  const actions = Array.isArray(body?.actions) ? body.actions : [];
  const browser = await chromium.launch({ headless: true });
  try {
    const evidence = [];
    for (const name of [...new Set(requested.length ? requested : ['desktop'])]) evidence.push(await runOne(browser, target, name, actions));
    return {
      ok: true,
      target: target.toString(),
      generatedAt: new Date().toISOString(),
      evidence,
      summary: {
        viewports: evidence.length,
        consoleErrors: evidence.reduce((n, item) => n + item.console.filter((x) => x.type === 'error').length, 0),
        pageErrors: evidence.reduce((n, item) => n + item.pageErrors.length, 0),
        requestFailures: evidence.reduce((n, item) => n + item.requestFailures.length, 0),
        overflowFailures: evidence.filter((item) => item.horizontalOverflow).length,
      },
    };
  } finally {
    await browser.close();
  }
}

http.createServer(async (req, res) => {
  try {
    if (req.url === '/health' && req.method === 'GET') return json(res, 200, { ok: true, service: 'taso-browser-worker', browser: 'chromium' });
    if (!authorized(req)) return json(res, 401, { error: 'Browser worker authorization required.' });
    if (req.url === '/run' && req.method === 'POST') {
      const body = await readBody(req);
      return json(res, 200, await execute(body));
    }
    return json(res, 404, { error: 'Not found.' });
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : 'Browser run failed.' });
  }
}).listen(port, '0.0.0.0', () => console.log(`Taso browser worker listening on ${port}`));
