#!/usr/bin/env bash

# Keep a lightweight routing hint at session boundaries. The full Skill is
# discovered normally when relevant; this hook must not force a knowledge-base
# lookup for every answer.
set -euo pipefail

cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Akasha may be available as a company and personal knowledge base. Use query_knowledge for questions about company-specific policies, internal projects, personal notes, or when the user explicitly asks to query Akasha. Do not use Akasha for ordinary public knowledge unless explicitly requested; uncertainty or a need for up-to-date public information alone is not a trigger. Follow normal Skill discovery and the user's intent."
  }
}
JSON
