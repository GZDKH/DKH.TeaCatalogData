---
description: GitLab branch & merge request workflow — MANDATORY for all non-trivial tasks
globs: "**/*"
alwaysApply: true
---

# GitLab Branch & Merge Request Workflow (MANDATORY)

**CRITICAL**: Every non-trivial task MUST be developed in a feature branch with a Merge Request on GitLab. Direct commits to `main` are FORBIDDEN.

**GitLab Instance**: gitlab.thetea.app (self-hosted, behind Cloudflare)
**Remote**: `origin` = GitLab (primary, dual-push to GitHub via SSH)
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

### STEP 1: Create GitHub issue and move to "In progress"

Follow `github-tasks.md` STEP 1 and STEP 2 first. Do NOT skip issue creation.

### STEP 2: Create feature branch

```bash
git checkout main && git pull origin main
git checkout -b <type>/<issue-number>-<short-description>
```

Push the branch immediately to establish tracking:

```bash
git push -u origin <type>/<issue-number>-<short-description>
```

### STEP 3: Develop in the branch

- All commits MUST reference the GitHub issue: `Refs GZDKH/<repo>#<number>`
- Run quality gates before each commit (see `build-before-commit.md`)
- Push regularly to keep remote in sync

```bash
git push origin <branch-name>
```

### STEP 4: Create Merge Request via push options

When implementation is complete and ALL quality gates pass locally:

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

Move the GitHub issue to "In review":

```bash
gh project item-edit \
  --project-id PVT_kwDOBvIzdM4BNqa- \
  --id <ITEM_ID> \
  --field-id PVTSSF_lADOBvIzdM4BNqa-zg8l5p0 \
  --single-select-option-id df73e18b
```

Report to the user: **"MR created for GZDKH/<repo>#<number>, auto-merge enabled"**

### STEP 5: If CI/CD pipeline fails

1. Check the CI/CD logs on GitLab Web UI
2. Fix the issues in the feature branch
3. Commit and push — the pipeline will re-run automatically
4. Auto-merge will trigger once the pipeline succeeds

```bash
# Fix, commit, push — pipeline re-runs automatically
git add <files>
git commit -m "<type>(<scope>): fix CI issue

Refs GZDKH/<repo>#<number>"
git push origin <branch-name>
```

### STEP 6: After merge — clean up locally

Once the MR is merged (remote branch deleted automatically):

```bash
git checkout main && git pull origin main
git branch -d <branch-name>
```

Then follow `github-tasks.md` STEP 5: close the issue and move to "Done".

## Push Options Reference

| Option | Description |
|--------|-------------|
| `merge_request.create` | Create a new Merge Request |
| `merge_request.target=<branch>` | Target branch (always `main`) |
| `merge_request.title="..."` | MR title (Conventional Commits format) |
| `merge_request.description="..."` | MR description body |
| `merge_request.merge_when_pipeline_succeeds` | Auto-merge when CI passes |
| `merge_request.remove_source_branch` | Delete branch after merge |
| `merge_request.draft` | Create as Draft MR (for WIP) |
| `merge_request.label="..."` | Add label (repeatable) |
| `merge_request.assign="<username>"` | Assign MR to user |

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
1. gh issue create ...                              → github-tasks.md STEP 1
2. gh project item-edit ... → "In progress"         → github-tasks.md STEP 2
3. git checkout -b feat/42-add-feature main         → THIS RULE STEP 2
4. <develop, commit, push>                          → THIS RULE STEP 3
5. git push ... -o merge_request.create ...         → THIS RULE STEP 4
6. gh project item-edit ... → "In review"           → THIS RULE STEP 4
7. <CI passes → auto-merge>                         → THIS RULE STEP 5-6
8. gh issue close ...                               → github-tasks.md STEP 5
9. gh project item-edit ... → "Done"                → github-tasks.md STEP 5
```

## Rules (NON-NEGOTIABLE)

- **NEVER** commit directly to `main` — always use a feature branch
- **NEVER** push to `main` without a Merge Request
- **NEVER** merge manually if CI/CD pipeline has not passed
- **ALWAYS** use `merge_request.merge_when_pipeline_succeeds` for auto-merge
- **ALWAYS** use `merge_request.remove_source_branch` to clean up
- **ALWAYS** include the GitHub issue number in the branch name
- **MR title** MUST follow Conventional Commits format
- **If MR already exists** — just `git push origin <branch>` (no push options needed)
- **GitLab API is behind Cloudflare** — use git push options (SSH), NOT glab CLI or curl API
