import { test, expect } from '@playwright/test';
import fs from 'node:fs';

function readSecretFromEnvOrFile(envName, fileEnvName) {
  const direct = process.env[envName];
  if (direct && direct.trim()) return direct.trim();
  const file = process.env[fileEnvName];
  if (file && fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  return '';
}

const baseUrl = (process.env.NINEROUTER_BASE_URL || process.env.ROUTER_BASE_URL || 'http://127.0.0.1:20127').replace(/\/$/, '');
const model = process.env.NINEROUTER_MODEL || process.env.MODEL || 'openai/gpt-5.6-luna';
const mode = process.env.NINEROUTER_TEST_MODE || 'dashboard'; // dashboard | v1
const apiKey = readSecretFromEnvOrFile('NINEROUTER_API_KEY', 'NINEROUTER_API_KEY_FILE')
  || readSecretFromEnvOrFile('ROUTER_API_KEY', 'ROUTER_API_KEY_FILE');
const timeoutMs = Number(process.env.NINEROUTER_TIMEOUT_MS || 30000);
const password = readSecretFromEnvOrFile('NINEROUTER_PASSWORD', 'NINEROUTER_PASSWORD_FILE');
const includeCursorToolPayload = /^(1|true|yes)$/i.test(process.env.NINEROUTER_CURSOR_TOOLS || '');

function safeErrorText(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text
    .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***')
    .slice(0, 1200);
}

test.describe('9router model probe', () => {
  test('dashboard model probe accepts target model', async ({ request }) => {
    test.skip(mode !== 'dashboard', 'NINEROUTER_TEST_MODE is not dashboard.');

    if (password) {
      const login = await request.post(`${baseUrl}/api/auth/login`, {
        timeout: timeoutMs,
        headers: { 'Content-Type': 'application/json' },
        data: { password },
      });
      expect(login.ok(), `Login failed: HTTP ${login.status()} ${safeErrorText(await login.text())}`).toBe(true);
    }

    const response = await request.post(`${baseUrl}/api/models/test`, {
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json' },
      data: { model },
    });

    const raw = await response.text();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch {}

    if (response.status() === 401 && !password) {
      throw new Error('Unauthorized. Set NINEROUTER_PASSWORD or NINEROUTER_PASSWORD_FILE for dashboard mode.');
    }
    expect(response.ok(), `HTTP ${response.status()} ${safeErrorText(body || raw)}`).toBe(true);
    expect(body?.ok, `Model probe failed: ${safeErrorText(body || raw)}`).toBe(true);
    expect(safeErrorText(body || raw)).not.toMatch(/Unsupported parameter.*max_tokens|max_tokens.*not supported/i);
  });

  test('public /v1 chat completions accepts max_tokens for target model', async ({ request }) => {
    test.skip(mode !== 'v1', 'NINEROUTER_TEST_MODE is not v1.');
    test.skip(!apiKey, 'Set NINEROUTER_API_KEY or NINEROUTER_API_KEY_FILE. Do not commit keys.');

    const response = await request.post(`${baseUrl}/v1/chat/completions`, {
      timeout: timeoutMs,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      data: {
        model,
        stream: false,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
        ...(includeCursorToolPayload ? {
          reasoning_effort: 'medium',
          tool_choice: 'auto',
          tools: [{
            type: 'function',
            function: {
              name: 'cursor_probe',
              description: 'Regression probe for Cursor-style function tool payloads.',
              parameters: { type: 'object', properties: {}, additionalProperties: false },
            },
          }],
        } : {}),
      },
    });

    const raw = await response.text();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch {}

    if (!response.ok()) {
      const detail = body?.error?.message || body?.error || body?.message || raw;
      const safeDetail = safeErrorText(detail);
      expect(safeDetail, `HTTP ${response.status()} from ${baseUrl}/v1/chat/completions`).not.toMatch(/Unsupported parameter.*max_tokens|max_tokens.*not supported|Function tools with reasoning_effort/i);
      throw new Error(`Model probe failed: HTTP ${response.status()} ${safeDetail}`);
    }

    expect(body, `Non-JSON or empty response: ${safeErrorText(raw)}`).toBeTruthy();
    expect(Array.isArray(body.choices), `No choices in response: ${safeErrorText(body)}`).toBe(true);
    expect(body.choices.length, `Empty choices: ${safeErrorText(body)}`).toBeGreaterThan(0);
  });
});
