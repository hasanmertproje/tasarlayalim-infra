import { chromium } from 'playwright';
import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.env.TASO_VISUAL_BASE_URL || 'http://127.0.0.1:4173';
const out = process.env.TASO_VISUAL_OUTPUT || 'visual-evidence';
mkdirSync(out, { recursive: true });

function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const c of clean) {
    const index = alphabet.indexOf(c);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function totp(secret) {
  const counter = BigInt(Math.floor(Date.now() / 30000));
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24)
    | ((digest[offset + 1] & 255) << 16)
    | ((digest[offset + 2] & 255) << 8)
    | (digest[offset + 3] & 255);
  return String(binary % 1_000_000).padStart(6, '0');
}

let totpSecret = '';

async function authenticate(page) {
  await page.goto(base, { waitUntil: 'networkidle' });
  const login = await page.evaluate(async () => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@ci.local', password: 'ci-password' }),
    });
    return response.json();
  });

  if (login.authenticated) return;
  if (login.requiresTwoFactorSetup && login.secret && login.challengeId) {
    totpSecret = login.secret;
    const code = totp(totpSecret);
    const enrolled = await page.evaluate(async ({ challengeId, code: value }) => {
      const response = await fetch('/api/auth/2fa/setup/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challengeId, code: value, deviceName: 'Voice History CI' }),
      });
      return response.json();
    }, { challengeId: login.challengeId, code });
    if (!enrolled.authenticated) throw new Error(`2FA enrollment failed: ${JSON.stringify(enrolled)}`);
    return;
  }

  if (login.requiresTwoFactor && login.challengeId && totpSecret) {
    const code = totp(totpSecret);
    const verified = await page.evaluate(async ({ challengeId, code: value }) => {
      const response = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challengeId, code: value, deviceName: 'Voice History CI' }),
      });
      return response.json();
    }, { challengeId: login.challengeId, code });
    if (!verified.authenticated) throw new Error(`2FA verification failed: ${JSON.stringify(verified)}`);
    return;
  }

  throw new Error(`Unexpected login flow: ${JSON.stringify(login)}`);
}

async function history(page, projectId) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/conversations?projectId=${encodeURIComponent(id)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`history HTTP ${response.status}`);
    return response.json();
  }, projectId);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  localStorage.setItem('taso-voice-replies', 'false');
  class FakeSpeechRecognition {
    lang = '';
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    onstart;
    onresult;
    onerror;
    onend;
    stopped = false;

    start() {
      this.stopped = false;
      window.__tasoVoiceRecognition = this;
      this.onstart?.();
    }

    stop() {
      if (this.stopped) return;
      this.stopped = true;
      queueMicrotask(() => this.onend?.());
    }
  }
  window.SpeechRecognition = FakeSpeechRecognition;
  window.webkitSpeechRecognition = FakeSpeechRecognition;
});

const page = await context.newPage();
let conversationPosts = 0;
page.on('request', (request) => {
  if (request.method() === 'POST' && /\/api\/v1\/conversations\/messages(?:$|\?)/.test(request.url())) {
    conversationPosts += 1;
  }
});

