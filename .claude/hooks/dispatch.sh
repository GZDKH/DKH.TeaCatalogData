#!/usr/bin/env bash
# Wrapper hook: forwards a hook invocation to the canonical hook implementation
# living in agents/DKH.AgentRules/hooks/ at the monorepo root.
#
# Why this exists:
#   1. Each subrepo has its own .claude/settings.json (it's a separate git repo).
#      Subrepo settings can't reference $CLAUDE_PROJECT_DIR/agents/DKH.AgentRules/
#      because $CLAUDE_PROJECT_DIR resolves to the subrepo, not the monorepo root.
#      This wrapper resolves the monorepo root at runtime and exec's the real hook.
#   2. Cross-platform interpreter detection. On Windows (Git Bash) Python is
#      often `python` or `py -3`, not `python3`. The dispatcher probes each
#      common name and uses the first one in PATH.
#
# Usage (from any .claude/settings.json):
#   "command": "[ ! -f \"$CLAUDE_PROJECT_DIR/agents/DKH.AgentRules/hooks/dispatch.sh\" ] || \\
#               bash \"$CLAUDE_PROJECT_DIR/agents/DKH.AgentRules/hooks/dispatch.sh\" <hook-file>"
#
# Behavior:
#   - $1 is the hook file name (e.g. "block-commit-wrong-branch.sh")
#   - Remaining args ($2..) are forwarded to the real hook
#   - stdin is inherited (Claude Code feeds tool_input JSON via stdin)
#   - Walks up from $CLAUDE_PROJECT_DIR (fallback: $PWD) to find a directory
#     that contains agents/DKH.AgentRules/hooks/
#   - Picks interpreter from the real hook's shebang (#!/usr/bin/env python3
#     or #!/usr/bin/env bash) — works even when the hook file is not chmod +x
#   - Python: tries `python3`, then `python`, then `py -3` (Windows)
#   - Bash:   tries `bash`, then `sh`
#   - If monorepo root not found OR specific hook not present OR no interpreter
#     available → exit 0 (graceful no-op so a standalone clone or missing
#     toolchain doesn't break the user's session)

set -eu

HOOK_FILE="${1:-}"
if [ -z "$HOOK_FILE" ]; then
    exit 0
fi
shift

run_python() {
    if command -v python3 >/dev/null 2>&1; then
        exec python3 "$@"
    elif command -v python >/dev/null 2>&1; then
        exec python "$@"
    elif command -v py >/dev/null 2>&1; then
        exec py -3 "$@"
    fi
    exit 0
}

run_bash() {
    if command -v bash >/dev/null 2>&1; then
        exec bash "$@"
    elif command -v sh >/dev/null 2>&1; then
        exec sh "$@"
    fi
    exit 0
}

START="${CLAUDE_PROJECT_DIR:-$PWD}"
DIR="$START"
while [ "$DIR" != "/" ]; do
    if [ -d "$DIR/agents/DKH.AgentRules/hooks" ]; then
        REAL_HOOK="$DIR/agents/DKH.AgentRules/hooks/$HOOK_FILE"
        if [ ! -f "$REAL_HOOK" ]; then
            exit 0
        fi
        SHEBANG=$(head -1 "$REAL_HOOK" 2>/dev/null || true)
        case "$SHEBANG" in
            *python*)
                run_python "$REAL_HOOK" "$@"
                ;;
            *bash*|*"/sh"|*"/sh "*)
                run_bash "$REAL_HOOK" "$@"
                ;;
            *)
                if [ -x "$REAL_HOOK" ]; then
                    exec "$REAL_HOOK" "$@"
                else
                    run_bash "$REAL_HOOK" "$@"
                fi
                ;;
        esac
    fi
    DIR=$(dirname "$DIR")
done

exit 0
