# 9router long-term ops notes

## Instances on OpenClaw host

### Global instance (Production)

- Public domain: `https://9router.megavn.net`.
- Local/LAN service: `http://10.10.20.104:20128`.
- Deployment source: `/home/ubuntu/9router-deploy` (isolated from this repo checkout).
- Runtime: Docker container `9router` from local image tag `9router:local`.
- Port mapping: `20128:20128`.
- Persistent data volume: `/home/ubuntu/.9router:/app/data`.
- Restart policy: `--restart unless-stopped`.
- Required env for the current production container:
  - `DATA_DIR=/app/data`
  - `PORT=20128`
  - `HOSTNAME=0.0.0.0`
  - `NODE_ENV=production`
  - `NEXT_PUBLIC_BASE_URL=https://9router.megavn.net`
  - `ENABLE_REQUEST_LOGS=true` only while debugging (logs can contain prompts, tool args, images, and headers).
- Build/redeploy pattern:

```bash
cd /home/ubuntu/9router-deploy
docker build -t 9router:local .
docker rm -f 9router
docker run -d --name 9router --restart unless-stopped \
  -p 20128:20128 \
  -v /home/ubuntu/.9router:/app/data \
  -e DATA_DIR=/app/data \
  -e PORT=20128 \
  -e HOSTNAME=0.0.0.0 \
  -e NODE_ENV=production \
  -e NEXT_PUBLIC_BASE_URL=https://9router.megavn.net \
  -e ENABLE_REQUEST_LOGS=true \
  9router:local
```

Useful checks:

```bash
docker ps --filter name=9router
docker logs 9router --tail 100
ss -ltnp | grep 20128
curl -sS -I http://127.0.0.1:20128/favicon.ico
curl -sS http://127.0.0.1:20128/v1/models | jq .
```

Avoid changing/restarting production when testing source changes unless explicitly intended.

### Source/dev repo instance

- Repo: `/home/ubuntu/.openclaw/workspace/repos/9router`.
- Source test port: `20127` to avoid the global instance on `20128`.
- Local URLs:
  - `http://localhost:20127`
  - `http://127.0.0.1:20127`
  - `http://10.10.20.104:20127`
- Local `.env` settings used for source work:
  - `DATA_DIR=./data`
  - `PORT=20127`
  - `BASE_URL=http://localhost:20127`
  - `NEXT_PUBLIC_BASE_URL=http://localhost:20127`
- Login default for current source DB/env: password from `.env` `INITIAL_PASSWORD`; during 2026-08-01 test it was `change-me`.
- Typical source commands:

```bash
npm install
npm run dev -- --port 20127
npm run build
PORT=20127 HOSTNAME=127.0.0.1 NEXT_PUBLIC_BASE_URL=http://localhost:20127 npm run start
```

## Browser/Playwright-style UI test notes

The OpenClaw host needs Chromium with `--no-sandbox`. `agent-browser open` did not expose that flag in the tested flow, so the working pattern was:

```bash
/home/ubuntu/.agent-browser/browsers/chrome-151.0.7922.71/chrome \
  --headless=new \
  --no-sandbox \
  --disable-dev-shm-usage \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9229 \
  --user-data-dir=/tmp/agent-browser-9router-profile \
  about:blank

agent-browser --session 9router-src connect 9229
agent-browser --session 9router-src goto http://localhost:20127/dashboard/providers
```

Important dev-server gotcha: using `127.0.0.1` in the browser while Next dev served `localhost` caused a blocked cross-origin HMR/dev-resource warning. Prefer `http://localhost:20127` for UI automation, or add `allowedDevOrigins: ['127.0.0.1']` to Next config if needed.

## OpenAI `gpt-5.x`/o-series compatibility fix

Observed error when testing `openai/gpt-5.6-luna`:

```text
Unsupported parameter: 'max_tokens' is not supported with this model ...
```

Fix is in `open-sse/executors/default.js`: for newer OpenAI reasoning models (`gpt-5*`, `o1*`, `o3*`, `o4*`), convert request body field `max_tokens` to `max_completion_tokens` before forwarding upstream. This was placed in the default executor so dashboard model tests and OpenAI-compatible routes benefit, not only one provider-specific executor.

Verified 2026-08-01 on source instance:

- Added custom provider `OpenAI` with prefix `openai` and base URL `https://api.openai.com/v1`.
- Added connection using key from `/home/ubuntu/openai.key` without printing it.
- Provider check with `gpt-5.6-luna`: `Valid`.
- Test Connection One-by-One: `Passed: 1`, `Failed: 0`.
- Added Available Model `gpt-5.6-luna`; alias shown as `openai/gpt-5.6-luna`.
- Model Test button showed success/check-circle; no `max_tokens` error.

## Reusable e2e model probe

Script added to `package.json`:

```bash
npm run test:e2e:model
```

It runs `tests/e2e/model-probe.spec.mjs` using Playwright's API request client. Default mode is `dashboard`, which logs in first when `NINEROUTER_PASSWORD`/`NINEROUTER_PASSWORD_FILE` is set, then calls the same internal endpoint used by the dashboard model Test button: `/api/models/test`. This is best for source/dev validation because custom-provider display aliases such as `openai/...` may differ from the provider storage alias. Optional mode `v1` calls `/v1/chat/completions` with `max_tokens` and a 9router API key, useful for validating the public OpenAI-compatible API surface.

Examples:

```bash
# Source/dashboard model Test equivalent on 20127
# For custom providers, pass the provider storage alias if display alias routing differs.
NINEROUTER_BASE_URL=http://127.0.0.1:20127 \
NINEROUTER_PASSWORD_FILE=/path/to/source-login-password.txt \
NINEROUTER_MODEL=openai-compatible-chat-3846df15-be52-437e-b63b-04d7de178b1b/gpt-5.6-luna \
npm run test:e2e:model

# Public /v1 API mode on global/public instance
NINEROUTER_TEST_MODE=v1 \
NINEROUTER_BASE_URL=https://9router.megavn.net \
NINEROUTER_API_KEY_FILE=/path/to/9router-api-key.txt \
NINEROUTER_MODEL=openai/new-model-id \
npm run test:e2e:model

# Cursor-style public /v1 regression: tools + reasoning_effort
NINEROUTER_TEST_MODE=v1 \
NINEROUTER_CURSOR_TOOLS=true \
NINEROUTER_BASE_URL=http://127.0.0.1:20127 \
NINEROUTER_API_KEY_FILE=/path/to/9router-api-key.txt \
NINEROUTER_MODEL=openai/gpt-5.6-luna \
npm run test:e2e:model
```

Never print, commit, or paste raw API keys. Use `NINEROUTER_API_KEY_FILE` where possible.

## Cursor + GPT-5 chat-completions tool compatibility

Cursor IDE can send `tools` plus `reasoning_effort` through `/v1/chat/completions`. OpenAI rejects this for `gpt-5.6-luna` with: `Function tools with reasoning_effort are not supported ... use /v1/responses or set reasoning_effort to 'none'`. The source patch in `open-sse/executors/default.js` detects GPT-5-family function-tool requests and sets `reasoning_effort` to `none` before forwarding, preserving tool calls for Cursor on chat completions.

## Cursor/OpenAI-compatible GPT-5 regressions fixed 2026-08-03

### Strict OpenAI image content schema

Cursor can send OpenAI chat-completions image content parts with extra metadata, for example:

```json
{
  "type": "image_url",
  "image_url": {
    "url": "data:image/png;base64,...",
    "dimensions": { "width": 10, "height": 10 }
  },
  "providerOptions": { "cursor": {} }
}
```

OpenAI-compatible chat endpoints for models such as `gpt-5.6-luna` are strict and may fail with:

```text
Invalid chat format. Unexpected keys in a message content image dict.
```

The request must be normalized so image content parts contain only:

```json
{ "type": "image_url", "image_url": { "url": "...", "detail": "auto" } }
```

Implementation notes:

- `open-sse/executors/default.js` sanitizes image parts in the default OpenAI-compatible executor path.
- `open-sse/handlers/chatCore.js` repeats the sanitizer at the final pre-dispatch boundary so passthrough/translated routes that bypass the default executor still get a strict OpenAI shape.
- Strip sibling fields such as `providerOptions` and nested fields such as `dimensions`, `id`, `name`, `mime_type`, and `data`. Keep only `url` and optional `detail` inside `image_url`.

### Codex Responses rejects reasoning controls

Cursor can send `reasoning_effort` even for plain text requests routed to `cx/gpt-5.5` / `codex/gpt-5.5`. The Codex Responses backend currently rejects these controls with:

```text
Unsupported parameter: reasoning_effort
```

Implementation notes:

- `open-sse/executors/codex.js` removes `reasoning_effort`, `reasoning`, and `include` from the request body and nested Responses `input` content.
- The Codex Responses allowlist intentionally excludes `reasoning` and `include`.
- `open-sse/translator/request/openai-responses.js` must not synthesize a Responses `reasoning` object from Chat Completions `reasoning_effort`.
- `open-sse/executors/base.js` has a last-mile guard immediately before `JSON.stringify`/`fetch`; it must delete reasoning controls for Codex Responses rather than setting `reasoning_effort: "none"`.
- Keep the `reasoning_effort: "none"` workaround only for non-Codex GPT-5/o-series chat-completions requests with function tools.

### Debug request logging

When `ENABLE_REQUEST_LOGS=true`, logs are written under `/app/logs/<source>_<target>_<model>_<timestamp>/`. Important files:

- `1_req_client.json`: original client request and headers.
- `2_req_source.json`: detected source request body.
- `3_req_openai.json`: intermediate OpenAI body when translation uses one.
- `4_req_final.json`: final logical body after translation/normalization/sanitization, before executor dispatch.
- `4_req_target.json`: target request logged by executor.
- `5_res_provider.*`: upstream provider response.
- `6_error.json`: upstream/provider error details.
- `7_res_client.*`: response returned to the client.

Caveat: `4_req_final.json` is the logical pre-dispatch body, but the base executor can still mutate the body after that just before `fetch`. If provider errors contradict `4_req_final.json`, inspect `open-sse/executors/base.js` last-mile mutations.

Logs can contain prompts, tool arguments, base64 images, headers, and other sensitive content. Enable in production only for debugging, or add masking before leaving it on.

### Required post-patch verification

After every 9router compatibility patch:

1. Build and redeploy production or the intended test instance.
2. Send an e2e request through the actual public `/v1/chat/completions` endpoint.
3. Inspect `4_req_final.json` and `4_req_target.json` for the relevant request.
4. Inspect `5_res_provider.*` or `6_error.json`.
5. Do not declare success from Docker build/container `Up` alone.

Regression examples:

```bash
# Codex: should return HTTP 200 and final logs must not contain reasoning_effort/reasoning/include.
curl -sS https://9router.megavn.net/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $NINEROUTER_API_KEY" \
  --data '{"model":"cx/gpt-5.5","messages":[{"role":"user","content":"hi"}],"stream":false}'

# Luna image: intentionally include Cursor-style metadata; final logs must strip it.
curl -sS https://9router.megavn.net/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $NINEROUTER_API_KEY" \
  --data @/tmp/test-luna-valid-image.json
```
