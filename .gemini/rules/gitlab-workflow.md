<!-- GENERATED FILE — DO NOT EDIT LOCALLY -->
<!-- Source: rules/universal/gitlab-workflow.md (in DKH.AgentRules) -->
<!-- To change this rule, edit the source and run: pwsh scripts/sync-claude-rules.ps1 -All -->

---
description: GitLab branch & merge request workflow — MANDATORY for all non-trivial tasks
globs: "**/*"
alwaysApply: true
---

# GitLab Branch & Merge Request Workflow (MANDATORY)

**CRITICAL**: Every non-trivial task MUST be developed in a feature branch with a Merge Request on GitLab. Direct commits to `main` are FORBIDDEN.

**GitLab Instance**: gitlab.thetea.app (self-hosted, behind Cloudflare)
**Remote**: `origin` = GitLab (primary); dual-push configured to push to both GitLab and GitHub via SSH
**GitHub**: mirror only — issues and project board live on GitHub, code and MRs live on GitLab
**Default branch**: `main`

**Trivial tasks that MAY skip branching:** typo fixes, single-line formatting changes, comment edits.

## Branch Naming Convention

**Format**: `<type>/<issue-number>-<short-description>`

**Types** match Conventional Commits: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `build`, `ci`, `perf`

**Examples**:

- `feat/42-add-import-endpoint`
- `fix/15-token-refresh`
- `refactor/33-typed-grpc-clients`
- `chore/88-update-dependencies`

**Rules**:

- Lowercase, hyphens for word separation
- MUST include GitHub issue number
- Keep description short (2-4 words)
- ALWAYS branch from `main`

## Workflow (integrates with github-tasks.md)

### STEP 1: Create or verify GitHub issue and move to "In progress"

Follow `github-tasks.md` STEP 1 (create new or verify existing issue) and STEP 2 (move to "In progress") first. Do NOT skip issue tracking.

### STEP 2: Create feature branch

**CRITICAL: Always start from a fresh `main`.** Before creating a branch, verify your current state:

```bash
# 1. Check if you are on a stale/merged branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "WARNING: Currently on branch '$CURRENT_BRANCH', not main!"
  # Check if this branch was already merged
  git fetch origin main
  if git log origin/main --oneline | head -20 | grep -q "$(git log --oneline -1 --format='%s')"; then
    echo "Branch '$CURRENT_BRANCH' appears to be already merged. Switching to main."
  fi
  git checkout main
fi

# 2. Pull latest main and create fresh branch
git pull origin main
git checkout -b <type>/<issue-number>-<short-description>
```

**NEVER commit to a branch that has already been merged.** If a previous task's branch was merged but not cleaned up, you MUST:
1. Switch to `main` and pull
2. Delete the stale local branch: `git branch -D <old-branch>`
3. Create a new branch for the new task

Push the branch immediately to establish tracking:

```bash
git push -u origin <type>/<issue-number>-<short-description>
```

### STEP 3: Develop in the branch

- All commits MUST reference the GitHub issue: `Refs GZDKH/<repo>#<number>`
- Run quality gates before each commit (see `build-before-commit.md`)
- Push regularly to keep remote in sync

**MANDATORY — BLOCKING: Before EVERY `git commit` and `git push`, run this check. If it fails, STOP — do NOT commit or push.**

**This is the #1 most common mistake — committing on main or a merged branch. All changes are LOST when this happens.**

```bash
# === PRE-COMMIT BRANCH SAFETY CHECK (BLOCKING) ===
# Run this BEFORE every git commit. Copy-paste as-is.
CURRENT_BRANCH=$(git branch --show-current)

# CHECK 1: Not on main
if [ "$CURRENT_BRANCH" = "main" ]; then
  echo "❌ FATAL: On main! STOP. Create a feature branch first:"
  echo "   git checkout -b fix/NNN-description"
  echo "   DO NOT commit on main."
  exit 1
fi

# CHECK 2: Branch is YOUR branch (not someone else's)
# If branch name doesn't match your current task — STOP
echo "📌 Current branch: $CURRENT_BRANCH"
echo "   Is this the correct branch for your current task? (verify manually)"

# CHECK 3: Branch still exists on remote (not merged and deleted)
if ! git ls-remote --exit-code --heads origin "$CURRENT_BRANCH" >/dev/null 2>&1; then
  echo "❌ FATAL: Branch '$CURRENT_BRANCH' does not exist on remote!"
  echo "   It was likely already merged and deleted."
  echo "   STOP. Switch to main and create a NEW branch:"
  echo "   git checkout main && git pull origin main"
  echo "   git branch -D $CURRENT_BRANCH"
  echo "   git checkout -b fix/NNN-new-description"
  exit 1
fi

echo "✅ Branch check passed: $CURRENT_BRANCH"
```

