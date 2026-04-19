<!-- GENERATED FILE — DO NOT EDIT LOCALLY -->
<!-- Source: rules/universal/plan-execution.md (in DKH.AgentRules) -->
<!-- To change this rule, edit the source and run: pwsh scripts/sync-claude-rules.ps1 -All -->

---
description: Mandatory plan creation and step-by-step execution — prevents skipping agreed steps
globs: "**/*"
alwaysApply: true
---

# Plan Execution Discipline (MANDATORY)

**CRITICAL**: When a task requires multiple steps, the agent MUST create an explicit plan, persist it, and execute EVERY step in order. Skipping approved steps is FORBIDDEN.

## Why This Rule Exists

Without persistent tracking, plans are lost when conversation context is compressed. The agent then "forgets" agreed steps and skips them, reporting "done" when work is incomplete.

## When This Rule Applies

- Any task with 2+ implementation steps
- Any task where the user asks "how will you do this?" and a plan is discussed
- Any task where the user approves an approach
- All Ralph Loop iterations

## STEP 1: Analyze Thoroughly Before Proposing a Plan

**STOP. Do NOT propose a plan immediately after receiving a task.**

Before proposing anything:

1. **Read all relevant code** — trace the execution path, understand current behavior
2. **Identify all affected files** — not just the obvious ones
3. **Check for dependencies** — what else will break or need updating?
4. **Check existing patterns** — how is similar functionality implemented in the codebase?
5. **List edge cases** — what could go wrong?

**Anti-patterns (FORBIDDEN):**

| Anti-pattern | Correct approach |
|-------------|-----------------|
| Proposing a plan after reading 1 file | Read ALL relevant files first |
| "I'll update the config" without checking what config looks like | Read the config file, understand its structure |
| Assuming a pattern without verifying | Search codebase for actual usage |
| Proposing changes to files you haven't read | Read every file you plan to modify |

## STEP 2: Persist the Plan

After the user approves the plan, **immediately** persist it in **TWO** independent ways. Both are mandatory — they complement each other.

### 2a. Save plan to file (`plans/<feature>.md`)

Save a markdown file with checkboxes in the `plans/` directory of the current repo. This directory is gitignored (added automatically by `sync-projects.ps1 -Tasks git-hooks`).

```markdown
# Plan: <Feature Name>

## Steps

- [ ] Step 1: <description>
- [ ] Step 2: <description>
- [ ] Step 3: <description>

## Approved by user: <date>
```

**Why this is needed:** The plan file is a physical file on disk. It survives context compression, session restarts, and ralph-loop iterations. The agent MUST re-read it whenever context is unclear.

**Lifecycle:**
1. Created when user approves the plan
2. Updated after each step (`[ ]` → `[x]`)
3. Deleted only when ALL steps are `[x]`

### 2b. Create Tasks (Claude Code built-in `TaskCreate` tool)

Create a Task for each step using the `TaskCreate` tool. Tasks are visible in the current session and survive context compression within the same session.

**Why BOTH are needed:**

| Method | Survives context compression | Survives new session | Visual tracking |
|--------|:--:|:--:|:--:|
| `plans/<feature>.md` file | Yes | Yes | Re-read manually |
| TaskCreate/TaskUpdate | Yes | No | Built-in UI |

The file is the durable source of truth. Tasks provide in-session visibility.

## STEP 3: Execute Steps IN ORDER

For each step:

1. **Re-read the plan file** — `Read plans/<feature-name>.md` — before starting the step
2. **Announce** — tell the user which step you're starting: "Starting step 3 of 7: ..."
3. **Implement** the step completely
4. **Verify** — run quality gates, check the result
5. **Mark complete** — update the plan file: `- [ ]` → `- [x]`
6. **Update Task** — mark the corresponding Task as completed
7. **Proceed** to the next step

**NEVER skip a step.** If a step seems unnecessary, ask the user — do not silently skip it.

## STEP 4: Verify Completion

Before reporting "done":

1. **Re-read the plan file** — verify ALL steps are `[x]`
2. **Check Task list** — verify all Tasks are completed
3. **Report summary** — list what was done per step

If ANY step is `[ ]` — the task is NOT complete. Either finish it or explain why it was blocked.

## STEP 5: Cleanup

After ALL steps are confirmed complete:

1. Delete the plan file: `rm plans/<feature-name>.md`
2. If `plans/` directory is empty, remove it

## Ralph Loop Integration

When working inside a Ralph Loop:

1. **PROMPT.md** is the primary task list (which GitHub issue to work on next)
2. **plans/<feature>.md** is the detailed plan for the CURRENT task (implementation steps within one issue)
3. Each Ralph Loop iteration MUST:
   - Re-read PROMPT.md to find the current task
   - Re-read `plans/<current-task>.md` if it exists — to continue where left off
   - If no plan file exists for the current task — create one before implementing
   - After completing all steps — delete the plan file, mark task `[x]` in PROMPT.md

## Context Compression Recovery

If you notice your context was compressed (previous messages summarized):

1. **Immediately re-read** `plans/<feature-name>.md`
2. **Check Task list** — which tasks are completed vs pending
3. **Resume** from the first unchecked step
4. **Do NOT restart** from the beginning or skip ahead

## Rules (NON-NEGOTIABLE)

- **NEVER skip an approved step** — if it was in the plan and the user approved it, you MUST execute it
- **NEVER report "done" without verifying ALL steps are checked off** — re-read the plan file
- **NEVER propose a plan without thorough analysis** — read all relevant code first
- **NEVER execute without persisting the plan** — if the plan is only in your conversation context, it WILL be lost
- **ALWAYS re-read the plan file before starting each step** — context compression may have erased your memory of it
- **ALWAYS announce which step you're starting** — the user should be able to track progress
- **ALWAYS ask before skipping** — if a step seems wrong or unnecessary, ask the user instead of silently skipping
- **ALWAYS create both plan file AND Tasks** — double persistence prevents data loss
