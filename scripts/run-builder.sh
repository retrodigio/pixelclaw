#!/bin/bash
# Launch a builder session INSIDE this repo so the clean-room settings and guard hook apply.
# Subagents spawned from a reader session inherit the reader's settings, so builders must be
# separate sessions started here. Deny rules and the guard hook still apply in bypass mode;
# MCP servers are disabled because global ones (code indexers) can reach the reference.
#   scripts/run-builder.sh <log-name> "<prompt>"
# If the run stops on a usage/session limit, the same session is resumed every 15 minutes
# (up to 12 hours) until it finishes. Each attempt appends to logs/<log-name>.jsonl.
set -uo pipefail
cd "$(dirname "$0")/.."
name="$1"; shift
mkdir -p logs
log="logs/$name.jsonl"
common=(-p --permission-mode bypassPermissions --strict-mcp-config --mcp-config .claude/no-mcp.json --output-format stream-json --verbose)

limited() {
  tail -n 3 "$log" | grep -qiE "hit your (session|usage) limit|usage limit reached|rate limit|resets [0-9]"
}

claude "${common[@]}" -- "$*" < /dev/null > "$log" 2>&1
sid=$(grep -o '"session_id":"[^"]*"' "$log" | head -1 | cut -d'"' -f4)
tries=0
while limited && [ -n "$sid" ] && [ $tries -lt 48 ]; do
  tries=$((tries + 1))
  echo "{\"type\":\"wrapper\",\"note\":\"limit hit; retry $tries in 15 min\",\"at\":\"$(date -u +%FT%TZ)\"}" >> "$log"
  sleep 900
  claude "${common[@]}" --resume "$sid" -- "You were interrupted by a usage limit. Check git status and git log to see where you got to, then continue the original task to completion and finish with the report it asked for." < /dev/null >> "$log" 2>&1
done