**If you skip this check and commit on the wrong branch:**
- Changes are LOST when the branch is deleted or merged
- You must cherry-pick or redo the work
- This wastes significant time

**Common mistakes to avoid:**
- Running `git commit` right after `git checkout main && git pull` — you're on main!
- Adding commits to a branch after its MR was merged — GitLab already deleted it
- Multiple agents working in the same repo — one may switch branches under you

**If the branch was already merged** — do NOT commit to it. Instead:
1. `git checkout main && git pull origin main`
2. `git branch -D <old-branch>`
3. Create a NEW branch for the new fix

```bash
git push origin <branch-name>
```

### STEP 4: Sync with main, verify quality gates, create Merge Request

**4.1. Sync with main BEFORE creating MR:**

```bash
# Fetch latest main and rebase your branch on top
git fetch origin main
git rebase origin/main
```

If rebase has conflicts — resolve them, `git rebase --continue`, then re-run quality gates.

**4.2. Run ALL quality gates** (see `build-before-commit.md` for your project type). If ANY gate fails — fix, commit, and re-run. NEVER push broken code for MR.

**4.3. Create the MR:**

```bash
git push origin <branch-name> \
  -o merge_request.create \
  -o merge_request.target=main \
  -o merge_request.title="<type>(<scope>): <description>" \
  -o merge_request.merge_when_pipeline_succeeds \
  -o merge_request.remove_source_branch
```

This single command:

1. Creates an MR on GitLab
2. Sets auto-merge when CI/CD pipeline passes
3. Configures automatic branch cleanup after merge

**4.4. Verify push output — MANDATORY checklist:**

After `git push`, read the output and confirm ALL of the following:

- [ ] `remote: View merge request for ...` — MR URL is present → MR was created
- [ ] Push options were accepted (no errors about `-o` flags)
- [ ] ALL 5 push options were included in the command (check your command before running)

**If ANY push option was missing** (especially `merge_when_pipeline_succeeds` or `remove_source_branch`), push again with the missing options:

```bash
git push origin <branch-name> \
  -o merge_request.merge_when_pipeline_succeeds \
  -o merge_request.remove_source_branch
```

**IMPORTANT**: The `git push` output contains the GitLab MR URL (line starting with `remote: View merge request for`). **ALWAYS** extract and report this URL to the user.

Move the GitHub issue to "In review":

```bash
gh project item-edit \
  --project-id PVT_kwDOBvIzdM4BNqa- \
  --id <ITEM_ID> \
  --field-id PVTSSF_lADOBvIzdM4BNqa-zg8l5p0 \
  --single-select-option-id df73e18b
```

Report to the user: **"MR created: `<GitLab-MR-URL>` for GZDKH/<repo>#<number>, auto-merge enabled"**

**CRITICAL: The task is NOT complete at this point.** The MR still needs to pass CI and be merged. Do NOT report "done" — report "MR created, waiting for pipeline".

### STEP 5: If CI/CD pipeline fails or a fix is needed after MR

**CRITICAL: First, determine if the branch still exists on the remote.**

```bash
CURRENT_BRANCH=$(git branch --show-current)

# Check if branch was already merged and deleted on remote
if ! git ls-remote --exit-code --heads origin "$CURRENT_BRANCH" >/dev/null 2>&1; then
  echo "Branch '$CURRENT_BRANCH' no longer exists on remote — it was already merged."
  echo "Create a NEW branch from main for the fix."
  # MUST: switch to main, pull, create NEW branch
  git checkout main && git pull origin main
  git branch -D "$CURRENT_BRANCH"  # delete stale local branch
  git checkout -b fix/<issue-number>-<fix-description>
  git push -u origin fix/<issue-number>-<fix-description>
fi
```

**If branch still exists on remote** (MR not yet merged):

1. Check the CI/CD logs on GitLab Web UI
2. Fix the issues in the feature branch
3. Sync with main before pushing: `git fetch origin main && git rebase origin/main`
4. Commit and push — the pipeline will re-run automatically
5. Auto-merge will trigger once the pipeline succeeds

```bash
# Fix, commit, push — pipeline re-runs automatically
git add <files>
git commit -m "<type>(<scope>): fix CI issue

Refs GZDKH/<repo>#<number>"
git fetch origin main && git rebase origin/main
git push origin <branch-name>
```

**If branch was already merged** (need a new fix):

Each fix MUST be a separate NEW branch from `main`. NEVER reuse a merged branch.

1. `git checkout main && git pull origin main`
2. `git checkout -b fix/<issue-number>-<description>`
3. Make the fix, run quality gates
4. Sync with main: `git fetch origin main && git rebase origin/main`
5. Push with full MR options (STEP 4.3) — do NOT skip auto-merge options

