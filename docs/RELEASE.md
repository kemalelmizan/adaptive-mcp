# Release runbook: publishing `@adaptivemcp/*` to npm

This is the canonical, self-contained guide for cutting a release by hand. It
covers **when to commit, when to push, what to watch out for, and how npm vs
GitHub versioning work** so you can run a release end-to-end without the agent.

The release is driven by three steps across two scripts. There is **no manual
`npm publish`**, and **the release script does NOT build** — building is a
separate, slow step that does not need the npm 2FA OTP, so it is kept out of
the publish path:

| Step | Command | What it does |
| --- | --- | --- |
| Build (separate) | `pnpm build:publishable` | Compile `dist/` for every publishable package. No OTP needed. Run this BEFORE releasing. |
| Release | `scripts/release.ts` | Version (Changesets) → `npm publish` **every publishable package whose version isn't on the registry yet** (the changed set, including cascaded dependents). |
| Record | `scripts/version-release.ts` | After publish: commit the version bump, create an annotated `vX.Y.Z` tag, push `--follow-tags`. |

Publishable set (defined once in `scripts/lib/workspace.ts` →
`PUBLISHABLE_PACKAGES`): `spec · memory · telemetry · evaluation · extension ·
runtime · routing · orchestration · approval · thin-client · middleware ·
mcp-binary`. `examples` and `apps` stay private.

> **Changed-version publishing.** `release.ts` publishes every publishable
> package whose `package.json` version is not yet on the registry — which is
> exactly the set that `changeset version` changed: the packages named in
> changesets, their internal dependents cascaded by Changesets
> (`.changeset/config.json` sets `updateInternalDependencies: "patch"`), and any
> package being published for the first time (e.g. `middleware`, `mcp-binary`).
> Packages already on npm at their current version are skipped, so the publish
> set stays minimal and re-runs resume safely. `--packages a,b` narrows the set;
> `--no-version` skips the version step and considers all publishable packages.

---

## Mental model: npm versioning vs GitHub versioning

These are **two independent systems**. A release touches both, but they do not
know about each other.

### npm (the registry)

- Every `npm publish` creates one **immutable** version. You can **never**
  overwrite or delete a published version (you can `deprecate` it).
- Versions follow **semver** (`MAJOR.MINOR.PATCH`). The version comes from each
  package's `package.json`, bumped by Changesets.
- npm tracks a **`latest` dist-tag** that points at the newest published
  version. `npm install @adaptivemcp/extension` and the shields.io badges both
  resolve `latest`. You can have other tags (`next`, `beta`) but we only use
  `latest`.
- Because versions are immutable, a **partially failed publish is safe to
  resume**: `release.ts` checks the registry and **skips any package whose
  version is already published**, so re-running after a mid-publish failure
  (e.g. an expired OTP) only publishes the packages that didn't make it.

### GitHub (the repo)

- A release is recorded as an **annotated git tag** `vX.Y.Z` (note the `v`
  prefix. npm has no prefix, GitHub does). The tag is independent of npm; it
  just marks the commit where the version bump landed.
- `git push --follow-tags` pushes the commit **and** the tag together.
- The base branch is `main`. Changesets' `baseBranch` is `main`.

**Key takeaway:** npm owns *what users install*; GitHub tags own *what the
source looked like at that version*. Keep them in sync by tagging the exact
commit that contains the version bump.

---

## Prerequisites

- **Node 22+** (Node 26 recommended; the built-in `node:sqlite` needs it; `node script.ts` uses native
  type stripping). Use `eval "$(fnm env)" && fnm use 26`.
- **pnpm 11+** (pinned via the repo `packageManager` field; don't use a
  different pnpm).
- An npm account in the **`@adaptivemcp`** org with publish rights
  (`https://www.npmjs.com/org/adaptivemcp`).
- `NPM_TOKEN` in the environment (we keep it in `.env` and `source .env`;
  `.env` is gitignored). `npm publish` reads it automatically.
- A **clean working tree** (`git status --porcelain` empty). The scripts refuse
  to run otherwise.

---

## The two flows

### Flow A: one-shot (recommended), `build` then `release.ts --tag`

Build first (no OTP), then version bump + publish + commit + tag + push in one
command:

```bash
eval "$(fnm env)" && fnm use 26
source .env
pnpm build:publishable                 # SEPARATE build step (no OTP)
node scripts/release.ts --tag --otp <CODE>
```

Use this when you've already reviewed the dry run and just want it done. The
`--tag` flag hands off to `version-release.ts` at the end, which commits the
bump and pushes the tag.

### Flow B: split (verify before committing), `build` then `release.ts` then `version-release.ts`

Build + publish first, **inspect npm**, then record the release separately:

```bash
pnpm build:publishable                 # SEPARATE build step (no OTP)
node scripts/release.ts --otp <CODE>     # version + publish only (changed packages)
# …verify packages are live on npmjs.com/org/adaptivemcp…
node scripts/version-release.ts          # commit bump + tag + push
```

`release.ts` (without `--tag`) deliberately does **not** touch git. This is the
safer path if you want to confirm the publish succeeded before creating history.

> Either flow is fine. Flow A is what we used for v0.2.1.

---

## Step-by-step

### 0. Pre-flight (clean tree + green checks)

```bash
git status --porcelain        # must be empty
node scripts/maintenance.ts check   # build + lint + test gate
```

Fix anything before proceeding. A dirty tree aborts the script immediately.

### 1. Author a Changeset (only when there's something to ship)

```bash
pnpm changeset                # select affected @adaptivemcp/* pkgs + semver bump
git add .changeset && git commit -m "chore: changeset for <scope>"
```

The changeset is **consumed** by `release.ts` (it runs `changeset version`,
which deletes the changeset file and bumps `package.json` + `CHANGELOG.md`).
**Do not** run `changeset version` yourself; let the script own that step.

If you have no pending changeset, the script just republishes current versions
(use `--no-version` to skip the version step entirely).

### 2. Dry run (true preview, no tree mutation)

```bash
node scripts/release.ts --dry-run
```

Runs `changeset status` to **preview** the pending changesets: which packages
would bump and to what version. It does **not** build, does **not** consume the
changeset, does **not** bump `package.json` / `CHANGELOG.md`, and does **not**
publish. The working tree is left exactly as it was, so you can re-run the real
release immediately afterward with no cleanup:

```bash
pnpm build:publishable                 # build dist/ (separate, no OTP)
node scripts/release.ts --tag --otp <CODE>
```

Use the dry run to sanity-check the version bumps before committing to a publish.
Remember to build separately before the real release — the dry run does NOT build.

### 3. Build (separate step, no OTP) then Publish (+ optionally tag)

```bash
# Build FIRST — slow, but needs no OTP. Run from the repo root.
pnpm build:publishable

# Flow A (one-shot):
node scripts/release.ts --tag --otp <CODE>

# or Flow B (publish now, tag later):
node scripts/release.ts --otp <CODE>
node scripts/version-release.ts
```

What `release.ts` does, in order:

1. Refuses if the tree is dirty — unless `--continue`, which allows a tree that
   holds only the version bump from an interrupted run.
2. Requires at least one pending changeset (skipped with `--no-version` /
   `--continue` / `--packages`). The publish set is **every publishable package
   whose current version is not yet on the registry** — the changed packages,
   their cascaded internal dependents, and first-time publishes. `--packages`
   narrows it to the named packages only.
3. Applies pending changesets (`pnpm changeset version`), unless `--no-version`
   / `--continue` / `--packages` is given.
4. `npm publish --access public --ignore-scripts` each unpublished package, in
   **dependency waves**: packages are topologically sorted by their internal
   `@adaptivemcp/*` dependencies and each wave is published **in parallel**
   (dependencies always first). This keeps the OTP window short while ensuring a
   dependent's `latest` never references a dependency version not yet on npm.
   Already-published versions are skipped (resume-safe). If any package fails,
   the run waits for the rest, prints a per-package result + `failed: […]`, and
   exits non-zero **without tagging**.

The build is **not** part of this script — `dist/` must already exist from the
separate `pnpm build:publishable` step above. This keeps the publish path short
and the 2FA OTP fresh for the `npm publish` calls.

`--ignore-scripts` keeps the publish hermetic (no lifecycle scripts run inside
the published tarball).

### 4. Verify on npm

```bash
npm view @adaptivemcp/extension version        # should show the new version
npm view @adaptivemcp/extension dist-tags       # latest should point at it
```

Open `https://www.npmjs.com/org/adaptivemcp` and confirm each published package
shows the new version **and** renders its `README.md` (the `files` allowlist in
each published `package.json` includes `README.md`, so the npm page is not
blank).

### 5. Confirm the git tag + push

```bash
git tag -l 'v*'          # vX.Y.Z should exist
git log --oneline -1     # the bump commit is pushed
git ls-remote --tags origin | grep vX.Y.Z   # tag is on the remote
```

With Flow A / `version-release.ts`, the commit and tag are already pushed via
`git push --follow-tags`.

---

## When to commit, when to push

| Moment | Commit? | Push? | Who does it |
| --- | --- | --- | --- |
| Authoring a changeset | ✅ yes | ✅ yes (normal PR flow) | you |
| Version bump (`package.json`/`CHANGELOG.md`) | ✅ yes | ✅ yes | `release.ts --tag` → `version-release.ts` (or you, manually) |
| The `vX.Y.Z` tag | n/a (tag, not commit) | ✅ yes | `version-release.ts` via `git push --follow-tags` |
| The npm publish | ❌ no (registry, not git) | ❌ no | `npm publish` |

