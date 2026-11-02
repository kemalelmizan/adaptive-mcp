# @adaptivemcp/router-proxy

An OpenAI-compatible router that sits **in front of** a host. The host points a
provider's `baseURL` here and names a **virtual model**; the proxy decides which
backend serves each request. The host's model choice becomes a policy instead of a
fixed pin.

This is the only way to get per-request model routing into OpenCode today: its
plugin API exposes `chat.params`, which receives the model but can only change
sampling (`temperature`, `topP`, `topK`, `maxOutputTokens`, `options`) — the model is
resolved before the hook runs, and there is no `chat.model` hook. A proxy is
transparent to the host and therefore needs no host support.

## What it does

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | liveness |
| `GET /v1/models` | the configured virtual models |
| `POST /v1/chat/completions` | route, forward, and stream the response back unchanged |

- **Faithful passthrough.** The request body is forwarded with `model` rewritten and
  the backend's `chat_template_kwargs` merged in; the response body is piped through
  byte for byte, so SSE streaming needs no special case.
- **Auth.** A backend may name `apiKeyEnv` for its own token; otherwise the host's
  `Authorization` header is passed through (so a cloud backend keeps the host's
  session).
- **Fallback.** A backend may name fallbacks, tried only while nothing has been
  streamed — a host never sees half a response from one model and half from another.
- **Observability.** Every response carries `x-adaptive-route: <backend>`, and each
  request logs one line with the model, backend, stream flag and the reason.

## Run

```bash
pnpm --filter @adaptivemcp/router-proxy build
cp apps/router-proxy/router-proxy.example.json ~/.config/adaptivemcp/router-proxy.json
node apps/router-proxy/dist/index.js --config ~/.config/adaptivemcp/router-proxy.json
```

Point a host at it:

```jsonc
// opencode.json
"provider": {
  "adaptive": {
    "npm": "@ai-sdk/openai-compatible",
    "name": "Adaptive Router",
    "options": { "baseURL": "http://127.0.0.1:8083/v1" },
    "models": {
      "auto":  { "name": "Auto (policy)" },
      "coder": { "name": "Qwen3-Coder 30B" },
      "fast":  { "name": "Qwen3 8B" }
    }
  }
}
```

The host sends the bare model id (`auto`, `coder`, `fast`); the proxy also accepts a
`provider/` prefix, so `adaptive/coder` resolves the same way.

## Qwen3 and thinking

Qwen3-8B is a hybrid reasoning model: by default it writes
`reasoning_content` until it runs out of tokens and returns empty `content`. llama.cpp
accepts `chat_template_kwargs: { "enable_thinking": false }` per request, so the
backend sets it and the proxy injects it on every call. Backend knobs win over the
host's: they describe how that server is started.

## What is not here yet

`auto` currently resolves to `defaultBackend` and says so
(`auto: no learned recommendation yet`). Making it *adaptive* needs two things that
do not exist yet:

1. the host must record **which model** made each tool call (the OpenCode plugin
   currently records none), and
2. the store needs per-`(tool, model)` statistics to compare.

The policy is a pure function (`src/policy.ts`) so that work can land without
touching the transport.