### STEP 6: After merge — sync GitHub mirror and clean up

Once the MR is merged on GitLab (`remove_source_branch` deletes the branch on GitLab only):

**CRITICAL**: GitLab auto-merge does NOT sync to GitHub. You **MUST** always perform this step — no exceptions.

```bash
# 1. Pull merged main from GitLab
git checkout main && git pull origin main

# 2. Push main to GitHub mirror (dual-push sends to both GitLab and GitHub)
#    If GitHub rejects the push (non-fast-forward), use --force-with-lease.
#    GitHub is a MIRROR — force push to sync it is safe and expected.
git push origin main || git push origin main --force-with-lease

# 3. Delete stale feature branch from GitHub (GitLab already removed it via MR option, but GitHub still has it)
git push origin --delete <branch-name> 2>/dev/null || true

# 4. Delete local branch (use -D if git complains about "not fully merged" — it was merged via MR)
git branch -d <branch-name> || git branch -D <branch-name>
```

**Why this is needed**: The MR merge commit only exists on GitLab's `main`. The `remove_source_branch` option only deletes the branch on GitLab. Since `origin` has dual-push configured (pushes to both GitLab and GitHub via SSH), running `git push origin main` syncs the merge commit to both remotes. We must also explicitly delete the stale feature branch from GitHub and clean up the local branch.

**GitHub push rejection**: GitHub may reject a normal push if its history diverged (e.g., from a previous cherry-pick or direct push). This is normal — GitHub is a mirror, not the source of truth. Use `--force-with-lease` to overwrite. **Do NOT retry the same `git push` in a loop** — if the first push fails, go straight to `--force-with-lease`.

Report to the user: **"GitHub mirror synced. Branch `<branch-name>` cleaned up."**

### STEP 6.1: Verify main builds after merge

**CRITICAL**: After pulling merged `main`, **ALWAYS** run quality gates before closing the issue:

```bash
# .NET
dotnet build -c Release && dotnet test

# Next.js
pnpm build && pnpm lint
```

**If the build fails on `main` after merge** — this means the merge introduced errors (e.g., conflict resolution mistake, incompatible changes from parallel MRs, missing imports). **Fix it immediately:**

1. Create a NEW fix branch from `main`:
   ```bash
   git checkout -b fix/<original-issue-number>-post-merge-fix main
   ```
2. Fix the build errors
3. Run quality gates until green
4. Create MR with auto-merge:
   ```bash
   git push origin fix/<original-issue-number>-post-merge-fix \
     -o merge_request.create \
     -o merge_request.target=main \
     -o merge_request.title="fix(<scope>): resolve post-merge build errors" \
     -o merge_request.merge_when_pipeline_succeeds \
     -o merge_request.remove_source_branch
   ```
5. After merge: sync GitHub mirror, clean up (same as STEP 6)

**NEVER** leave `main` in a broken state. **NEVER** close the issue until `main` builds successfully. **NEVER** skip this verification — a green CI pipeline on the feature branch does NOT guarantee `main` will be green after merge (parallel MRs can conflict).

Then follow `github-tasks.md` STEP 4: close the issue and move to "Done".

## Push Options Reference

| Option                                       | Description                            |
| -------------------------------------------- | -------------------------------------- |
| `merge_request.create`                       | Create a new Merge Request             |
| `merge_request.target=<branch>`              | Target branch (always `main`)          |
| `merge_request.title="..."`                  | MR title (Conventional Commits format) |
| `merge_request.description="..."`            | MR description body                    |
| `merge_request.merge_when_pipeline_succeeds` | Auto-merge when CI passes              |
| `merge_request.remove_source_branch`         | Delete branch after merge              |
| `merge_request.draft`                        | Create as Draft MR (for WIP)           |
| `merge_request.label="..."`                  | Add label (repeatable)                 |
| `merge_request.assign="<username>"`          | Assign MR to user                      |

## Draft MR (work in progress)

To create a Draft MR when you need early feedback before it's ready:

```bash
git push origin <branch-name> \
  -o merge_request.create \
  -o merge_request.target=main \
  -o merge_request.title="Draft: <type>(<scope>): <description>" \
  -o merge_request.draft
```

When ready, remove draft status via GitLab Web UI, then push with auto-merge:

```bash
git push origin <branch-name> \
  -o merge_request.merge_when_pipeline_succeeds \
  -o merge_request.remove_source_branch
```

## Combined Workflow Summary

Complete flow from start to finish:

```
1.  gh issue create / verify existing issue           → github-tasks.md STEP 1
2.  gh project item-edit ... → "In progress"          → github-tasks.md STEP 2
3.  git checkout -b feat/42-add-feature main          → THIS RULE STEP 2
4.  Before EVERY commit: verify branch alive          → THIS RULE STEP 3 (ls-remote check)
5.  <develop, commit, push>                           → THIS RULE STEP 3
6.  git fetch origin main && git rebase origin/main   → THIS RULE STEP 4.1 (sync with main)
7.  Run quality gates (build, test, format)           → THIS RULE STEP 4.2
8.  git push ... -o merge_request.create ...          → THIS RULE STEP 4.3 (ALL 5 options!)
9.  Verify push output: MR URL + options accepted     → THIS RULE STEP 4.4
10. Report "MR created, waiting for pipeline"         → THIS RULE STEP 4 (NOT "done"!)
11. gh project item-edit ... → "In review"            → THIS RULE STEP 4
12. <CI passes → auto-merge on GitLab>                → THIS RULE STEP 5
13. If fix needed: check branch exists on remote      → THIS RULE STEP 5 (ls-remote check)
14. If branch gone: NEW branch from main              → THIS RULE STEP 5 (never reuse)
15. git pull origin main && git push origin main      → THIS RULE STEP 6 (sync GitHub mirror)
16. git push origin --delete <branch>                 → THIS RULE STEP 6 (cleanup stale branch)
17. git branch -D <branch>                            → THIS RULE STEP 6 (cleanup local)
18. Report "GitHub mirror synced" to user             → THIS RULE STEP 6
19. Run quality gates on main (build, test)           → THIS RULE STEP 6.1 (verify merge)
20. If build fails → fix/NNN-post-merge-fix branch    → THIS RULE STEP 6.1 (fix broken main)
21. gh issue close ...                                → github-tasks.md STEP 4
22. gh project item-edit ... → "Done"                 → github-tasks.md STEP 4
```

## Rules (NON-NEGOTIABLE)

### Branch & commit rules

- **NEVER** commit directly to `main` — always use a feature branch
- **NEVER** push to `main` without a Merge Request
- **NEVER** commit to a branch that has already been merged — before EVERY commit, run `git ls-remote --exit-code --heads origin $(git branch --show-current)` to confirm the branch exists on remote
- **NEVER** reuse a merged branch for a new fix — always create a NEW branch from `main`
- **NEVER** add unrelated changes to an existing MR — each logical task = separate branch = separate MR. If the current MR is about auth fix, do NOT add UI improvements to it
- **ALWAYS** start new work from a fresh `main` — `git checkout main && git pull origin main` before creating any branch
- **ALWAYS** include the GitHub issue number in the branch name
- **ALWAYS** clean up merged branches immediately after MR merge (STEP 6) — do not leave stale branches
- **ALWAYS** after MR merges, switch to main and pull — do NOT continue on the merged branch

### Pre-push & MR rules

- **NEVER** push for MR without running quality gates first (build, test, format) — broken code must not reach GitLab
- **NEVER** merge manually if CI/CD pipeline has not passed
- **NEVER** push MR without ALL 5 required options — if you forgot `merge_when_pipeline_succeeds` or `remove_source_branch`, push again with the missing options immediately
- **ALWAYS** sync with `main` before creating MR — `git fetch origin main && git rebase origin/main` (STEP 4.1)
- **ALWAYS** use `merge_request.merge_when_pipeline_succeeds` for auto-merge — this is NOT optional
- **ALWAYS** use `merge_request.remove_source_branch` to clean up — this is NOT optional
- **ALWAYS** verify push output after creating MR — confirm MR URL is present and all options were accepted (STEP 4.4)
- **ALWAYS** report the GitLab MR URL to the user after creating the MR
- **ALWAYS** run quality gates before creating MR: `.NET` → `dotnet build -c Release && dotnet test && dotnet format --verify-no-changes`; `Next.js` → `pnpm build && pnpm lint`

### Completion rules

- **NEVER** report "done" or "task complete" after creating MR — the task is NOT done until MR is merged and `main` builds successfully
- **NEVER** report "done" without verifying the branch still exists on remote — if it was deleted, the MR was already merged or closed
- **ALWAYS** sync GitHub mirror after MR merge — `git push origin main` (or `--force-with-lease` if rejected) + delete stale branch — and report sync to user
- **ALWAYS** verify `main` builds after merge (STEP 6.1) before closing the issue

### Technical rules

- **GitHub is a MIRROR** — `--force-with-lease` to GitHub is safe and expected when syncing after GitLab MR merge. Do NOT panic or retry normal push in a loop — go straight to `--force-with-lease`
- **MR title** MUST follow Conventional Commits format
- **If MR already exists** — just `git push origin <branch>` (no push options needed)
- **GitLab API is behind Cloudflare** — use git push options (SSH), NOT glab CLI or curl API
- **If user reports a fix needed after MR merge** — create a NEW branch from `main`, never reuse the old merged branch
- **Each fix = separate branch** — never combine multiple unrelated fixes in one branch