**Rule of thumb:** commit the changeset as part of normal development. The
*version-bump commit* and the *tag* are created by the release tooling at publish
time and pushed together. **Never push the version bump before the publish
succeeds**. Otherwise GitHub would show a tag for a version that doesn't exist
on npm.

---

## What to watch out for

### 1. 2FA / one-time password (the big one)

If your npm account has **2FA enabled for publishing** (it is, for
`@adaptivemcp`), `npm publish` requires a **one-time password (EOTP)**. The
non-interactive script cannot prompt for it, so you must pass it explicitly:

```bash
node scripts/release.ts --tag --otp 123456      # flag
NPM_OTP=123456 node scripts/release.ts --tag     # env var
```

- The OTP is **single-use and time-limited**. Get it from your authenticator app
  or the npm auth URL printed by npm, then run the command promptly.
- Publishing runs **in parallel within dependency waves**, so one OTP covers
  several packages at once instead of one-at-a-time. If the OTP still expires
  **mid-run**, the script waits for every in-flight publish, prints exactly
  which packages failed, and exits non-zero **without tagging**. Resume with a
  fresh code:

  ```bash
  node scripts/release.ts --continue --otp <NEW_CODE>
  ```

  `--continue` skips the changeset/version step (already applied), accepts a tree
  that holds only the version bump, and republishes just the packages still
  missing from npm. Packages already on the registry stay published.
- Alternative to OTP: use an npm **automation/CI token** (bypasses 2FA) in
  `.env` as `NPM_TOKEN`. Note npm is deprecating 2FA-bypass tokens (announced
  for 2027), so OTP is the durable path.

### 2. Dirty tree after an interrupted run

`release.ts` refuses to start on a dirty tree. But if a previous run consumed
the changeset (bumped versions) and then failed at publish, the tree is left
**dirty with the version bump**. You must commit that bump first:

```bash
git add -A && git commit -m "release: @adaptivemcp/* vX.Y.Z (pre-publish)"
```

Now the tree is clean and `release.ts` will run. Because the changeset is already
consumed, `changeset version` is a no-op and the script just publishes the
already-bumped versions (after you re-run `pnpm build:publishable` to refresh
their `dist/`). (This is exactly what happened at v0.2.1: the first publish hit
2FA, we committed the bump, then re-ran with `--otp`.)

### 3. Changeset is consumed, not preserved

`pnpm changeset version` **deletes** the changeset markdown file. If the run is
interrupted after that step, the bump is applied but uncommitted (see #2). There
is no "undo". Just commit and continue.

### 4. Build is a separate step (before the release)

The release script does **not** build. `dist/` is gitignored and produced by the
separate `pnpm build:publishable` step, which needs no OTP. Run it before
`release.ts`. Because it's decoupled from the OTP, you can build early (even
hours before) and the publish path stays short and OTP-fresh. Don't move the
build back into `release.ts` — it only burns OTP time before the publish.

### 5. README must ship in the tarball

npm shows "This package does not have a README" if `README.md` isn't in the
`files` allowlist. All 12 publishable packages include `"README.md"` alongside
`"dist"` in `files`. If you add a package to `PUBLISHABLE_PACKAGES`, copy that
allowlist — and make sure the package actually has a `README.md` file, not
just the allowlist entry (both parts have drifted independently before).

### 6. Dependency order matters

Publish order is `spec → memory → telemetry → evaluation → extension → runtime
→ routing → orchestration → approval → thin-client → middleware →
mcp-binary`. Don't reorder or publish by hand. A package can't depend on a
version that isn't published yet. (Only the packages named in the changeset
are published, but they still go out in this order.)

### 7. Never publish by hand

Ad-hoc `npm publish` skips the version bump, the clean-tree guard, and the
ordering. Always go through `release.ts`.

### 8. Manual targeted publish (`--packages`)

Sometimes you want to publish **only one or two packages** without a changeset
and without bumping or republishing everything. The `--packages` flag takes a
comma-separated list (bare name or `@adaptivemcp/...`) and publishes **only
those**, using their current `package.json` versions. It skips the changeset
version step, so the named packages must already have their desired version
bumped (e.g. by a prior `changeset version`, or a manual edit).

```bash
# Publish ONLY extension + runtime (their current versions), nothing else:
node scripts/release.ts --packages extension,runtime --otp <CODE>

# Fully-qualified names also work:
node scripts/release.ts --packages @adaptivemcp/extension --otp <CODE>

# Combine with --tag to also commit + push the bump for just those packages:
node scripts/release.ts --packages extension --tag --otp <CODE>
```

