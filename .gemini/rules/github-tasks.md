---
description: GitHub issue tracking — BLOCKING workflow for every task
globs: "**/*"
alwaysApply: true
---

# GitHub Task Tracking (BLOCKING — MANDATORY)

**CRITICAL**: This workflow is BLOCKING. You MUST NOT skip any step. Every non-trivial task MUST be tracked as a GitHub issue on the project board. Failure to follow this workflow is a violation of project rules.

**Project Board**: https://github.com/orgs/GZDKH/projects/19
**Project ID**: `PVT_kwDOBvIzdM4BNqa-`

**Trivial tasks that DO NOT require an issue:** typo fixes, single-line formatting changes, comment edits.

## Project Board IDs (hardcoded — use these exact values)

| Field | ID |
|-------|----|
| Status field | `PVTSSF_lADOBvIzdM4BNqa-zg8l5p0` |
| → Backlog | `f75ad846` |
| → Ready | `61e4505c` |
| → In progress | `47fc9ee4` |
| → In review | `df73e18b` |
| → Done | `98236657` |

## Workflow (EVERY step is MANDATORY)

### STEP 1: Create issue BEFORE writing any code

**STOP. Do NOT write code yet.** First, create the issue:

```bash
gh issue create \
  --repo GZDKH/<repository> \
  --title "<type>(<scope>): <description>" \
  --body "## Description
<what needs to be done>

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2"
```

Then add to the project board and capture the ITEM_ID:

```bash
ITEM_ID=$(gh project item-add 19 --owner GZDKH --url <issue-url> --format json | jq -r '.id')
echo "ITEM_ID: $ITEM_ID"
```

Save the ITEM_ID — you will need it for status changes.

### STEP 2: Move issue to "In progress" BEFORE starting implementation

**STOP. Do NOT write code yet.** First, change the status:

```bash
gh project item-edit \
  --project-id PVT_kwDOBvIzdM4BNqa- \
  --id <ITEM_ID> \
  --field-id PVTSSF_lADOBvIzdM4BNqa-zg8l5p0 \
  --single-select-option-id 47fc9ee4
```

Report to the user: **"Starting work on GZDKH/<repo>#<number>"**

**NOW you may begin writing code.**

### STEP 3: Link every commit to the issue

Every commit MUST reference the issue:

```
feat(products): add import endpoint

Refs GZDKH/<repo>#<number>
```

### STEP 4: After implementation — verify quality gates

Run ALL blocking quality gates:

```bash
# .NET
dotnet build -c Release && dotnet test

# Next.js
pnpm build
```

**Do NOT proceed to closing if gates fail.**

### STEP 5: Close the issue

After quality gates pass, close the issue:

```bash
gh issue close <number> --repo GZDKH/<repository> --reason completed
```

Then move to "Done" on the project board:

```bash
gh project item-edit \
  --project-id PVT_kwDOBvIzdM4BNqa- \
  --id <ITEM_ID> \
  --field-id PVTSSF_lADOBvIzdM4BNqa-zg8l5p0 \
  --single-select-option-id 98236657
```

Report to the user: **"Completed GZDKH/<repo>#<number>"**

## Helper: Find ITEM_ID for an existing issue

If you need to find the ITEM_ID for an issue already on the board:

```bash
gh project item-list 19 --owner GZDKH --format json | jq -r '.items[] | select(.content.url | contains("<repo>#<number>")) | .id'
```

Or if assigned a task by the user (issue URL given):

```bash
ITEM_ID=$(gh project item-list 19 --owner GZDKH --format json | jq -r '.items[] | select(.content.url == "<full-issue-url>") | .id')
```

## Helper: Change status to any value

```bash
# To "In progress":
gh project item-edit --project-id PVT_kwDOBvIzdM4BNqa- --id <ITEM_ID> --field-id PVTSSF_lADOBvIzdM4BNqa-zg8l5p0 --single-select-option-id 47fc9ee4

# To "In review":
gh project item-edit --project-id PVT_kwDOBvIzdM4BNqa- --id <ITEM_ID> --field-id PVTSSF_lADOBvIzdM4BNqa-zg8l5p0 --single-select-option-id df73e18b

# To "Done":
gh project item-edit --project-id PVT_kwDOBvIzdM4BNqa- --id <ITEM_ID> --field-id PVTSSF_lADOBvIzdM4BNqa-zg8l5p0 --single-select-option-id 98236657
```

## Rules (NON-NEGOTIABLE)

- **ONE issue per logical task** — do not bundle unrelated work
- **Issue title follows Conventional Commits** format: `<type>(<scope>): <description>`
- **NEVER start coding without an issue** (except trivial tasks listed above)
- **NEVER skip the status change to "In progress"** — this is how the team tracks active work
- **NEVER forget to close the issue and set "Done"** — incomplete tracking creates confusion
- **NEVER close an issue without verification** — quality gates must pass first
- **Cross-repo references** use full format: `GZDKH/<repo>#<number>`
- **If given an existing issue URL/number** — find its ITEM_ID and move to "In progress" before starting
