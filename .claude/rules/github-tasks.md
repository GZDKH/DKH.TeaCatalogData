<!-- GENERATED FILE — DO NOT EDIT LOCALLY -->
<!-- Source: rules/universal/github-tasks.md (in DKH.AgentRules) -->
<!-- To change this rule, edit the source and run: pwsh scripts/sync-claude-rules.ps1 -All -->

---
description: GitHub issue tracking — BLOCKING workflow for every task
globs: "**/*"
alwaysApply: true
---

# GitHub Task Tracking (BLOCKING — MANDATORY)

**CRITICAL**: This workflow is BLOCKING. You MUST NOT skip any step. Every non-trivial task MUST be tracked as a GitHub issue on the project board. Failure to follow this workflow is a violation of project rules.

**Project Board**: https://github.com/orgs/GZDKH/projects/19
**Project ID**: `PVT_kwDOBvIzdM4BNqa-`

**GitHub is a MIRROR** — code lives on GitLab, issues and project board live on GitHub. MRs are on GitLab, issue tracking is on GitHub.

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

### STEP 1: Create or verify issue BEFORE writing any code

**STOP. Do NOT write code yet.**

#### Option A: Create a new issue

First, check for duplicates:

```bash
gh issue list --repo GZDKH/<repository> --state open --search "<keywords>"
```

If no duplicate exists, create the issue with appropriate labels:

```bash
gh issue create \
  --repo GZDKH/<repository> \
  --title "<type>(<scope>): <description>" \
  --label "type:<type>" \
  --body "## Description
<what needs to be done>

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2"
```

**Labels** (add at creation):

| Label | When |
|-------|------|
| `type:feature` | New functionality |
| `type:bug` | Bug fix |
| `type:refactor` | Code improvement |
| `type:chore` | Maintenance, deps |
| `type:docs` | Documentation |
| `type:test` | Test coverage |

Then add to the project board and capture the ITEM_ID:

```bash
ITEM_ID=$(gh project item-add 19 --owner GZDKH --url <issue-url> --format json | jq -r '.id')
echo "ITEM_ID: $ITEM_ID"
```

Save the ITEM_ID — you will need it for status changes.

#### Option B: Work with an existing issue (user gave URL/number)

When the user provides an issue URL or number:

1. **Verify the issue is OPEN**:

```bash
gh issue view <number> --repo GZDKH/<repository> --json state,title -q '.state + " — " + .title'
```

If the issue is CLOSED — report to the user and stop. Do not re-implement completed work.

2. **Find the ITEM_ID** on the project board:

```bash
ITEM_ID=$(gh project item-list 19 --owner GZDKH --format json | jq -r '.items[] | select(.content.url == "https://github.com/GZDKH/<repository>/issues/<number>") | .id')
echo "ITEM_ID: $ITEM_ID"
```

If the issue is not on the board yet, add it:

```bash
ITEM_ID=$(gh project item-add 19 --owner GZDKH --url "https://github.com/GZDKH/<repository>/issues/<number>" --format json | jq -r '.id')
```

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

Every commit MUST reference the issue in the body:

```
feat(products): add import endpoint

Refs GZDKH/<repo>#<number>
```

### STEP 4: After MR is merged — close the issue

**IMPORTANT**: Do NOT close the issue until the MR is merged on GitLab and GitHub mirror is synced (see `gitlab-workflow.md` STEP 6).

After merge and sync, close the issue:

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

## Parent / Tracking Issues

For features spanning multiple repositories, use a **parent issue** to track overall progress.

### Creating a parent issue

```bash
gh issue create \
  --repo GZDKH/<primary-repository> \
  --title "feat(<scope>): <feature description>" \
  --label "type:feature" \
  --body "## Description
<overall feature description>

## Child Issues
- [ ] GZDKH/<repo-1>#<number> — <task 1>
- [ ] GZDKH/<repo-2>#<number> — <task 2>
- [ ] GZDKH/<repo-3>#<number> — <task 3>

## Completion Criteria
All child issues must be closed."
```

### Rules for parent issues

