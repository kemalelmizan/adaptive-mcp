# Doubts & Feedback — Adaptive MCP

Review snapshot: **2026-09-29**. This file is our living plan/action sheet for
next steps. Each item has a status: `open` / `decided` / `done`.

**First-party host (2026-09-29):** `adaptivemcp/agent` now exercises the loop end
to end — decoding, model routing, approvals, server-governed policy, cost,
compression, cross-client reporting, and graph guardrails. See §14; it resolves
or advances several items below.

**Ecosystem recheck (2026-07-19):** SEP-2133 is now **Final** and the
`capabilities.extensions` field is present in the released TypeScript SDK
(verified `@modelcontextprotocol/sdk@1.29.0`). SEP-2577 (deprecate logging) is
also **Final**. Server Card #1649 is still **Draft**. See §7.

---

## 0. State (what exists)

- 10 published `@adaptivemcp/*` packages — built, tested, on npm (4 former stubs promoted to `0.1.0` in iter 1).
- `AdaptiveRuntime` (`@adaptivemcp/runtime`) holds the adaptation loop; `examples` is a thin demo over it.
- `Store` interface in `spec` is the persistence boundary; `MemoryStore` is the ref impl; middleware depends on the interface (backend swappable).
- Docs: `adaptivemcp.github.io` + `docs/sep-2133-tools-metadata.md` (draft SEP for `dev.adaptivemcp/tools-metadata`).
- CI: lint + build + test + release dry-run gate; publishes on `main`.

---

## 1. Doubts (open questions)

- [ ] **Who owns the store in production?** `decided`
  The learning **Store is client-owned** — `AdaptiveRuntime` holds it and learns
  locally; the server publishes a static `annotation` and MAY fold `report_observation`
  reports if it persists them. A stateless server just publishes static `annotation`.
  **Two-store model:** (1) client-owned local Store improves that client only;
  (2) server-published view is a separate, optional cross-client signal. The SEP
  should state this explicitly.

**Resolved (iter 1 / 2026-07-19), kept for history:** YAML format (now YAML+JSON
content negotiation), package coupling (`Store` interface), Node 22 vs 26 (engines
`>=22`, "Node 22+ (Node 26 recommended)"), thin-client reality (4 stubs promoted to
`0.1.0`). See §1b for the SEP-critique resolutions.

### 1c. New doubt: does `AdaptiveRuntime` deserve to be one package? (2026-07-21)

Surfaced while fixing `examples/README.md`'s Walkthrough 2 (a reader assumed
`@adaptivemcp/extension` = server-side, `@adaptivemcp/runtime` = client-side —
reasonable guess from the names, and wrong). The doc fix patched the
symptom; the underlying naming/boundary question is still open.

- [ ] **`AdaptiveRuntime` bundles two different "sides" under one name.** `open`
  Today `AdaptiveRuntime` (`packages/runtime/src/index.ts`) wires telemetry,
  evaluation, `extension`, routing, orchestration, and approval into one
  object — and per §1's two-store model, the whole thing is **client-owned**
  (a stateless server just publishes static `annotation`; the client is where
  the learning Store actually lives). So `AdaptiveRuntime` is not
  "server-side" in the deployment sense, but it also isn't "the client
  package" — that's `@adaptivemcp/thin-client` (`ThinClient`), which owns the
  *execution lifecycle* (approval gate + retry) and is explicitly documented
  as "the operational machinery that runs on the client side."
  Two different things currently both look client-adjacent:
  - `AdaptiveRuntime` — the **learning loop** (telemetry → evaluation →
    extension/routing/orchestration/approval writes). Runs wherever the
    client-owned Store lives; in the examples it's also demoed fully
    standalone with no MCP transport at all (Walkthrough 3).
  - `ThinClient` — the **execution loop** (gate → call → retry → record).
    Actually drives MCP tool calls.
  Nothing stops someone from wiring `AdaptiveRuntime` into a server process
  today (the examples literally do, for the `extension`'s resource-serving
  half) even though the two-store model says the *learning* Store should be
  client-owned. That's a real ambiguity, not just a naming nit: **is
  `AdaptiveRuntime` "the client's learning loop," or is it "a generic bundle
  that happens to include the extension, which is server-side"?** Right now
  it's the latter in practice, which is what caused the doc confusion.
  **Options to resolve (not decided):**
  1. Split `AdaptiveRuntime` into a client-facing `LearningRuntime` (telemetry/
     evaluation/routing/orchestration/approval — no `extension`) and keep
     `extension` wiring server-side only (`server.ts` composes them itself).
     ✅ names match deployment reality; ❌ breaking change, more wiring
     boilerplate in every server example.
  2. Keep one `AdaptiveRuntime` package but rename it to something
     transport/side-neutral (e.g. `@adaptivemcp/loop` or `@adaptivemcp/core`)
     so it stops implying "runtime = the thing that runs on the client,
     opposite of the server's extension."
  3. Leave the package as-is; fix documentation only (done for
     `examples/README.md`; would need the same pass over the top-level
     `README.md`'s Architecture section if it makes the same server/client
     implication — there is no separate `docs/architecture.md`).
  Leaning toward (3) short-term (cheapest, already partly done) with (2) as a
  cheap follow-up if the confusion recurs; (1) only if the two-store model
  in §1 hardens into an actual deployment requirement (e.g. a server MUST NOT
  hold the learning Store) rather than today's "MAY fold reports" framing.

### 1b. New doubts from SEP critique (2026-07-19)

**Open:**
- [ ] **Resources are application-driven, not model-driven — the consumption model is wrong.** `open`
  The resource is a *client-side* input the host reads and may inject; not pushed to
  the model by the protocol. Known limitation, not a blocker (no core SEP available).
  **Update (2026-09-29):** a real host now demonstrates the intended consumption
  path — the agent reads `dev.adaptivemcp/tools-metadata` and applies it as a
  policy floor, and injects learned context into its own prompt. The protocol
  limitation stands (no auto-push); the host-driven design is now exercised, not
  just assumed.
- [x] **It reinvents governance that overlaps core `ToolAnnotations` and the consent model.** `decided` (2026-09-29)
  `annotation` is framed as *additional, complementary* hints (risk/budget/owner)
  on top of core `ToolAnnotations`. Deep dive **§10**; chosen hybrid **§11**
  (implemented). The precedence rule (host UI > suggestion > nothing) is now in
  SEP §Security and demonstrated by the first-party agent. Static-alignment to
  Server Card #1649 is tracked separately (still Draft).

**Resolved (kept for history):** observation channel (`report_observation` tool, not
logging/SEP-2577); `capabilities.extensions` now real in SDK 1.29.0 (advertise via it,
`experimental` fallback); "server suggests, client enforces" framing; advisory (not
machine-enforced) policy; client-owned Store; YAML+JSON content negotiation; `etag` +
`resources/subscribe` freshness; `client_id` multi-client semantics; `budget` units +
Risk taxonomy; SEP reclassified Experimental/Incubating (SDK-impl upstream task tracked,
not done).

---

## 2. Coupling analysis (resolved, iter 1)

Resolved in iteration 1: introduced a `Store` interface in `spec` (all 8 consumers
depend on it, not the concrete `MemoryStore`); extracted `AdaptiveRuntime` into
`@adaptivemcp/runtime` as the batteries-included entry point; promoted the 4 stubs
to published `0.1.0`; settled store ownership as **client-owned** (see §1). The
backend is now swappable and the dependency graph is no longer monolithic glue.

