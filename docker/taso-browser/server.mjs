import http from 'node:http';
import { chromium } from 'playwright';
import { createHostResolverRules, validateTarget } from './security.mjs';

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

async function runOne(browser, target, viewportName, theme, actions = []) {
  const viewport = viewports[viewportName] || viewports.desktop;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    deviceScaleFactor: viewport.deviceScaleFactor,
    colorScheme: theme === 'light' ? 'light' : 'dark',
    ignoreHTTPSErrors: false,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await page.route('**/*', async (route) => {
    try {
      await validateTarget(route.request().url(), allowHosts);
      await route.continue();
    } catch {
      await route.abort('blockedbyclient');
    }
  });
  const consoleEntries = [];
  const requestFailures = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type())) consoleEntries.push({ type: msg.type(), text: msg.text().slice(0, 1000) });
  });
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error).slice(0, 1000)));
  page.on('requestfailed', (request) => requestFailures.push({ url: request.url(), error: request.failure()?.errorText || 'failed' }));

  await page.addInitScript((requestedTheme) => {
    try { localStorage.setItem('taso-theme', requestedTheme); } catch {}
  }, theme);

  const response = await page.goto(target.toString(), { waitUntil: 'networkidle', timeout: 30_000 });
  await page.evaluate((requestedTheme) => {
    document.documentElement.dataset.theme = requestedTheme;
    document.documentElement.style.colorScheme = requestedTheme;
  }, theme).catch(() => {});

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
    const describe = (el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      className: typeof el.className === 'string' ? el.className.slice(0, 160) : undefined,
    });
    const overflowers = all.filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && (rect.right > window.innerWidth + 1 || rect.left < -1);
    }).slice(0, 30).map(describe);
    const clippedFixed = all.filter((el) => {
      const style = getComputedStyle(el);
      if (!['fixed', 'sticky'].includes(style.position)) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (rect.right > window.innerWidth + 1 || rect.left < -1 || rect.bottom > window.innerHeight + 1 || rect.top < -1);
    }).slice(0, 30).map(describe);
    const smallTapTargets = all.filter((el) => {
      if (!(el.matches('button,a[href],input,select,textarea,[role="button"]'))) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      return rect.width > 0 && rect.height > 0 && (rect.width < 40 || rect.height < 40);
    }).slice(0, 40).map((el) => ({ ...describe(el), width: Math.round(el.getBoundingClientRect().width), height: Math.round(el.getBoundingClientRect().height) }));
    const fixedElements = all.filter((el) => ['fixed', 'sticky'].includes(getComputedStyle(el).position)).slice(0, 40).map((el) => {
      const rect = el.getBoundingClientRect();
      return { ...describe(el), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom), left: Math.round(rect.left), zIndex: getComputedStyle(el).zIndex };
    });
    return {
      title: document.title,
      url: location.href,
      theme: document.documentElement.dataset.theme || null,
      links: document.querySelectorAll('a[href]').length,
      forms: document.forms.length,
      buttons: document.querySelectorAll('button,[role="button"]').length,
      horizontalOverflow: Math.max(doc.scrollWidth, body?.scrollWidth || 0) > window.innerWidth + 1,
      documentWidth: Math.max(doc.scrollWidth, body?.scrollWidth || 0),
      viewportWidth: window.innerWidth,
      overflowers,
      clippedFixed,
      smallTapTargets,
      fixedElements,
    };
  });

  const screenshot = await page.screenshot({ fullPage: true, type: 'png' });
  const screenshotBase64 = screenshot.length <= maxScreenshotBytes ? screenshot.toString('base64') : undefined;
  const result = {
    viewport: viewportName,
    theme,
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
  const target = await validateTarget(String(body?.url || ''), allowHosts);
  const requestedViewports = Array.isArray(body?.viewports) ? body.viewports.filter((v) => ['desktop', 'mobile'].includes(v)) : ['desktop', 'mobile'];
  const requestedThemes = Array.isArray(body?.themes) ? body.themes.filter((v) => ['dark', 'light'].includes(v)) : ['dark', 'light'];
  const actions = Array.isArray(body?.actions) ? body.actions : [];
  const hostResolverRules = await createHostResolverRules(allowHosts);
  const browser = await chromium.launch({ headless: true, args: [`--host-resolver-rules=${hostResolverRules}`] });
  try {
    const evidence = [];
    const viewportNames = [...new Set(requestedViewports.length ? requestedViewports : ['desktop'])];
    const themeNames = [...new Set(requestedThemes.length ? requestedThemes : ['dark'])];
    for (const viewportName of viewportNames) {
      for (const theme of themeNames) evidence.push(await runOne(browser, target, viewportName, theme, actions));
    }
    return {
      ok: true,
      target: target.toString(),
      generatedAt: new Date().toISOString(),
      evidence,
      summary: {
        viewports: viewportNames.length,
        themes: themeNames.length,
        evidenceCount: evidence.length,
        consoleErrors: evidence.reduce((n, item) => n + item.console.filter((x) => x.type === 'error').length, 0),
        pageErrors: evidence.reduce((n, item) => n + item.pageErrors.length, 0),
        requestFailures: evidence.reduce((n, item) => n + item.requestFailures.length, 0),
        overflowFailures: evidence.filter((item) => item.horizontalOverflow).length,
        clippedFixedFailures: evidence.filter((item) => item.clippedFixed.length > 0).length,
        smallTapTargetEvidence: evidence.reduce((n, item) => n + item.smallTapTargets.length, 0),
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
