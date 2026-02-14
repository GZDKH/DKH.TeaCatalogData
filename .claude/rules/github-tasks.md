---
description: GitHub issue tracking for all tasks
globs: "**/*"
---

# GitHub task tracking (MANDATORY)

Every non-trivial task MUST be tracked as a GitHub issue on the project board.

**Project Board**: https://github.com/orgs/GZDKH/projects/19

**Trivial tasks that DO NOT require an issue:** typo fixes, single-line formatting changes, comment edits.

## Workflow

### 1. Before starting work — create an issue

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

Add to project board immediately:

```bash
gh project item-add 19 --owner GZDKH --url <issue-url>
```

### 2. When starting implementation — set status In Progress

Report to the user: `Starting work on #<number>` and move to In Progress.

### 3. During work — link commits to the issue

Include issue reference in every commit:

```
feat(products): add import endpoint

Refs GZDKH/<repo>#<number>
```

### 4. After completion — verify and close

1. Ensure all quality gates pass (build, test, lint)
2. Confirm all acceptance criteria are met
3. Close the issue:

```bash
gh issue close <number> --repo GZDKH/<repository> --reason completed
```

Or use `Fixes GZDKH/<repo>#<number>` in the final commit/PR to auto-close.

## Rules

- **ONE issue per logical task** — do not bundle unrelated work
- **Issue title follows Conventional Commits** format: `<type>(<scope>): <description>`
- **Never start coding without an issue** (except trivial tasks listed above)
- **Never close an issue without verification** — quality gates must pass first
- **Cross-repo references** use full format: `GZDKH/<repo>#<number>`