---

## 3. Feedback / nits (resolved)

Resolved: ROADMAP/reality drift (stubs promoted, `runtime` added); release fixed
(`--dry-run` CI gate); Node version unified; SEP observation channel specified as
the `report_observation` tool; `AdaptiveRuntime` transport-agnostic; coupling fix
verified in code (middleware imports `type { Store }`, `MemoryStore` only in tests);
`capabilities.extensions` advertising now demonstrated in `examples/src/server.ts`.

**Open nits:**
- [x] **SEP schema ahead of code (budget / require_approval) — code resolved
      2026-09-28.** `ToolMetadataView` now projects both, derived from
      `routing`/`approval` recommendations (`packages/extension/src/view.ts`).
      `Annotation` itself still doesn't carry them; remaining question is whether
      the SEP should point at `annotation.*` or at the recommendation-derived
      view. (See §8 gap #1.)
- [x] **Resource URI identifier vs wire URI — resolved 2026-09-29.**
      Phase 11 fixed the emitted URIs; the SEP Resource table now lists the
      scheme-less extension identifier and the wire URI on separate rows.
- [ ] **Advertising not demonstrated** — now resolved (see above); kept only as a
      record.

---

## 4. Action plan (condensed)

1. Unblock release — ✅ dry-run CI gate; `isDirty` only blocks real publish.
2. Coupling fix — ✅ `Store` interface + `@adaptivemcp/runtime`.
3. Resolve stubs — ✅ promoted all 4 to published `0.1.0`.
4. YAML question — ✅ serve YAML **and** JSON via content negotiation.
5. Unify Node version — ✅ "Node 22+ (Node 26 recommended)".
6. Sharpen the SEP — ✅ `report_observation` tool is the concrete channel.
7. SEP-2133 critique doubts (§1b) — ✅ all but two: #1649 governance overlap (§1b)
   and the official-SDK process blocker (§6), both `open`.
8. Reconcile SEP schema with code — `open`: implement/trim `annotation.budget`/
   `require_approval`; split identifier vs wire URI. See §8.

---

## 6. Open item: upstream SDK PR to `@modelcontextprotocol/sdk` (the only path to Final)

**Status:** `open` / `planned` — **decision: WAIT until the handler stabilizes in
the wild**, then open the PR. Draft the module skeleton now as a branch + issue,
but do **not** open the PR yet.

**Why this is the blocker.** SEP-2133 requires "at least one reference
implementation in an official SDK" before a proposal can graduate Final. Our
reference impl lives in `@adaptivemcp/extension` (a third-party package), which
does **not** satisfy that requirement. The SEP is currently **Experimental /
Incubating** (allowed by SEP-2133's incubation pathway), so honest adoption is
fine today — but graduation needs the SDK impl.

**Trigger to open the PR (stabilization gate).** Open the upstream PR only after
ALL of:
- `report_observation` tool schema + `ExtensionController.reportObservation()`
  handler have shipped in ≥ 2 published `@adaptivemcp/extension` releases with
  **no breaking changes** to the wire schema (watch `client_id`, `duration_ms`,
  `cost`, `foldReports`, timestamp handling).
- The `dev.adaptivemcp/tools-metadata` resource shape (YAML+JSON, `etag`) is
  stable across those releases.
- At least one external consumer (outside this repo) has used it, OR ≥ N weeks
  of real usage with no schema churn. (Pick a concrete N when drafting — suggest
  4–6 weeks post-1.0 of the extension.)

**What the PR should contain (skeleton to draft now).** A minimal, dependency-light
module in `@modelcontextprotocol/sdk` (TypeScript), mirroring our reference impl:
- `packages/sdk/src/server/toolsMetadata.ts` — server-side helpers:
  - `ToolsMetadata` / `ToolAnnotation` / `ObservationReport` / `Risk` / `Budget`
    types (kept in sync with `packages/extension/src/view.ts` + `controller.ts`).
  - `registerToolsMetadataResource(server, { getView, mimeType })` — registers
    the `dev.adaptivemcp/tools-metadata` resource (YAML+JSON via content
    negotiation, `etag` from SHA-1 of `{version, tools}`).
  - `registerReportObservationTool(server, { onReport })` — the `report_observation`
    tool with `client_id`, `minimum: 0` constraints, timestamp validation, and
    opt-in `foldReports` semantics.
- `packages/sdk/src/client/toolsMetadata.ts` — client-side `readToolsMetadata()`
  + optional local folding helper (the client-owned Store path).
- `packages/sdk/src/server/toolsMetadata/conformance.ts` — the conformance test
  suite referenced in the SEP's "Maturity & graduation" section (resource
  advertises via `capabilities.extensions`, serves YAML+JSON, etag stable, tool
  validates and folds). This doubles as the graduation evidence.
- Docs snippet for the SDK README + a link back to `docs/sep-2133-tools-metadata.md`.

**Coordination dependencies (track alongside).**
- Engage **Server Card #1649** before finalizing governance framing (who wins
  when the host's own consent UI already gates a tool — the still-open §1b item).
- **`capabilities.extensions` now exists in the SDK (verified 1.29.0).** The SDK
  impl should advertise via `extensions` (not `experimental`). Keep `experimental`
  only as a fallback for older SDKs. This lowers the risk of the stabilization
  gate in §6 — the graduation blocker is now mostly about process/upstream review,
  not missing schema support.

**Concrete next actions (when the gate is met).**
1. Fork `modelcontextprotocol/typescript-sdk`; branch `feat/tools-metadata`.
2. Port the skeleton above from `@adaptivemcp/extension` (keep types 1:1).
3. Add the conformance suite; ensure it passes in the SDK's own test runner.
4. Open the PR referencing SEP-2133 + this repo's reference impl; mark the
   §1b process-blocker `done` once merged, and update the SEP status from
   Experimental/Incubating → (candidate for) Final per SEP-2133's process.

**Decision recorded:** draft the skeleton now (branch + issue, no PR); open the
PR only after the stabilization gate. Revisit this item at the next review
snapshot.

---

## 7. Ecosystem check (2026-07-19)

Verified against the live MCP repos and the installed SDK. This changes several
`decided` resolutions in §1b and the §6 plan.

- **SEP-2133 (Extensions framework) — Final.** Merged into `modelcontextprotocol/
  main` on 2026-01-27 (label `final`, milestone `2026-07-28-RC`). The `extensions`
  capability is now part of the wire schema. The TS SDK tracking issue (#2188) is
  **Done**.
- **`capabilities.extensions` exists in the released SDK.** Verified in the
  workspace's `@modelcontextprotocol/sdk@1.29.0`: `types.d.ts` defines
  `extensions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodCustom<object, object>>>;`
  inside both `ServerCapabilities` and `ClientCapabilities`. So the SEP's "interim
  `experimental`" advertising is obsolete — advertise via `capabilities.extensions`.
- **SEP-2577 (deprecate Roots/Sampling/Logging) — Final.** Merged 2026-05-16.
  Confirms the decision to drop `notifications/message` (logging) as the report
  channel was correct *and* future-proof; SDKs are actively removing the logging
  surface.
- **Server Card #1649 — still Draft (open, not merged).** The governance-overlap
  concern (who wins when the host's own consent UI already gates a tool) remains
  genuinely unresolved. The SEP's plan to "engage #1649" is still valid but blocked
  on upstream. **Caveat (see §10):** #1649 is *discovery* metadata
  (`.well-known/mcp/server-card.json` + `mcp://server-card.json`), not a runtime
  consent-enforcement mechanism — so engaging it aligns the *static* `annotation`
  shape but does **not** by itself resolve the call-time precedence conflict. Keep
  that §1b item `open`.
- **Net effect on the SEP's maturity story.** The incubation pathway reasoning in
  the SEP is still valid, but the *schema-support* half of the graduation blocker
  is gone. What remains for Final is purely the upstream-SDK reference impl (§6)
  and the #1649 governance alignment.

## 8. Implementation gaps found in code review (2026-07-19)

1. **SEP schema vs code drift (budget / require_approval) — code resolved
   2026-09-28.** `ToolMetadataView` (`packages/extension/src/view.ts`) now emits
   `budget` (from a `routing` recommendation's `perToolLimit`) and
   `require_approval` (from an `approval` recommendation's decision). The
   `Annotation` type still doesn't carry them, so the open part is only SEP prose
   alignment — point it at the recommendation-derived view, or add the fields.
   **Update (2026-09-29):** the reference *server* now emits them too
   (`examples/src/server.ts` seeds owner/`require_approval`/budget) and a client
   consumes them (the agent's `/policy`). Remaining open part is still SEP prose.
2. **Resource URI documentation — code side resolved 2026-09-28.** Phase 11 fixed
   the emitted resource URIs to well-formed `dev.adaptivemcp://...` values
   (`@adaptivemcp/extension`). The SEP Resource table still conflates the
   scheme-less identifier (`dev.adaptivemcp/tools-metadata`) with the wire URI;
   split them explicitly.
3. **Advertising not demonstrated.** ✅ Resolved — `examples/src/server.ts` now
   sets `capabilities.extensions: { "dev.adaptivemcp/tools-metadata": {} }`.
4. **Two-store model under-documented.** Client-owned local Store vs server-
   published view (see the "Who owns the store" item above). State it in the SEP.
5. **Coupling fix is correct** (verified) — no action; §2 Problem #1 is resolved.

---

## 10. Deep dive: #1649 governance overlap (2026-07-19)

The single remaining blocking doubt (§1b "reinvents governance") is really **three
overlapping layers**, and they need to be disentangled before we can state a
precedence rule. Grounded in the live MCP spec (2025-06-18 and 2025-11-25).

### Layer 1 — Adaptive `annotation` vs core `ToolAnnotations`

Core MCP already ships native, protocol-level tool behavior hints via
`Tool.annotations` (the `ToolAnnotations` object on each tool in `tools/list`):

| Core field | Meaning | Adaptive `annotation` overlap |
|---|---|---|
| `title` | human-readable display name | `annotation.owner`/`description` (different axis, OK) |
| `readOnlyHint` | no external world change | `risk` (low ≈ read-only) |
| `destructiveHint` | irreversible / destructive | `risk` (high ≈ destructive) |
| `idempotentHint` | repeat = same result | `risk` (medium) |
| `openWorldHint` | interacts with outside world | `risk` (high ≈ open-world) |

**Finding:** `annotation.risk` (low/medium/high) is a *coarser re-expression* of
`destructiveHint` + `openWorldHint` + `readOnlyHint`. The spec is explicit that
clients **MUST** treat `ToolAnnotations` as **untrusted unless from a trusted
server** — so a host already has a (native, untrusted) risk signal. Adding a
parallel `risk` taxonomy the host must learn *and* trust is redundant surface that
the host may simply ignore. **Recommendation:** map `annotation.risk` onto the core
hints where a 1:1 exists (`high` → `destructiveHint:true`/`openWorldHint:true`), and
keep `risk` only for the *adaptive/learned* dimension (e.g. "observed flaky /
costly in practice") that core hints cannot express. Don't invent a competing
static taxonomy.

### Layer 2 — `require_approval` / `budget` vs the host's own consent UI

The MCP spec's **Security Considerations** are unambiguous that consent is a
**client/host responsibility**, not a server-enforced one:

> "For trust & safety and security, there **SHOULD** always be a human in the loop
> with the ability to deny tool invocations." — Clients **SHOULD** "Prompt for user
> confirmation on sensitive operations" and "Show tool inputs to the user before
> calling."

So the host's consent UI is the **authoritative** gate. Adaptive MCP's
`require_approval` and `budget` are *server suggestions* about when that gate should
fire. **The conflict:** if the host already prompts for a destructive tool, what does
`require_approval: false` from the server mean? If the host does **not** prompt, does
`require_approval: true` force it to? The spec gives the host the final say, so the
server cannot *force* a gate — but it also cannot *waive* one the host imposes.

**Precedence rule (proposed, to add to SEP §Security):**
```
host consent UI  >  Adaptive MCP suggestion  >  nothing
```
- The host MAY always prompt, regardless of `require_approval`.
- `require_approval: true` is a *request* the host SHOULD honor but MAY ignore.
- `require_approval: false` / `budget` NEVER lowers a gate the host already applies.
- Adaptive MCP is strictly **advisory** (already stated in SEP; reinforce with the
  rule above so adopters don't assume `require_approval` is enforced).

Note: `elicitation/create` is the *only* server→user input mechanism in MCP, and
servers MUST NOT request sensitive info through it. Adaptive MCP correctly does
**not** use elicitation for approval — approval stays client-side, which is
consistent with the spec. Good.

### Layer 3 — Server Card #1649 (the likely long-term home, but not the fix)

Server Card (#1649, **Draft**) is HTTP **discovery** via
`.well-known/mcp/server-card.json` plus an MCP resource `mcp://server-card.json`.
Its schema mirrors the initialization result (`serverInfo`, `transport`,
`capabilities`, `authentication`, `instructions`, `resources`/`tools`/`prompts` as
static or "dynamic"). It is **metadata about a server**, not a runtime
consent-enforcement channel.

**Implication for the overlap:**
- #1649 is the *right place* to standardize the **static** `annotation` shape
  (risk/owner/budget) so every client reads it the same way — engaging it (per §6)
  aligns our fields with the ecosystem's discovery format. **Do** track it as the
  alignment target.
- But #1649 does **not** define *call-time* precedence between server suggestion and
  host consent UI. Discovery metadata says "this tool is high-risk"; it does not say
  who wins at `tools/call` time. So engaging #1649 resolves Layer-1/static
  alignment, **not** the Layer-2 runtime conflict.

### Resolution direction (what unblocks the doubt)

1. **Map, don't duplicate:** express `annotation.risk` via core `ToolAnnotations`
   where possible; reserve `risk` for the learned/observed dimension.
2. **State precedence explicitly** in SEP §Security (host UI > suggestion > nothing);
   keep `require_approval`/`budget` clearly advisory.
3. **Track #1649 as the static-alignment target** (per §6), but record that it does
   not by itself resolve the runtime overlap — the precedence rule in (2) is ours to
   specify regardless of #1649's status. (Strategy options + chosen hybrid in §11.)
4. **Code gap reminder:** `budget`/`require_approval` are not yet emitted by the
   reference impl (§8 gap #1) — so the precedence rule is currently theoretical until
   those fields ship.

**Status:** `decided` (2026-09-29). The precedence rule (host UI > suggestion >
nothing) is now stated in SEP §Security and demonstrated by the first-party agent.
The Layer-3 static-alignment target (Server Card #1649) remains open upstream but
does not block the call-time rule.

## 11. Compliance strategy options for the #1649 governance overlap (2026-07-19)

The overlap only lives in the **server-published `annotation` view**. The client-owned
local Store (§1b "who owns the store") is already compliant — it is the client's own
policy input the host reads; no protocol conflict. So "comply" = what we do with the
static `annotation` the server publishes. Four strategies, least → most aligned:

### Strategy 1 — Pure learned-layer (zero overlap)
Strip the server-published `annotation` to **only what core MCP can't say**: observed
flakiness, observed cost/budget overruns, `owner`, learned `recommendations`. Never
emit static `risk`/`require_approval`.
- ✅ Fully compliant — no duplication of `ToolAnnotations`, no contesting the host UI.
- ✅ Lowest risk; matches "server suggests, client enforces."
- ❌ Loses the pre-call static risk signal (host only learns risk after observing).
- Note: this is basically the current code state — `budget`/`require_approval` aren't
  emitted yet (§8 gap #1), so we are already most of the way here.

### Strategy 2 — Translate to core `ToolAnnotations` (max host uptake)
Keep *computing* risk, but **write it back into the server's own `Tool.annotations`**
(`destructiveHint`/`openWorldHint`/`readOnlyHint`) so the host's native (untrusted)
signal carries it. The resource keeps only learned extras + `owner` + `budget`.
- ✅ Hosts already parse `ToolAnnotations` — highest uptake, no new taxonomy to teach.
- ✅ Eliminates Layer-1 redundancy.
- ❌ Requires the server to mutate its own tool definitions (extension must reach into
  the `McpServer` tool list, not just the resource).
- ❌ Still advisory (spec says clients treat `ToolAnnotations` as untrusted).

### Strategy 3 — Advisory parallel + explicit precedence (status quo, documented)
Keep `annotation` as-is (`risk`/`budget`/`owner`/`require_approval`) but **add the
precedence rule to SEP §Security** (`host consent UI > Adaptive MCP suggestion >
nothing`); never claim enforcement.
- ✅ Lowest effort; nothing in code changes beyond SEP text.
- ⚠️ Still redundant with core (Layer 1 unresolved) — "reinvents governance" stands,
  scoped as advisory.
- The precedence text is a **universal prerequisite** under every strategy.

### Strategy 4 — Server Card #1649 alignment (future-proof)
Move **static** governance metadata into the Server Card discovery surface (when #1649
lands); keep tools-metadata for learned/observed only. Dual-emit during the Draft
window so both early adopters and #1649-native clients get it.
- ✅ Most aligned with ecosystem direction; #1649 becomes canonical home for static
  governance shape.
- ❌ Blocked on #1649 (Draft) — ship a fallback, migrate later.
- ❌ Most work; doesn't by itself resolve Layer-2 call-time conflict.

### Recommended hybrid (CHOSEN, 2026-07-19 — implementing)
Combine the non-conflicting parts:
1. **Static risk → Strategy 2**: translate into `Tool.annotations`; drop static `risk`
   from the resource.
2. **Everything else → Strategy 1**: learned/observed + `owner` + `budget` overruns
   only, in the resource.
3. **Precedence rule → Strategy 3**: add to SEP §Security regardless.
4. **Coordinate → Strategy 4**: track #1649 as the static-alignment target; dual-emit
   when it lands.

This removes Layer-1 duplication, respects host authority (Layer 2), and points static
metadata at #1649 (Layer 3) — without waiting on #1649 to ship.

**Implementation status (2026-07-19):**
- [x] SEP §Security precedence text added (host UI > suggestion > nothing).
- [x] `riskToToolAnnotations` helper added in `@adaptivemcp/spec` (SDK-free, returns
      plain `ToolAnnotationsLike`).
- [x] `examples/src/server.ts` wires static risk → `Tool.annotations` (Strategy 2 demo).
- [x] `Annotation.risk` doc + `view.ts` clarified: static risk → `Tool.annotations`;
      resource `risk` is learned/observed only.
- [x] Typecheck passes for `spec` + `examples` (spec rebuilt so examples sees export).
- [ ] #1649 dual-emit — blocked on #1649 (Draft); tracked, not implemented.
- [x] `budget`/`require_approval` emitted by the reference impl (2026-09-29):
      `view.ts` projects them from routing/approval recommendations, and
      `examples/src/server.ts` seeds `owner`/`require_approval`/`budget` so the
      published resource carries policy. The precedence rule
      (host UI > suggestion > nothing) is now demonstrated by the first-party
      agent: it applies server policy as a **floor** and never overrides a
      human/learned value, while still prompting per host consent. See §14.

## 12. Next milestone: extensible middleware (updated 2026-07-21)

**Goal:** make the middleware layer pluggable so external integrations — **rtk**
(rtk-ai.app, CLI-output compression), **headroom** (headroom-docs, generic
content compression), and a later **client OAuth delegation** flow — can attach to
`AdaptiveRuntime` and/or `ThinClient` without forking the core packages.

**Integration model (decided, 2026-07-21): middleware chains MCP servers, not
binaries directly.** Research showed headroom already ships an MCP server
(`headroom mcp serve` → `headroom_compress` / `headroom_retrieve` /
`headroom_stats`) and a TS SDK `compress()`; rtk has **no** MCP server (it is a
CLI proxy / PreToolUse hook on shell commands — only an open interest issue #1442
exists). So:
- **headroom** is chained directly (it already exposes an MCP server).
- **rtk** is wrapped into an MCP server by a new `@adaptivemcp/mcp-binary` package,
  then chained like any other MCP-backed middleware. This keeps shelling out
  confined to the integration layer (the sanctioned shell-out boundary) and gives
  rtk a first-class place in the chain instead of being stuck at the host layer.

### 12a. Current state (why this is needed)

- `AdaptiveRuntime` (`packages/runtime/src/index.ts`) hard-wires 7 packages as
  fixed fields (telemetry, evaluation, extension, routing, orchestration,
  approval). No registration seam.
- `ThinClient` (`packages/thin-client/src/loop.ts`) hard-codes two hooks: the
  approval `gate` and a store-derived retry policy. `ToolHandler` returns only
  `{ ok, error? }` — **no `output`** is carried through the loop.
- `AdaptiveRuntime.observeCompleted` hardcodes `output: { ok: true }` and discards
  the real result (`packages/runtime/src/index.ts:80`).
- `ToolExecutionEvent.output` exists in `spec` but is never populated.
- `ToolMetadataView` (`packages/extension/src/view.ts`) is a fixed shape — no
  place for middleware contributions.
- The one clean boundary already extracted is the `Store` interface in `spec`;
  middleware must depend only on that, not on `MemoryStore`.
- **New (2026-07-21):** the integration seam is **MCP-chaining** — middleware
  depends on an injected MCP client (or a `Compressor` abstraction backed by one),
  never on a binary on PATH. Binaries are wrapped into MCP servers by
  `@adaptivemcp/mcp-binary`, the only package permitted to shell out.

### 12b. What rtk / headroom actually are (verified 2026-07-21)

| | rtk | headroom |
|---|---|---|
| Core job | Compresses **CLI command output** before the context window (Rust binary, ~89% on `cargo test`/`git`/`grep`) | Compresses **any content an agent reads** — tool outputs, JSON, DB results, file reads, RAG, API responses |
| Integration shape | **PreToolUse hook** in `settings.json` that rewrites Bash calls; `rtk gain` CLI. **No MCP server** (issue #1442 is "gauging interest" only) | TS/Python `compress()` function, transparent **proxy**, framework integrations, **and a native MCP server** (`headroom mcp serve` → `headroom_compress`/`headroom_retrieve`/`headroom_stats`) |
| MCP server? | **No** → wrapped by `@adaptivemcp/mcp-binary` | **Yes** (native) → chained directly |
| Fit with the loop | Weak/orthogonal as a binary — but once wrapped into MCP it becomes a `command-output` middleware for shell-like MCP tools | Strong — operates on **tool outputs**, exactly what the loop carries |

**Tension resolved:** the design constraint "packages must not depend on
shell/processes as first-class concepts" (`README.md`'s Design constraints
section) applies to the **learning core**. rtk is fundamentally a shell-layer tool, so it must not
shell out inside core. The fix is **not** to push rtk to the host layer (that
forfeits composability) nor to shell out in core — it is to **wrap rtk into an MCP
server** via `@adaptivemcp/mcp-binary` (the sanctioned shell-out layer) and then
chain it like headroom. Integration middleware is allowed to break the no-shell
rule — that is the point of isolating it in `@adaptivemcp/mcp-binary`.

**Two layers, not one (important for coexistence):** rtk's value comes from its
*PreToolUse hook* (`rtk init -g`), which rewrites an agent's Bash calls
(`git status` → `rtk git status`) **before** they execute — that is the agent's
**shell layer**. Our `rtk_exec` middleware is a **different layer**: it spawns
`rtk gain <cmd>` **after** a tool returns, compressing what the MCP result
carries back. The two compose rather than conflict, and Adaptive MCP never
installs, enables, or disables the rtk hook — it only reuses the rtk binary if
already present.

**Graceful coexistence when rtk is already installed:** `resolveRtkCommand()`
does read-only discovery on `PATH` (never installs a second copy), verifies the
binary is rtk-ai via `rtk --version` (guarding the unrelated Rust *Type Kit*
crate that also ships a `rtk` binary), and if missing/wrong reports
`missing`/`wrong-package` so the wrapper degrades to a clear setup message
instead of spawning a missing binary. Adaptive MCP is **not a nuisance** to other
MCPs: it chains via MCP and leaves the user's shell and other servers alone.

### 12c. Chosen design (decided)

- **Abstraction:** a `Middleware` **plugin interface** with optional lifecycle
  methods (`init`, `beforeCall`, `afterCall`, `onError`, `contributeView`).
- **New package `@adaptivemcp/middleware`** — depends only on `Store` from
  `spec`; holds the `Middleware` interface + a `MiddlewareChain` that
  `AdaptiveRuntime` and `ThinClient` both invoke. Does **not** force a refactor of
  the 7 fixed fields; it adds the registration seam. Existing `ApprovalGate`/
  `Router`/`Orchestrator` can be wrapped as middleware or kept as today.
- **`Compressor` abstraction (new):** transport-agnostic
  `compress(content, opts) → { compressed, hash, savings_percent }`. Its default
  implementation is **MCP-client backed** — it calls `headroom_compress` on an
  injected MCP client. A lighter alternative implementation calls the headroom-ai
  TS SDK `compress()` directly (no MCP server needed). Middleware depends on the
  `Compressor` interface, never on a binary.
- **New package `@adaptivemcp/mcp-binary` (NEW):** a generic **CLI-binary →
  MCP-server wrapper** (stdio). This is the *only* sanctioned shell-out layer. It
  maps a binary's CLI surface onto MCP tools (e.g. rtk → `rtk_exec(command)`), so
  binaries like rtk become chainable through the same `MiddlewareChain` seam.
  rtk is the reference binary (`RtkWrapper`).
- **Capabilities (selected):** observe/record events, intercept/gate calls,
  transform I/O, inject auth/credentials.
- **OAuth:** design the **hook point now**; specify the exact flow later.

```ts
export interface Middleware {
  name: string;
  init?(ctx: MiddlewareContext): void | Promise<void>;
  beforeCall?(call: PlannedCall, ctx: MiddlewareContext): void | Promise<void>; // gate / transform input / inject creds
  afterCall?(result: CallResult, call: PlannedCall, ctx: MiddlewareContext): void | Promise<void>; // transform output / observe
  onError?(err: unknown, call: PlannedCall, ctx: MiddlewareContext): void | Promise<void>;
  contributeView?(toolName: string, ctx: MiddlewareContext): unknown | void; // surface in YAML
}

/** Transport-agnostic compression seam. Impl is MCP-client backed (headroom_compress) or TS-SDK backed. */
export interface Compressor {
  compress(content: string, opts?: { model?: string; tokenBudget?: number }):
    Promise<{ compressed: string; hash?: string; savingsPercent?: number }>;
}
```

### 12d. Integration mapping

- **headroom** → `afterCall` **Transform I/O** middleware via `Compressor`: takes
  `result.output`, calls `compress()`, replaces `result.output` before telemetry
  records it / the model sees it. Recommended impl chains to the headroom MCP
  server (`headroom_compress`); the headroom-ai TS SDK `compress()` is a lighter
  non-MCP alternative. Surface `hash` + `savings_percent` via `contributeView`
  so the agent can later call `headroom_retrieve` for the original. Clean fit; no
  shell coupling in core.

  ```mermaid
  flowchart LR
    A[Tool call] --> B[ThinClient / AdaptiveRuntime]
    B --> C[MiddlewareChain.afterCall]
    C --> D[Compressor.compress -> headroom MCP headroom_compress]
    D --> E[compressed output recorded]
    E --> F[agent may call headroom_retrieve hash]
  ```

- **rtk** → wrapped into an MCP server by `@adaptivemcp/mcp-binary` (stdio), then
  chained as a `command-output` middleware (only for shell-like MCP tools, e.g. a
  `run_shell_command` tool). No shelling inside core — the shell-out lives in
  `mcp-binary`. If rtk later ships a native MCP server (issue #1442), the wrapper
  becomes redundant and rtk is chained directly like headroom.

  Note the two layers: rtk's *hook* rewrites Bash at the agent shell layer; our
  *wrapper* compresses MCP tool output at the middleware layer. They compose.

  ```mermaid
  flowchart TD
    subgraph Shell["Agent Bash layer (rtk's own hook, optional)"]
      H[rtk init -g hook rewrites git status -> rtk git status]
    end
    subgraph MCP["MCP tool-output layer (Adaptive MCP)"]
      R[rtk binary] --> W[@adaptivemcp/mcp-binary stdio wrapper]
      W --> T[rtk_exec MCP tool]
      T --> M[MiddlewareChain command-output middleware]
    end
    Shell -.compresses what agent sends to shell.-> Shell
    MCP -.compresses what tool result carries back.-> MCP
  ```

- **client OAuth delegation** → `beforeCall` **inject-auth** middleware: a
  `CredentialProvider` resolves a token per `serverName`/`toolName` and sets
  `call.credentials`. Hook point only for now.

### 12e. Open decisions + pros/cons (resolved 2026-07-21)

**D1 — Output plumbing scope** → **decided: A (full output).**
- *Option A: carry full `output` through the loop.* ✅ enables transform + richer
  telemetry; ❌ more memory per call, larger `ToolExecutionEvent`s.
- *Option B: carry only a compressed/summarized form.* ✅ cheap; ❌ loses fidelity
  for non-compression middleware, defeats the point of headroom/rtk.
- *Decision:* A, since the whole milestone exists to transform output.

**D2 — Middleware registration** → **decided: A (explicit `use()` API).**
- *Option A: explicit `runtime.use(mw)` / `thinClient.use(mw)` API.* ✅ simple,
  explicit, testable; ❌ caller must wire manually.
- *Option B: auto-discovery via a registry / package convention.* ✅ zero-config;
  ❌ magic, harder to reason about order/side effects, harder to disable.
- *Decision:* A, with an optional registry later.

**D3 — YAML contribution shape** → **decided: A (`middleware` map).**
- *Option A: single `middleware: { <name>: {...} }` map in `ToolMetadataView`.*
  ✅ open-ended, no `view.ts` forking per integration; ❌ consumers must know names.
- *Option B: typed top-level fields per middleware.* ✅ discoverable; ❌ `view.ts`
  changes for every new middleware, couples the view to integrations.
- *Decision:* A (map keyed by middleware name).

**D4 — rtk placement** → **decided: wrapped into MCP (not host-layer only).**
- *Option A: inside the MCP loop as output-transform (shell out in core).* ❌
  violates the no-shell rule inside core.
- *Option B: explicitly out-of-scope (host-layer only).* ❌ forfeits
  composability with headroom/oauth in one chain.
- *Option C (chosen): wrap rtk into an MCP server via `@adaptivemcp/mcp-binary`,
  then chain as a `command-output` middleware.* ✅ composable, shell-out confined
  to the sanctioned layer, no core coupling.

**D5 — Ordering / error semantics** → **decided: A (fixed order).**
- *Option A: fixed order (beforeCall in registration order, afterCall reverse).*
  ✅ predictable; ❌ can't reorder without re-registering.
- *Option B: priority field on each middleware.* ✅ flexible; ❌ more API surface.
- *Decision:* A for v1, add priority later if needed.

**D6 — Backward compatibility** → **decided: A (built-ins kept alongside).**
- *Option A: keep `ApprovalGate`/retry as built-in, add middleware seam alongside.*
  ✅ no breaking change to `AdaptiveRuntime`/`ThinClient` consumers; ❌ two paths
  (built-in + middleware) to maintain.
- *Option B: refactor built-ins into middleware.* ✅ one model; ❌ breaking change
  for current consumers of `runtime.gate()` / `thinClient.run()`.
- *Decision:* A for the milestone; B is a later cleanup (post-1.0).

**D7 — Compressor transport** → **decided: MCP-chaining recommended.**
- *Option A: MCP-client backed (call `headroom_compress` on an injected MCP
  client).* ✅ uniform "middleware chains MCP" model; reuses headroom's CCR
  `headroom_retrieve`; works for any compressor that exposes an MCP server.
- *Option B: headroom-ai TS SDK `compress()` directly.* ✅ lighter (no MCP server
  process); ❌ couples to one vendor's SDK, no CCR tool surface.
- *Decision:* A (MCP-chaining) as the default; B allowed as a lighter alternative
  impl of the same `Compressor` interface.

**D8 — CCR hash surfacing** → **decided: surface in YAML `middleware` map.**
- *Decision:* `contributeView` returns `{ hash, savings_percent }` for compressed
  tools so the agent can call `headroom_retrieve(hash)` to fetch originals. The
  `middleware` map in `ToolMetadataView` carries it.

**D9 — Availability / fallback** → **decided: passthrough on failure.**
- *Decision:* if `compress()` throws or the compressor MCP is down, the middleware
  passes the **original** output through and records a `contributeView` note. The
  execution loop is never broken by compression. (Mirrors headroom's own
  `fallback: true`.)

**D10 — mcp-binary wrapper contract** → **decided: generic CLI→MCP wrapper.**
- *Decision:* `@adaptivemcp/mcp-binary` is a generic stdio wrapper mapping a
  binary's CLI onto MCP tools; rtk is the reference binary (`RtkWrapper`).
  Shelling out is confined to this package only. In-scope binaries: CLI tools
  whose output benefits from in-loop transformation (rtk first; others later).

### 12f. Code gaps to close (prerequisites)

1. Carry `output` through `ToolHandler` → `ThinClient.run` → `record` →
   `observeCompleted` → `ToolExecutionEvent.output` (D1).
2. Populate `ToolExecutionEvent.output` in `observeCompleted` (stop hardcoding
   `{ ok: true }`).
3. Add a `middleware` map to `ToolMetadataView` + `toToolMetadataView` so
   `contributeView` results surface in `tools-metadata.yaml` (D3/D8).
4. `MiddlewareChain` invokes `beforeCall`/`afterCall`/`onError` around execution
   in both `AdaptiveRuntime` and `ThinClient` (D2/D5).
5. Add the `Compressor` abstraction + `HeadroomMiddleware` (MCP-client backed,
   TS-SDK alt) (D7).
6. Add `@adaptivemcp/mcp-binary` package + `RtkWrapper` reference; wire rtk as a
   `command-output` middleware (D4/D10).

**Status:** `done`. **Note (2026-07-30):** this section's status line was stale
— all six gaps (D1–D6) are implemented and tested: `ToolHandler`/`ThinClient`/
`observeCompleted`/`ToolExecutionEvent.output` carry output end to end; the
YAML `middleware` map exists on `ToolMetadataView`; `MiddlewareChain` runs in
both `AdaptiveRuntime` and `ThinClient`; `Compressor`/`HeadroomMiddleware` ship
in `@adaptivemcp/middleware`; `@adaptivemcp/mcp-binary` + `createRtkWrapper`
ship as the reference binary wrapper. See `docs/ROADMAP.md`'s package table,
which already reflects this correctly. The **client OAuth delegation** flow
(§12c/§12d, previously "hook point only for now") has also since moved past a
hook point into a real `OAuthMiddleware` implementation (authorize/callback/
refresh) in `packages/thin-client/src/oauth-middleware.ts` — see
`docs/ROADMAP.md` Phase 6h, which needs the same correction.

## 13. Decoding Policy (Phase 8) — design conversation (2026-07-28)

**Goal:** generalize `SamplingAdvisor`'s "failure rate → raw sampling numbers"
heuristic into an intent-aware, backend-agnostic decoding policy: an advisor
emits a symbolic profile, a separate resolver translates that profile into
whatever knobs a specific backend actually exposes. Full item breakdown lives
in `docs/ROADMAP.md` Phase 8 (8a-8f); this section is the doubts/decisions
record for how that phase's shape was chosen, mirroring §12e's format.

### 13a. Current state (why this is needed)

- `SamplingAdvisor` (`packages/routing/src/sampling-advisor.ts`, shipped
  2026-07-28) computes `SamplingRecommendationPayload` (`temperature`/`topP`)
  directly from `ToolStats.failureRate` — no notion of backend capabilities,
  no notion of caller intent, numbers hardcoded per threshold tier.
- `ThinClient` never makes an LLM call itself (confirmed while scoping this —
  no LLM SDK anywhere in this repo), so delivery is necessarily advisory: a
  host that owns both `ThinClient` and its own completion call reads
  `onSamplingRecommendation`'s payload and applies it, or doesn't.
- The raw-numbers shape doesn't generalize: a request for "be more
  deterministic" means different concrete knobs on different backends
  (`top_p` on one, `min_p` on another, neither on a third). Baking specific
  numbers into the advisor couples a backend-agnostic signal (observed
  reliability) to backend-specific mechanics.

### 13b. Chosen design

Two-stage split, both stages backend-agnostic *except* the resolver, which is
where all backend-specific knowledge concentrates:

```ts
interface DecodingProfile {
  id: "deterministic" | "balanced" | "creative";
}

interface ModelCapabilities {
  supports: {
    temperature?: boolean;
    topP?: boolean;
    topK?: boolean;
    minP?: boolean;
    presencePenalty?: boolean;
    repetitionPenalty?: boolean;
    frequencyPenalty?: boolean;
  };
}

interface DecodingResolver {
  resolve(profile: DecodingProfile, capabilities: ModelCapabilities): ResolvedDecodingSettings;
}

interface DecodingRecommendation {
  profile: DecodingProfile;
  resolved: SamplingRecommendationPayload; // @deprecated type, reused as the leaf shape — see D5
  resolverVersion: string;
  confidence: number;
  reasons: string[];
}
```

`DecodingAdvisor` (renamed from `SamplingAdvisor`) owns profile *selection*
(intent baseline + telemetry adjustment); `DecodingResolver` owns profile
*translation* (static tables, no telemetry access, no learning). See D1/D2/D4
below for why they're split this way and D6 for `confidence`/`reasons`.

### 13c. Open decisions + pros/cons (2026-07-28)

**D1 — Symbolic profile vs. raw params emitted directly** → **decided: symbolic
profile + separate resolver.**
- *Option A: advisor emits raw params directly (today's v0 `SamplingAdvisor`).*
  ✅ one hop, simplest to ship (already shipped); ❌ backend-specific knowledge
  leaks into the telemetry/intent layer — doesn't generalize once a second
  backend with different sampler knobs (e.g. `min_p` instead of `top_p`) shows
  up.
- *Option B (chosen): advisor emits `DecodingProfile`; `DecodingResolver`
  translates `(profile, capabilities) → ResolvedDecodingSettings`.* ✅ advisor
  stays backend-agnostic, translation is isolated, swappable, and table-driven;
  ❌ two hops instead of one, more moving pieces for a v1.

**D2 — Where telemetry plugs into the pipeline** → **decided: telemetry
adjusts the intent-supplied baseline, it doesn't replace or get replaced by
it.**
- *Option A: intent alone determines the profile; telemetry is reporting-only
  (see 13c D8's analyzer).* ❌ loses the exact failure-rate-driven adjustment
  that motivated `SamplingAdvisor` in the first place — regresses behavior
  that already shipped.
- *Option B (chosen): observed per-tool failure rate can pull the *effective*
  profile toward `deterministic` regardless of the caller-supplied intent
  baseline.* ✅ preserves the original value prop, composes rather than
  discards a working signal; ❌ needs an explicit composition rule (baseline +
  override, not just "vote") — left as an `DecodingAdvisor` implementation
  detail, not further specified here.

**D3 — Automatic intent classification vs. explicit caller-supplied hint** →
**decided: explicit hint only, no classifier.**
- *Option A: classify intent automatically from free text.* ❌ would be the
  first ML/statistics dependency anywhere in this codebase (Phase 7 explicitly
  notes "this codebase has no ML/statistics dependencies anywhere") — adds an
  unvalidated new failure mode (misclassification) with nothing yet in place
  to catch it.
- *Option B (chosen): intent is a caller-supplied hint/parameter (e.g. host
  passes `"architecture review"` → `balanced` explicitly).* ✅ zero new
  dependencies, deterministic, trivially testable; ❌ pushes a small UX burden
  onto the caller to supply intent, rather than inferring it for free.

**D4 — Does the resolver learn, or stay static?** → **decided: resolver never
learns; telemetry only ever feeds profile *selection* (the advisor), never
profile *translation* (the resolver).**
- *Option A: let the resolver's own per-backend tables adapt from observed
  telemetry (e.g. auto-tune what "balanced" maps to on llama.cpp).* ❌
  conflates two different kinds of correctness — deterministic backend-
  capability facts vs. probabilistic behavior evidence — and makes resolver
  output non-reproducible without extra bookkeeping.
- *Option B (chosen): resolver stays pure/static/table-driven and versioned
  (`resolverVersion`); all learning happens one layer up, in *which* profile
  gets selected, never in *how* a profile resolves to numbers.* ✅ resolver
  stays trivially testable and outputs are reproducible given a version; ❌ a
  wrong per-backend mapping requires a manual table edit + version bump, not
  an automatic correction.

**D5 — Migrate vs. deprecate `SamplingRecommendationPayload`** → **decided:
deprecate, don't migrate.**
- *Option A: rename/replace the type in place (breaking change).* ❌ it's
  already a shipped public shape (2026-07-28) — breaking any external
  middleware written against it for comparatively little gain, since the
  shape itself doesn't need to change, just its role.
- *Option B (chosen): keep `SamplingRecommendationPayload` exported and
  working, mark it `@deprecated`, nest it as `DecodingRecommendation.resolved`;
  remove only at the next `SPEC_VERSION` major bump.* ✅ gentler migration,
  consistent with treating a shipped type as a real public API; ❌ carries a
  legacy type + a `"sampling"` `RecommendationType` member alongside the new
  `"decoding"` one for at least one release (see ROADMAP 8c).

**D6 — Binary apply/ignore vs. confidence-gated override** → **decided: add
`confidence` + `reasons[]`, host owns the threshold policy.**
- *Option A: `DecodingRecommendation` is binary — a host either applies it
  wholesale or ignores it, no granularity.* ❌ no way to express "trust this
  only when the evidence is strong," which is exactly the kind of surprise-
  avoidance this feature exists to provide (advisory, never enforced — same
  precedent as `Router`'s model recommendations).
- *Option B (chosen): `confidence: number` + `reasons: string[]` on
  `DecodingRecommendation`, so a host can pick its own threshold (e.g. only
  auto-apply above 0.9).* ✅ predictable, host-controlled; ❌ does not itself
  define a *default* threshold — left to the host, an explicit non-decision.

**D7 — Generalize into `ExecutionPolicy` now, or defer?** → **decided:
defer, not scheduled.**
- *Option A: build a unifying `ExecutionPolicy` (`ContextProfile`,
  `ToolSelectionProfile`, `RetryProfile`, `TimeoutProfile`, `MemoryProfile`,
  `CostProfile`) alongside `DecodingProfile` now.* ❌ premature — most of
  those already exist as independent, working mechanisms (`RetryPolicy`/
  `Orchestrator` off failure rate, `BudgetPolicy`/`Router` off cost) with no
  shared-abstraction pain today; there would be exactly one real instance
  (Decoding) to generalize a shape from.
- *Option B (chosen): defer `ExecutionPolicy`; revisit only once a second
  real profile type is actually being built.* ✅ avoids overfitting a shared
  shape to a single example; ❌ if unification ever happens, it costs a
  refactor across Decoding + whatever ships second, rather than being
  designed in from the start.

**D8 — Where the decoding analyzer lives / how it's triggered** → **decided:
pure computed-on-read report, not a persisted `Recommendation`, deferred
until 8d telemetry has accumulated.**
- *Option A: persist the analyzer's suggestion as a `Recommendation` (like
  `DecodingAdvisor`/`Router` do), so it's automatically visible in
  `tools-metadata.yaml`.* ❌ conflates a one-off diagnostic report — grouped
  by (tool, profile, model), not just by tool — with the existing per-tool
  recommendation model; would need a `Recommendation` schema change to carry
  a composite key it wasn't designed for.
- *Option B (chosen): pure, computed-on-read function/class mirroring
  `GraphAnalyzer`, invoked explicitly by whoever wants the report, not stored.*
  ✅ no schema strain, matches an existing precedent exactly; ❌ not
  ambiently surfaced anywhere the way advisor recommendations are — must be
  explicitly queried.

### 13d. Code gaps to close (prerequisites, maps 1:1 to ROADMAP Phase 8)

1. [x] Rename `SamplingAdvisor` → `DecodingAdvisor`; change its output from raw
   `SamplingRecommendationPayload` to `DecodingProfile` (ROADMAP 8a). Landed
   as a same-day addition alongside `SamplingAdvisor` (kept, deprecated) —
   `packages/routing/src/decoding-advisor.ts`.
2. [x] New `ModelCapabilities` type + `DecodingResolver.resolve()` with at least
   two backend tables from the start (ROADMAP 8b). Shipped with three
   (`OPENAI_CAPABILITIES`/`LLAMA_CPP_CAPABILITIES`/`VLLM_CAPABILITIES`) —
   `packages/routing/src/decoding-resolver.ts`.
3. [x] New `DecodingRecommendation` wrapper type; `@deprecated` tag on
   `SamplingRecommendationPayload` (ROADMAP 8c). One correction found during
   implementation: `resolved` uses a new `ResolvedDecodingSettings` type, not
   `SamplingRecommendationPayload` as sketched in 13b's snippet above — the
   deprecated type lacks `minP`/`frequencyPenalty`, which the resolver needs
   for non-OpenAI-style backends. `ResolvedDecodingSettings` is a strict
   superset (same field names), so this doesn't change D5's reasoning, just
   the exact type used.
4. [x] Structured `reasons[]` trace through the advisor → resolver hand-off
   (ROADMAP 8f). Shipped as the `reasons: string[]` array only (no separate
   `trace` object) — `toDecodingRecommendation()` in
   `packages/routing/src/decoding-resolver.ts` composes it from
   `Recommendation.rationale.split("; ")`.
5. [x] Optional `decoding` field on `ToolExecutionEvent`, recording *resolved*
   values + `resolverVersion` so past decisions stay reproducible after
   resolver tables change (ROADMAP 8d). **Done 2026-09-29** — plus `usage`
   (tokens); `AdaptiveRuntime.observeCompleted` forwards both, and the agent
   records the decoding it applies.
6. [x] Decoding analyzer as a new, pure, computed-on-read pass (ROADMAP 8e).
   **Done 2026-09-29** — `DecodingAnalyzer` in `@adaptivemcp/routing`; the agent
   surfaces it as `/decoding-report`.

**Status:** `decided` for D1-D8; **1-4 done (2026-07-28)**, 5-6 `open` / planned
— blocked on #4 first accumulating real usage, same shape as §6's stabilization
gate. Not wired into `ThinClient`/`tools-metadata.yaml` yet — 8a-8c/8f shipped
as standalone types + computation classes only (`@adaptivemcp/routing`),
consistent with how the ROADMAP items themselves are scoped. Tests:
`packages/routing/src/decoding-advisor.test.ts`,
`decoding-resolver.test.ts`. Demo: `examples/src/scenarios/decoding-policy.ts`
(`pnpm --filter @adaptivemcp/examples scenario:decoding-policy`).
**Update (2026-09-29):** decoding is now wired into a real host — the agent's
`decodingProvider` resolves a profile per model step, applies the knobs, and
emits a `decoding_applied` event. **#5/#6 done 2026-09-29:** the applied decoding
is recorded on `ToolExecutionEvent` (`ToolDecoding` + `usage`), and
`DecodingAnalyzer` (in `@adaptivemcp/routing`) reports per-`(tool, profile,
model, resolverVersion)` failure/latency/token stats with a suggested profile.

## 14. First-party agent host (2026-09-29)

`adaptivemcp/agent` (sibling repo) is a real MCP-native host that owns both the
LLM completion and the tool execution. It is the consumer the two-store model
and every advisory recommendation were designed for. What it exercises today:

- **Decoding:** `DecodingAdvisor` → `DecodingResolver` → `ChatParams` per model
  step (`decodingProvider`), emitting `decoding_applied`. Host owns the intent
  baseline only insofar as it passes one; no classifier (consistent with §13c D3).
- **Model routing:** `Router` per-tool `model` recommendations → catalog model
  selection per step (`modelProvider`); `--router-min-invocations` exposes the
  confidence gate (§13c D6's "host owns the threshold").
- **Approvals:** the gate's `require_confirmation` prompts a human in the REPL
  with the learned reason; static risk comes from core `Tool.annotations`.
- **Server governance:** reads `dev.adaptivemcp/tools-metadata` and applies
  `owner`/risk/`require_approval`/budget as a **floor** (never overriding host or
  learned values) — the §10/§11 precedence rule in code.
- **Cost/compression/reporting/guardrails:** token cost recorded per call;
  `HeadroomMiddleware` compression with hash retrieval; `report_observation`
  reporting; execution-graph cascades/anomalies injected as steering messages;
  per-turn execution DAGs.

**Still open (now with a real consumer to motivate them):**

- §13d #5/#6 — **done 2026-09-29** (applied decoding recorded on
  `ToolExecutionEvent` + `DecodingAnalyzer`, surfaced as `/decoding-report`).
- §6 — upstream SDK PR for SEP-2133 graduation (unchanged; process-bound).
- §1b/§10 — precedence wording in the SEP (host UI > suggestion > nothing):
  **done 2026-09-29** — stated in SEP §Security and demonstrated by the agent.
- §1c — `AdaptiveRuntime` naming/boundary: the agent reinforces the two-store
  reading (it owns the learning Store client-side; the example server serves the
  extension resource), which supports option (2) rename-long-term over (1) split.

## 15. Metadata without an events table (2026-09-29)

**Decision (B): pre-aggregate into bounded dimensional metric cells; do not
store raw events.** The product *is* the folded metadata, so the store now keeps
a `metric_cells` rollup (migration 3): each `recordExecution` folds the event
into cells keyed by `(tool, server, {model?, decodingProfile?, resolverVersion?},
window)` holding counters, error-code counts, a fixed-bucket duration histogram,
token/cost sums, EWMA recency, first/last seen, and a bounded exemplar ring.
`DecodingAnalyzer.analyzeCells()` (and future analyzers) read cells; the
per-call `execution_nodes` table remains the bounded, TTL-pruned drill-down layer.

**Rationale:** an events table is a lossy convenience — we only ever run a few
queries against it (per-tool failure rate, per-`(tool,model)` latency,
per-profile effectiveness, cost/trends). Materializing those into bounded cells
keeps the store rich *and* bounded, with no unbounded event log.

**Trade-off:** schema-on-write — a question with no dimension/measure cannot be
answered retroactively. Mitigations: open-ended `dimensions` JSON (new dims need
no migration), an always-present `all` cell, EWMA for recency, and the bounded
node layer for forensics.

**Follow-ups:** time-bucket windows for drift — **done 2026-09-29** (hourly cells
for the overall tuple, pruned by retention); retry accounting — **done
2026-09-29** (`ThinClient.run` returns `attempts`, folded and surfaced as
`retry_rate`); metrics projected into the view — **done** (`ToolMetadataView.metrics`,
a per-tool window/dimension map). Still open: cardinality caps (top-K models +
`other`), and `metricCells()` support for non-`MemoryStore` backends.

## 5. Raw notes (kept from earlier)

- Q: is yaml even good for model
- Q: the packages are too tightly coupled, what can we do?
