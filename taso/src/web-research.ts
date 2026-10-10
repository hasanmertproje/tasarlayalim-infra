import { lookup } from 'node:dns/promises';
import net from 'node:net';
import type { FastifyInstance } from 'fastify';

export type ResearchSearchResult = {
  title: string;
  url: string;
  snippet?: string;
  engine?: string;
};

export type ResearchDocument = {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title?: string;
  text: string;
  fetchedAt: string;
  cached: boolean;
};

type CacheEntry<T> = { expiresAt: number; value: T };
const cache = new Map<string, CacheEntry<unknown>>();
const DEFAULT_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 100;
const MAX_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;

function cacheGet<T>(key: string): T | undefined {
  const item = cache.get(key);
  if (!item) return undefined;
  if (item.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return item.value as T;
}

function cacheSet<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const first = cache.keys().next().value as string | undefined;
    if (first) cache.delete(first);
  }
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)));
}

export function htmlToText(html: string) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()) : undefined;
  const text = decodeEntities(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim());
  return { title, text };
}

export function isPrivateAddress(address: string) {
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number);
    return parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || address === '0.0.0.0';
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }
  return true;
}

async function assertPublicUrl(input: string) {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('Geçerli bir URL gerekli.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Yalnızca HTTP/HTTPS URL desteklenir.');
  if (url.username || url.password) throw new Error('URL içinde kimlik bilgisi kullanılamaz.');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('Yerel ağ hedefleri engellendi.');
  const records = await lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) throw new Error('Özel/yerel ağ hedefleri engellendi.');
  return url;
}

async function fetchPublic(urlInput: string): Promise<ResearchDocument> {
  const key = `fetch:${urlInput}`;
  const cached = cacheGet<ResearchDocument>(key);
  if (cached) return { ...cached, cached: true };

  let current = await assertPublicUrl(urlInput);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'TasoResearch/1.0 (+public-web-read)', accept: 'text/html,text/plain,application/json;q=0.8,*/*;q=0.2' },
      });
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Yönlendirme hedefi bulunamadı.');
      current = await assertPublicUrl(new URL(location, current).toString());
      continue;
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_BYTES) throw new Error('Kaynak boyutu güvenlik sınırını aşıyor.');
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    if (!/(text\/|application\/json|application\/xml|application\/xhtml\+xml)/i.test(contentType)) {
      throw new Error(`Desteklenmeyen içerik türü: ${contentType}`);
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) throw new Error('Kaynak boyutu güvenlik sınırını aşıyor.');
    const parsed = /html|xhtml/i.test(contentType) ? htmlToText(raw) : { title: undefined, text: raw.trim() };
    const result: ResearchDocument = {
      url: urlInput,
      finalUrl: current.toString(),
      status: response.status,
      contentType,
      title: parsed.title,
      text: parsed.text.slice(0, 120_000),
      fetchedAt: new Date().toISOString(),
      cached: false,
    };
    if (response.ok) cacheSet(key, result);
    return result;
  }
  throw new Error('Çok fazla yönlendirme.');
}

async function searchWeb(query: string, limit: number): Promise<ResearchSearchResult[]> {
  const endpoint = process.env.TASO_SEARCH_ENDPOINT?.trim();
  if (!endpoint) throw new Error('Web search provider yapılandırılmadı. TASO_SEARCH_ENDPOINT gerekli.');
  const base = await assertPublicUrl(endpoint);
  base.searchParams.set('q', query);
  base.searchParams.set('format', 'json');
  const key = `search:${base.toString()}:${limit}`;
  const cached = cacheGet<ResearchSearchResult[]>(key);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(base, { signal: controller.signal, headers: { accept: 'application/json', 'user-agent': 'TasoResearch/1.0' } });
    if (!response.ok) throw new Error(`Search provider HTTP ${response.status}.`);
    const payload = await response.json() as { results?: Array<{ title?: string; url?: string; content?: string; engine?: string }> };
    const results = (payload.results ?? [])
      .filter((item) => item.url && item.title)
      .slice(0, limit)
      .map((item) => ({ title: item.title!, url: item.url!, snippet: item.content?.slice(0, 1000), engine: item.engine }));
    cacheSet(key, results, 2 * 60_000);
    return results;
  } finally {
    clearTimeout(timer);
  }
}

export function registerWebResearchRoutes(app: FastifyInstance) {
  app.get('/v1/research/status', async () => ({
    research: {
      fetchReady: true,
      searchReady: Boolean(process.env.TASO_SEARCH_ENDPOINT?.trim()),
      searchProvider: process.env.TASO_SEARCH_ENDPOINT?.trim() ? 'configured-endpoint' : 'not-configured',
      deterministic: true,
      providerBrain: false,
    },
  }));

  app.post<{ Body: { url?: string } }>('/v1/research/fetch', async (request, reply) => {
    const url = request.body?.url?.trim();
    if (!url) return reply.code(400).send({ error: 'url gerekli.' });
    try { return { document: await fetchPublic(url) }; }
    catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
  });

  app.post<{ Body: { query?: string; limit?: number } }>('/v1/research/search', async (request, reply) => {
    const query = request.body?.query?.trim();
    if (!query) return reply.code(400).send({ error: 'query gerekli.' });
    const limit = Math.max(1, Math.min(20, Math.floor(Number(request.body?.limit) || 8)));
    try { return { query, results: await searchWeb(query, limit) }; }
    catch (error) {
      const message = (error as Error).message;
      return reply.code(message.includes('yapılandırılmadı') ? 503 : 400).send({ error: message });
    }
  });
}