try {
  await authenticate(page);
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.dashboard-chat').waitFor({ state: 'visible' });

  const projectSelect = page.locator('#cc30-project');
  await projectSelect.waitFor({ state: 'visible' });
  const options = await projectSelect.locator('option').evaluateAll((nodes) => nodes.map((node) => ({
    value: node.value,
    label: node.textContent?.trim() || '',
  })).filter((item) => item.value));
  if (options.length < 2) throw new Error(`voice history acceptance requires at least two projects; observed ${options.length}`);

  const primary = options[0];
  const secondary = options[1];
  await projectSelect.selectOption(primary.value);
  await page.waitForTimeout(150);

  const marker = `VOICE-HISTORY-REOPEN-${Date.now()}`;
  const beforePrimary = await history(page, primary.value);
  if ((beforePrimary.messages ?? []).some((message) => message.content === marker)) {
    throw new Error('voice history marker unexpectedly existed before the test');
  }
  const beforeSecondary = await history(page, secondary.value);
  if ((beforeSecondary.messages ?? []).some((message) => message.content === marker)) {
    throw new Error('voice history marker unexpectedly leaked to secondary project before the test');
  }

  await page.locator('.dashboard-chat-mic').click();
  await page.waitForFunction(() => Boolean(window.__tasoVoiceRecognition));
  await page.evaluate((text) => {
    const recognition = window.__tasoVoiceRecognition;
    recognition.onresult?.({
      resultIndex: 0,
      results: Object.assign([{ 0: { transcript: text }, isFinal: true }], { length: 1 }),
    });
  }, marker);

  await page.waitForFunction(async ({ projectId, text }) => {
    const response = await fetch(`/api/v1/conversations?projectId=${encodeURIComponent(projectId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return false;
    const payload = await response.json();
    const messages = payload.messages ?? [];
    const index = messages.findIndex((message) => message.role === 'user' && message.content === text);
    return index >= 0 && messages[index + 1]?.role === 'assistant';
  }, { projectId: primary.value, text: marker });

  if (conversationPosts !== 1) {
    throw new Error(`one voice final turn must produce exactly one conversation POST; observed ${conversationPosts}`);
  }

  const persisted = await history(page, primary.value);
  const persistedMessages = persisted.messages ?? [];
  const userIndex = persistedMessages.findIndex((message) => message.role === 'user' && message.content === marker);
  if (userIndex < 0) throw new Error('voice-originated user turn was not persisted');
  const assistantMessage = persistedMessages[userIndex + 1];
  if (!assistantMessage || assistantMessage.role !== 'assistant') {
    throw new Error('voice-originated assistant turn was not persisted next to the user turn');
  }
  const userMessageId = persistedMessages[userIndex].id;
  const assistantMessageId = assistantMessage.id;

  const postsBeforeReopen = conversationPosts;
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.dashboard-chat').waitFor({ state: 'visible' });
  const reopenedProjectSelect = page.locator('#cc30-project');
  await reopenedProjectSelect.selectOption(primary.value);
  await page.waitForFunction((text) => {
    const chat = document.querySelector('.dashboard-chat-messages');
    return Boolean(chat?.textContent?.includes(text));
  }, marker);

  if (conversationPosts !== postsBeforeReopen) {
    throw new Error(`reopening the project resubmitted a prior voice turn; POST count changed from ${postsBeforeReopen} to ${conversationPosts}`);
  }

  const reopened = await history(page, primary.value);
  const reopenedUser = (reopened.messages ?? []).find((message) => message.id === userMessageId);
  const reopenedAssistant = (reopened.messages ?? []).find((message) => message.id === assistantMessageId);
  if (!reopenedUser || !reopenedAssistant) {
    throw new Error('reopening did not restore the same persisted voice user/assistant message IDs');
  }

  await reopenedProjectSelect.selectOption(secondary.value);
  await page.waitForFunction(async ({ projectId, text }) => {
    const response = await fetch(`/api/v1/conversations?projectId=${encodeURIComponent(projectId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return false;
    const payload = await response.json();
    return !(payload.messages ?? []).some((message) => message.content === text);
  }, { projectId: secondary.value, text: marker });
  await page.waitForTimeout(150);
  const secondaryText = await page.locator('.dashboard-chat-messages').innerText();
  if (secondaryText.includes(marker)) throw new Error('voice history leaked into another project UI');
  if (conversationPosts !== postsBeforeReopen) throw new Error('project switch unexpectedly created a conversation POST');

  await reopenedProjectSelect.selectOption(primary.value);
  await page.waitForFunction((text) => Boolean(document.querySelector('.dashboard-chat-messages')?.textContent?.includes(text)), marker);
  if (conversationPosts !== postsBeforeReopen) throw new Error('returning to the original project unexpectedly resubmitted the voice turn');

  const report = {
    generatedAt: new Date().toISOString(),
    primaryProject: primary,
    secondaryProject: secondary,
    marker,
    conversationPosts,
    persistedUserMessageId: userMessageId,
    persistedAssistantMessageId: assistantMessageId,
    reloadRestoredSameIds: true,
    crossProjectLeakage: false,
    resubmittedOnReopen: false,
  };
  writeFileSync(`${out}/voice-history-reopen.json`, JSON.stringify(report, null, 2));
  await page.screenshot({ path: `${out}/voice-history-reopen-390.png`, fullPage: true });
  console.log(JSON.stringify(report));
} finally {
  await context.close();
  await browser.close();
}