- Create the parent issue FIRST, then create child issues with `Refs GZDKH/<repo>#<parent-number>` in the body
- Update the parent issue body with child issue links as they are created
- Close the parent issue ONLY when ALL child issues are closed
- Add a summary comment to the parent issue when all work is done

### Closing a parent issue

```bash
# Verify all child issues are closed
gh issue view <parent-number> --repo GZDKH/<repo> --json body

# Close with summary
gh issue comment <parent-number> --repo GZDKH/<repo> --body "All child issues completed:
- GZDKH/<repo-1>#<n1> ✅
- GZDKH/<repo-2>#<n2> ✅
- GZDKH/<repo-3>#<n3> ✅"

gh issue close <parent-number> --repo GZDKH/<repo> --reason completed
```

## Picking Tasks from the Project Board

When the user asks to take a task from the project board, you MUST filter for **open, actionable** items only.

**CRITICAL**: The project board contains hundreds of items including closed issues. You MUST filter by status. Never report "no tasks found" without filtering properly.

### Find open tasks (Backlog or Ready)

```bash
# List items in "Backlog" or "Ready" status (open, not yet started)
gh project item-list 19 --owner GZDKH --format json | jq '[.items[] | select(.status == "Backlog" or .status == "Ready" or .status == "Todo") | {title: .content.title, url: .content.url, status: .status, repo: .content.repository}]'
```

### Find tasks for a specific repository

```bash
gh project item-list 19 --owner GZDKH --format json | jq '[.items[] | select((.status == "Backlog" or .status == "Ready" or .status == "Todo") and (.content.repository | test("<repository>"))) | {title: .content.title, url: .content.url, status: .status}]'
```

### Find tasks in progress (to resume)

```bash
gh project item-list 19 --owner GZDKH --format json | jq '[.items[] | select(.status == "In progress") | {title: .content.title, url: .content.url, repo: .content.repository}]'
```

### Rules for picking tasks

- **ALWAYS filter by status** — never show closed/done items as available tasks
- **Prefer "Ready" over "Backlog"** — "Ready" means triaged and planned
- **Check issue state** — even if the board item status is "Backlog", verify the GitHub issue is OPEN (`gh issue view <number> --repo GZDKH/<repo> --json state`)
- **Show the user a list** — present available tasks and let the user pick, unless they specified a particular task
- **If no open tasks exist** — report "No open tasks found on the board for <filter>" rather than "no tasks"

## Helper: Find ITEM_ID for an existing issue

```bash
# By full issue URL (most reliable)
ITEM_ID=$(gh project item-list 19 --owner GZDKH --format json | jq -r '.items[] | select(.content.url == "https://github.com/GZDKH/<repository>/issues/<number>") | .id')

# Search by repo and number (partial match)
ITEM_ID=$(gh project item-list 19 --owner GZDKH --format json | jq -r '.items[] | select(.content.url | test("GZDKH/<repository>/issues/<number>$")) | .id')
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

## Helper: Check issue state

```bash
# Single issue
gh issue view <number> --repo GZDKH/<repository> --json state -q '.state'

# List open issues for a repo
gh issue list --repo GZDKH/<repository> --state open

# Check if issue is already closed
gh issue view <number> --repo GZDKH/<repository> --json state -q 'if .state == "CLOSED" then "ALREADY CLOSED — skip" else "OPEN — proceed" end'
```

## Rules (NON-NEGOTIABLE)

- **ONE issue per logical task** — do not bundle unrelated work
- **Issue title follows Conventional Commits** format: `<type>(<scope>): <description>`
- **NEVER start coding without an issue** (except trivial tasks listed above)
- **NEVER skip the status change to "In progress"** — this is how the team tracks active work
- **NEVER forget to close the issue and set "Done"** — incomplete tracking creates confusion
- **NEVER close an issue before MR is merged** — issue tracks the full lifecycle, not just implementation
- **NEVER create a duplicate issue** — search first with `gh issue list --search`
- **ALWAYS verify issue state** before starting work — if CLOSED, do not re-implement
- **Cross-repo references** use full format: `GZDKH/<repo>#<number>`
- **If given an existing issue URL/number** — verify it's OPEN, find its ITEM_ID, and move to "In progress" before starting
- **Parent issues** — close only when ALL child issues are closed; add summary comment
