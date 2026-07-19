# Release runbook — publishing `@adaptivemcp/*` to npm

This is the canonical, self-contained guide for cutting a release by hand. It
covers **when to commit, when to push, what to watch out for, and how npm vs
GitHub versioning work** so you can run a release end-to-end without the agent.

The release is driven entirely by two scripts — there is **no manual
`npm publish`**:

| Script | What it does |
| --- | --- |
| `scripts/release.ts` | Version (Changesets) → build → `npm publish` the 5 core packages. |
| `scripts/version-release.ts` | After publish: commit the version bump, create an annotated `vX.Y.Z` tag, push `--follow-tags`. |

Publishable set (defined once in `scripts/lib/workspace.ts` →
`PUBLISHABLE_PACKAGES`): `spec · memory · telemetry · evaluation · extension`.
`routing`, `orchestration`, `approval`, `thin-client`, `examples`, `apps` stay
private.

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
  resume**: packages that already published are simply skipped on re-run
  (`npm error cannot publish over the previously published version …`).

### GitHub (the repo)

- A release is recorded as an **annotated git tag** `vX.Y.Z` (note the `v`
  prefix — npm has no prefix, GitHub does). The tag is independent of npm; it
  just marks the commit where the version bump landed.
- `git push --follow-tags` pushes the commit **and** the tag together.
- The base branch is `main`. Changesets' `baseBranch` is `main`.

**Key takeaway:** npm owns *what users install*; GitHub tags own *what the
source looked like at that version*. Keep them in sync by tagging the exact
commit that contains the version bump.

---

## Prerequisites

- **Node 26** (the built-in `node:sqlite` needs it; `node script.ts` uses native
  type stripping). Use `eval "$(fnm env)" && fnm use 26`.
- **pnpm 11.14.0** (pinned via the repo `packageManager` field — don't use a
  different pnpm).
- An npm account in the **`@adaptivemcp`** org with publish rights
  (`https://www.npmjs.com/org/adaptivemcp`).
- `NPM_TOKEN` in the environment (we keep it in `.env` and `source .env`;
  `.env` is gitignored). `npm publish` reads it automatically.
- A **clean working tree** (`git status --porcelain` empty). The scripts refuse
  to run otherwise.

---

## The two flows

### Flow A — one-shot (recommended): `release.ts --tag`

Version bump + build + publish + commit + tag + push, all in one command:

```bash
eval "$(fnm env)" && fnm use 26
source .env
node scripts/release.ts --tag --otp <CODE>
```

Use this when you've already reviewed the dry run and just want it done. The
`--tag` flag hands off to `version-release.ts` at the end, which commits the
bump and pushes the tag.

### Flow B — split (verify before committing): `release.ts` then `version-release.ts`

Publish first, **inspect npm**, then record the release separately:

```bash
node scripts/release.ts --otp <CODE>     # version + build + publish only
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
**Do not** run `changeset version` yourself — let the script own that step.

If you have no pending changeset, the script just republishes current versions
(use `--no-version` to skip the version step entirely).

### 2. Dry run (no publish, no commit)

```bash
node scripts/release.ts --dry-run
```

Builds, applies pending changesets, rebuilds, then stops. Inspect the version
bumps in `package.json` / `CHANGELOG.md` and the emitted `dist/`. Nothing is
published or committed.

### 3. Publish (+ optionally tag)

```bash
# Flow A (one-shot):
node scripts/release.ts --tag --otp <CODE>