Notes:
- Unknown package names are rejected up front with a list of valid packages.
- Already-published versions are skipped (resume-safe), so re-running after an
  expired OTP only publishes what's left.
- `--packages` is independent of `--no-version`: `--no-version` publishes *all*
  publishable packages, while `--packages` publishes *only* the named ones.
  Don't use both.
- Because it skips `changeset version`, there is no version bump — only publish.
  Use this for re-releasing a specific package whose `dist/` you've rebuilt, or
  for finishing a release that died after the bump was committed.

---

## Quick reference

```bash
# Pre-flight
git status --porcelain
node scripts/maintenance.ts check

# Changeset (if shipping a change)
pnpm changeset && git add .changeset && git commit -m "chore: changeset"

# Dry run (no build, no publish)
node scripts/release.ts --dry-run

# Build SEPARATELY (no OTP)
pnpm build:publishable

# Release (one-shot, with 2FA OTP)
node scripts/release.ts --tag --otp <CODE>

# …or split…
node scripts/release.ts --otp <CODE>
node scripts/version-release.ts

# Resume after a partial failure (fresh OTP); add --tag once all are live:
node scripts/release.ts --continue --otp <NEW_CODE>

# Verify
npm view @adaptivemcp/extension version
npm view @adaptivemcp/extension dist-tags
git tag -l 'v*'

# If a run died after consuming the changeset:
git add -A && git commit -m "release: @adaptivemcp/* vX.Y.Z (pre-publish)"
node scripts/release.ts --tag --otp <CODE>   # re-run; already-published pkgs skip

# Manual targeted publish (only the named packages, current versions):
node scripts/release.ts --packages extension,runtime --otp <CODE>
```

## Flags

| Flag | Script | Effect |
| --- | --- | --- |
| `--dry-run` | `release.ts` | `changeset status` preview only; no build, no version bump, no publish, tree unchanged. |
| `--no-version` | `release.ts` | Skip `changeset version`; publish ALL publishable packages as-is (republish). |
| `--continue` | `release.ts` | Resume a partially-failed release: skip `changeset version`, allow a tree holding only the version bump, publish every still-unpublished package. Combine with `--otp <NEW>` (and optionally `--tag`). |
| `--packages a,b` | `release.ts` | Manual override: publish ONLY the named packages (bare `extension` or `@adaptivemcp/extension`), using their current versions. Skips the changeset version step. |
| `--tag` | `release.ts` | After publish, commit bump + tag + push (via `version-release.ts --packages …`). |
| `--otp <CODE>` | `release.ts` | Pass npm 2FA one-time password to `npm publish`. |
| `NPM_OTP` | `release.ts` | Env-var alternative to `--otp`. |
| `--packages a,b` | `version-release.ts` | Scope the release version/tag to these packages (set automatically by `--tag`). |
| `--no-push` | `version-release.ts` | Commit + tag locally, don't push. |
| `--dry-run` | `version-release.ts` | Preview git ops, no changes. |

> **Build is never a flag** — it's the separate `pnpm build:publishable` step
> you run before `release.ts`. The release script has no build flag by design.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `[release] working tree is dirty` | Uncommitted changes (often a prior bump) | Commit or stash, then re-run. |
| `npm error code EOTP` | 2FA required, no OTP supplied | Re-run with `--otp <CODE>` (fresh code). Build is separate, so the OTP only gates publish. |
| Publish failed partway (some packages missing on npm) | OTP expired mid-run (the run waits for all and exits non-zero without tagging) | `node scripts/release.ts --continue --otp <NEW_CODE>`; add `--tag` once every package is live. |
| `cannot publish over the previously published version` | Should no longer occur | `release.ts` now skips already-published versions automatically. If you still see it, check `NPM_TOKEN`/registry and the package name. |
| `npm publish` ships stale/old `dist/` | Forgot the separate build step | Run `pnpm build:publishable` before `release.ts`. `dist/` is gitignored, so the release does NOT rebuild. |
| `release.ts` published more packages than expected | Cascaded internal dependents bumped by Changesets (`updateInternalDependencies`) | Expected: every publishable package whose version changed is published, including dependents and first-time publishes. To publish only specific packages, use `--packages a,b`. |
| `release.ts` published nothing | No pending changesets | Author a changeset, or pass `--no-version` to republish all publishable packages. |
| npm page shows no README | `README.md` missing from `files` | Add `"README.md"` to the package's `files` allowlist, rebuild, republish. |
| Tag exists but version missing on npm | Pushed before publish finished | Publish succeeded? If not, publish then re-tag (delete + recreate tag). |
| `pnpm: command not found` / wrong version | pnpm not pinned | `eval "$(fnm env)" && fnm use 26`; use the pinned pnpm 11+. |
