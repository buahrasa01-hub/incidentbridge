---
name: incidentbridge-consistency-checker
description: Check whether a Jira issue's summary agrees with its workflow status, scan a whole project for summary/status drift, and apply the fix the checker offers — use when a user asks whether an issue, board, or project tells the truth about its work.
allowed-tools: check-issue-consistency fix-issue-consistency scan-project-drift
---

# IncidentBridge consistency checker

A Jira issue has two voices: its summary, which humans read, and its
workflow status, which the process believes. When they disagree —
"Fixed crash on PDF export" still sitting in To Do — boards, standups
and reports quietly lie. This skill finds that drift and, when asked,
repairs it with the fix the checker itself offers.

Use this skill when the user asks whether an issue's summary matches
its status, wants a project scanned for drift, or wants drift fixed.
Do not use it for anything else: it cannot create issues, edit
workflows, or answer questions about anything but summary/status
consistency.

## Tools

All three tools are Forge actions of the IncidentBridge app, exposed
both to Rovo agents and as MCP tools on the app's Rovo MCP server
(`rovo:mcp` module, server name "IncidentBridge MCP"). They all run
as the invoking user, so the user's own Jira permissions gate every
read and write.

### `check-issue-consistency` (read-only)

Input: `issueKey` (e.g. `PROJ-123`). When the user is viewing an
issue, prefer that issue's key; otherwise ask for the key — never
guess one.

Returns `ok`, the issue's `summary`, `statusName` and
`statusCategory`, a boolean `consistent`, a one-line `verdict`, and
`findings`. Each finding names the `rule` that fired, the `claim`
(the exact summary words), a one-sentence `message`, and the
`suggestedFix` on offer (a short label, or `null`).

How to report it: quote the summary, name the status, then state the
verdict plainly. If there is drift, explain each finding in one
sentence and name the fix the checker offers. Never invent a summary,
status, or verdict — report only what the tool returned. If it
returns `ok: false`, relay the error and stop; do not guess a
workaround.

### `scan-project-drift` (read-only)

Input: `projectKey` (e.g. `PROJ`).

Returns `ok`, `scanned` (how many issues were checked),
`driftedCount`, and `drifted` — each entry with `issueKey`,
`summary`, `statusName`, and the finding messages.

How to report it: summarise how many issues were scanned and how
many drifted, then list the drifted issues with the reason for each.
A project with zero drifted issues is a clean bill of health — say
so, do not go looking for problems the scan did not find.

### `fix-issue-consistency` (writes — confirm first)

Inputs: `issueKey`, `fixKind` (`transition`, `reword-summary`, or
`link-jsm`), and `newSummary` (only for `reword-summary`, and only
when the user supplied corrected wording).

Workflow — always in this order:

1. Run `check-issue-consistency` on the issue first, so the offered
   fix is current. Only ever apply a fix kind the check offered for
   this issue right now.
2. Tell the user exactly which fix you are about to apply and wait
   for their confirmation whenever the conversation allows it. Never
   apply a fix the user did not ask for.
3. Invoke the tool. For `reword-summary`, pass the corrected summary
   as `newSummary` when the user gave one; otherwise omit it and the
   checker reuses its own suggestion.
4. Report the result in substance: what changed, or why the fix could
   not be applied. The tool fails safely — `ok: false` with an
   explanation — when the requested fix is not currently offered, or
   the workflow has no transition into the needed status. Relay that
   explanation; do not retry with a different fix kind unasked.

What each fix does:

- `transition` — moves the issue to the status its summary claims
  (the workflow transition the checker picked).
- `reword-summary` — rewrites the summary to match the status, using
  the checker's suggestion unless the user supplied better wording.
- `link-jsm` — creates a linked Jira Service Management follow-up
  request for the issue and links it back. The tool reports the new
  request key; quote it so the user can find it.

## Rules

- Check before fixing, every time. A fix offered an hour ago may no
  longer be offered — the tool re-checks at invocation time and
  refuses stale fixes.
- One issue at a time for fixes. A scan may list many drifted issues,
  but each fix is confirmed per issue.
- If any tool returns an error, relay it and stop. Never invent a
  workaround that writes data.