# or Flow B (publish now, tag later):
node scripts/release.ts --otp <CODE>
node scripts/version-release.ts
```

What `release.ts` does, in order:

1. Refuses if the tree is dirty.
2. Builds `PUBLISHABLE_PACKAGES` (`pnpm -r --filter … run build`).
3. Applies pending changesets (`pnpm changeset version`).
4. Rebuilds (the version bump may change emitted code).
5. `npm publish --access public --ignore-scripts` each package in dependency
   order: `spec → memory → telemetry → evaluation → extension`.

`--ignore-scripts` keeps the publish hermetic (no lifecycle scripts run inside
the published tarball).

### 4. Verify on npm

```bash
npm view @adaptivemcp/extension version        # should show the new version
npm view @adaptivemcp/extension dist-tags       # latest should point at it
```

Open `https://www.npmjs.com/org/adaptivemcp` and confirm each of the 5 packages
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
succeeds** — otherwise GitHub would show a tag for a version that doesn't exist
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
- If the OTP expires **mid-publish**, the remaining packages fail. Already
  published versions are immutable and skipped on re-run, so just re-run with a
  fresh OTP — the earlier packages stay published.
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
consumed, `changeset version` is a no-op and the script just rebuilds + publishes
the already-bumped versions. (This is exactly what happened at v0.2.1: the first
publish hit 2FA, we committed the bump, then re-ran with `--otp`.)

### 3. Changeset is consumed, not preserved

`pnpm changeset version` **deletes** the changeset markdown file. If the run is
interrupted after that step, the bump is applied but uncommitted (see #2). There
is no "undo" — just commit and continue.

### 4. Build runs twice

The script builds before *and* after the version bump (the bump can change
emitted code). Don't be surprised by the double build; it's intentional.

### 5. README must ship in the tarball

npm shows "This package does not have a README" if `README.md` isn't in the
`files` allowlist. The 5 published packages include `"README.md"` alongside
`"dist"` in `files`. If you add a package to `PUBLISHABLE_PACKAGES`, copy that
allowlist.

### 6. Dependency order matters

Publish order is `spec → memory → telemetry → evaluation → extension`. Don't
reorder or publish by hand — a package can't depend on a version that isn't
published yet.

### 7. Never publish by hand

Ad-hoc `npm publish` skips the version bump, the clean-tree guard, and the
ordering. Always go through `release.ts`.

---

## Quick reference

```bash
# Pre-flight
git status --porcelain
node scripts/maintenance.ts check

# Changeset (if shipping a change)
pnpm changeset && git add .changeset && git commit -m "chore: changeset"

# Dry run
node scripts/release.ts --dry-run

# Release (one-shot, with 2FA OTP)
node scripts/release.ts --tag --otp <CODE>

# …or split…
node scripts/release.ts --otp <CODE>
node scripts/version-release.ts

# Verify
npm view @adaptivemcp/extension version
npm view @adaptivemcp/extension dist-tags
git tag -l 'v*'

# If a run died after consuming the changeset:
git add -A && git commit -m "release: @adaptivemcp/* vX.Y.Z (pre-publish)"
node scripts/release.ts --tag --otp <CODE>   # re-run; already-published pkgs skip
```

## Flags

| Flag | Script | Effect |
| --- | --- | --- |
| `--dry-run` | `release.ts` | Build + version, skip publish. |
| `--no-version` | `release.ts` | Skip `changeset version`; publish current versions as-is. |
| `--tag` | `release.ts` | After publish, commit bump + tag + push (via `version-release.ts`). |
| `--otp <CODE>` | `release.ts` | Pass npm 2FA one-time password to `npm publish`. |
| `NPM_OTP` | `release.ts` | Env-var alternative to `--otp`. |
| `--no-push` | `version-release.ts` | Commit + tag locally, don't push. |
| `--dry-run` | `version-release.ts` | Preview git ops, no changes. |

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `[release] working tree is dirty` | Uncommitted changes (often a prior bump) | Commit or stash, then re-run. |
| `npm error code EOTP` | 2FA required, no OTP supplied | Re-run with `--otp <CODE>` (fresh code). |
| `cannot publish over the previously published version` | Re-running after partial publish | Expected — already-published pkgs skip; supply OTP for the rest. |
| npm page shows no README | `README.md` missing from `files` | Add `"README.md"` to the package's `files` allowlist, rebuild, republish. |
| Tag exists but version missing on npm | Pushed before publish finished | Publish succeeded? If not, publish then re-tag (delete + recreate tag). |
| `pnpm: command not found` / wrong version | pnpm not pinned | `eval "$(fnm env)" && fnm use 26`; use the pinned pnpm 11.14.0. |
