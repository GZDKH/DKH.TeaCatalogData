<!-- GENERATED FILE — DO NOT EDIT LOCALLY -->
<!-- Source: rules/on-demand/ralph-loop.md (in DKH.AgentRules) -->
<!-- To change this rule, edit the source and run: pwsh scripts/sync-claude-rules.ps1 -All -->

---
description: PROMPT.md workflow for Ralph Loop task automation
globs: "**/*"
alwaysApply: false
---

# PROMPT.md & Ralph Loop Workflow (MANDATORY)

## What is Ralph Loop?

A continuous AI agent loop using a Stop hook. `PROMPT.md` is a local, untracked task file in the project root with task list, acceptance criteria, and iteration rules. The agent reads it each iteration, picks the next unchecked task, implements it, and loops until done.

**PROMPT.md is ALWAYS in `.gitignore`** — never committed.

**Good for:** multiple sequential tasks with clear criteria, greenfield features, iterative refinement.
**Not for:** single quick tasks, tasks needing human judgment, unclear success criteria.

## PROMPT.md Template

```markdown
# Ralph Loop: <Project Name> — <Goal>

<Context. Each iteration, pick the NEXT unchecked task.>

## MANDATORY WORKFLOW per task

1. Check which task is next — first unchecked `[ ]` item
2. Move issue to "In progress" on project board
3. Create feature branch: `git checkout -b <type>/<issue-number>-<desc> main`
4. Implement following CLAUDE.md rules
5. Run quality gates (build, test, lint)
6. Commit with `Refs GZDKH/<repo>#<number>`
7. Create MR via git push options (see gitlab-workflow.md)
8. Move issue to "In review"
9. After merge: sync GitHub mirror, clean up branch, close issue → "Done"
10. If ALL non-blocked tasks done AND blocked tasks remain: STOP and output `<promise>BLOCKED — waiting for dependencies</promise>` (do NOT delete PROMPT.md)
11. If ALL tasks done (none blocked): `rm PROMPT.md`, then output `<promise>ALL TASKS COMPLETE</promise>`

## Task List

- [ ] **#<number>** — <task title>
- [ ] **#<number>** — <task title> — **BLOCKED by <dependency>**
```

## Launching

```bash
/ralph-loop:ralph-loop Read PROMPT.md and execute all tasks --completion-promise 'ALL TASKS COMPLETE' --max-iterations 10
```

**Parameters:** `<prompt>` (required), `--completion-promise '<text>'` (recommended), `--max-iterations <n>` (recommended).

| Task count | Recommended iterations |
|------------|----------------------|
| 1 task | 5-8 |
| 2-3 tasks | 10-15 |
| 4-5 tasks | 15-20 |
| 6+ tasks | 20-30 |

**All parameters on a single line.** Multi-word `--completion-promise` must be quoted.

## Pre-Start Verification

On first iteration, before implementing:

1. **Check git status** — clean working tree, on `main`
2. **Check if tasks are done** — verify issues are OPEN. If CLOSED, mark `[x]` and skip
3. **Check if code exists** — if implementation present, skip
4. **Verify prerequisites** — if PROMPT.md lists them, confirm they're met

If ALL tasks already done: `rm PROMPT.md` → output completion promise immediately.

## Cross-Project Dependencies

When spanning repos, create per-project PROMPT.md files with dependency chain. Each MUST have a `**PREREQUISITE**` line. Never start downstream until upstream is complete.

## PROMPT.md Quality

**MUST verify before writing:** service/class names (check proto/code), file paths (check structure), existing patterns (reference real files), API routes, import paths.

**NEVER:** guess names, copy patterns from different projects without verifying, reference non-existent files without marking "to be created".

## Error Recovery (3-Strike Rule)

1. **Strike 1** — fix and retry
2. **Strike 2** — investigate root cause, try alternative
3. **Strike 3** — STOP. Mark task `[BLOCKED]`, comment on issue, move to next task

## Blocked Tasks — DO NOT Delete PROMPT.md

When tasks are blocked by unmet dependencies (e.g., upstream service not yet merged):

1. **Complete all non-blocked tasks** — implement everything that CAN be done
2. **Mark blocked tasks clearly** — leave them as `[ ]` with `**BLOCKED by <dependency>**`
3. **DO NOT delete PROMPT.md** — the file must survive until ALL tasks are done
4. **STOP the loop** — output `<promise>BLOCKED — waiting for dependencies</promise>`
5. **Report to the user** — list which tasks are done and which are blocked with reasons

When the user re-launches Ralph Loop later (after dependencies are resolved):
- Re-read PROMPT.md
- Skip `[x]` tasks
- Pick the next `[ ]` task and continue

## Post-Completion

Before deleting PROMPT.md: verify ALL tasks are `[x]` (none blocked), all issues CLOSED, branches cleaned up, main up to date, GitHub mirror synced, parent issue updated.

**ONLY delete PROMPT.md when zero tasks remain unchecked.** If any `[ ]` task exists (blocked or not) — do NOT delete.

Then: `rm PROMPT.md` → `<promise>ALL TASKS COMPLETE</promise>`

## Rules (NON-NEGOTIABLE)

- **PROMPT.md in `.gitignore`** — never commit
- **All tasks MUST have GitHub issues** — no untracked work
- **Follow gitlab-workflow.md and github-tasks.md** — branches, MRs, board statuses
- **Quality gates mandatory** before each MR
- **Delete PROMPT.md ONLY when ALL tasks are done** — if blocked tasks remain, keep the file
- **NEVER delete PROMPT.md when blocked tasks exist** — the user will re-launch later
- **Always use `--max-iterations` and `--completion-promise`**
- **Verify before starting and before finishing**
- **Accurate info only** — never guess names or paths
