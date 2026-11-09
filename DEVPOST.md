# Devpost submission draft — IncidentBridge

> Draft for the Codegeist 2026 "Enter a Submission" form. All fields in
> English (submission requirement). Bracketed items are filled in after
> Bayu's accounts exist (installation link, video URL).

## Title

IncidentBridge

## Tagline

Your Jira board is lying to you — IncidentBridge catches issue summaries that contradict their workflow status, explains the drift, and fixes it in one click.

## Project description

### The problem

Every Jira issue speaks with two voices. The **summary** is what humans
read in standups, boards, release notes and stakeholder reports. The
**workflow status** is what the process believes. Over a project's life
these two voices quietly drift apart:

- "Fixed crash on PDF export" — still sitting in **To Do**.
- "Investigating the login timeout" — already **Done**; the summary was
  never updated.
- "Cannot reproduce on staging" — sitting in **In Progress**, where
  nobody can act on it.
- "Payments revamp due 2026-11-01" — still open in **December**.

No dashboard warns about any of this, because every tool trusts both
fields. The result is not a crash — it is a slow tax on every standup,
every report and every planning session: people act on summaries that
are no longer true. It is the classic broken bridge between what a team
*said* (the tracker text — the "incident" record) and what is actually
*happening* (the workflow state).

### The solution

**IncidentBridge** is a Forge app that continuously checks the bridge
between summary and status:

1. **Deterministic consistency engine.** A pure-function rule engine
   compares what a summary *claims* against the issue's status
   **category** (`new` / `indeterminate` / `done` — stable across every
   workflow, unlike status names). Seven defensible rules: completion
   claims, progress claims, blocked claims, not-reproducible claims,
   reopened claims, empty/placeholder summaries, and date promises that
   have already passed. No LLM, no guessing: the same issue always
   produces the same verdict, which is exactly what a trust tool needs.

2. **A verdict where the work happens.** A Jira **issue panel** shows
   the verdict on the issue itself, with every finding explained in one
   sentence — and the fix attached to it.

3. **One-click fixes, human-confirmed.** Each finding offers its safe
   repair, executed only on an explicit click:
   - *Transition* the issue to the status category its summary claims
     (chosen from the workflow's real transitions — if the workflow
     offers no path, the app says so instead of failing silently);
   - *Rewrite the summary* — the engine proposes a corrected summary
     (claim wording stripped, or drafted from the description for empty
     summaries) that the user can edit before applying;
   - *Create a linked JSM follow-up* — a Jira Service Management request
     is created and linked to the issue, so drift that needs a service
     team becomes tracked work instead of a comment thread.

4. **A project-wide drift scan.** A **project page** lists every drifted
   issue in the project in one table — the pre-standup truth check a
   lead can run in ten seconds.

5. **The same brain, as a Rovo agent.** IncidentBridge ships a
   **Rovo agent** plus three reusable **actions** (`check-issue-consistency`,
   `fix-issue-consistency`, `scan-project-drift`). Ask in chat: *"Scan
   the PAYMENTS project for drift"* or *"Fix the drift on PROJ-123"*.
   Because the actions are standard Forge actions, **any other agent** —
   including customer-built ones — can invoke the same check as a tool.
   The fix action is safe by construction: it re-runs the check and
   only applies a fix the engine currently offers, so a stale or
   hallucinated request fails safely instead of writing bad data.

### How it is built (Forge modules used)

| Surface | Forge module | What it does |
|---|---|---|
| Issue panel | `jira:issuePanel` (UI Kit) | Verdict + findings + fix buttons on the issue |
| Project page | `jira:projectPage` (UI Kit) | Whole-project drift table (DynamicTable) |
| Agent | `rovo:agent` | IncidentBridge agent with three jobs: check, scan, fix |
| Agent tools | `action` × 3 | check-issue-consistency (GET), fix-issue-consistency (UPDATE), scan-project-drift (GET) |
| Backend | `function` (resolvers + action handlers) | Shared engine, fix executor, REST client |

All product calls go through one client (`src/lib/jiraClient.js`) using
`api.asUser().requestJira(...)`, so Jira's own permission checks gate
every read and write; the app never acts with broader rights than the
person using it. The engine (`src/lib/consistency.js`) is a pure module
with a 44-case test suite (rules, REST client over a fake transport,
fix executor) that runs with `npm test` — no site needed.

### Why this matters

Summary/status drift is invisible precisely because it is mundane: no
error is thrown, nobody is paged, the board just slowly stops meaning
what it says. IncidentBridge makes that drift visible at the moment and
place it can be fixed — on the issue, in the project, or in a chat with
an agent — and removes the toil of repairing it. It is deliberately
deterministic: teams will only trust an automated consistency checker
if it never cries wolf, and every rule here can be explained in one
sentence.

## Category

**Apps for Software Teams**

## Bonus prize write-ups

### Best Agents (Rovo)

IncidentBridge is agent-native in both directions. It **ships an
agent**: a `rovo:agent` whose prompt defines three jobs (check one
issue, scan a project, fix drift with confirmation) and strict honesty
rules — it may only report what its actions return, and must relay
action errors instead of inventing workarounds. And it **feeds other
agents**: its three `action` modules are reusable tools any Rovo agent
can call, including agents customers build themselves. The safety
design is the point: `fix-issue-consistency` re-derives the offered
fix from the issue's *current* state at invocation time, so an agent
can never apply a repair the deterministic checker has not just
approved. Agents propose; the engine disposes.

### Best Marketplace published app

IncidentBridge is built to Marketplace standards from day one: a single
deterministic engine with a real test suite, minimal scopes
(`read/write:jira-work`, `read/write:servicedesk-request`), asUser
permission discipline, and a use case every Jira customer recognises.
[Marketplace listing / review-ticket link: INSERT after submission for
listing.] The app runs consistently when installed from its sharing
link, and this Devpost page documents the full testing instructions a
reviewer or judge needs.

## Testing / configuration instructions for judges

No configuration, API keys or external services are required.

1. Open the installation link: [INSERT INSTALLATION LINK] and install
   IncidentBridge into a Jira Cloud site (Jira Software; Jira Service
   Management is only needed for the "Create linked JSM follow-up"
   button).
2. In any project, create or open these issues to see each rule fire
   (statuses refer to the default workflow: To Do / In Progress / Done):
   - Summary `Fixed crash on PDF export`, status **To Do** → open the
     issue; the IncidentBridge panel reports a completion-claim drift
     and offers **Move issue to a "done" status**. Click it: the issue
     transitions, and the panel re-checks to "Consistent".
   - Summary `Investigating the export crash`, status **Done** → panel
     offers a summary **reword** with the corrected text pre-filled
     ("Crash on PDF export" style). Edit or accept and apply.
   - Summary `Cannot reproduce on staging`, status **In Progress** →
     not-reproducible drift; offered fix moves it toward Done.
   - Summary `Export revamp due 2020-01-01` (any past date), status
     **To Do** → stale-date-promise drift.
   - An issue with an empty or `TODO` summary → empty-summary drift;
     if the description's first sentence describes the work, the panel
     pre-fills it as the proposed summary.
3. Open the project's **IncidentBridge page** (project sidebar) to see
   the whole-project drift table.
4. In Rovo chat, select the **IncidentBridge** agent (or use the
   conversation starters): ask it to check the issue from step 2, to
   scan the project, then to fix the drift on the first issue. It will
   name the fix before applying it and report the result.
5. (Optional, JSM) On a drifted issue, click **Create linked JSM
   follow-up**: a request is created on the first visible service desk
   and linked back to the issue.

## How it meets the main technology requirement

IncidentBridge is a new app built entirely on **Atlassian Forge**: it
has a Forge manifest with six module types (`jira:issuePanel`,
`jira:projectPage`, `rovo:agent`, `action`, plus `function` backends
and UI Kit resources), integrates **Jira** (issue reads, transitions,
edits, search, links), **Jira Service Management** (service-desk
request creation), and **Rovo** (a shipped agent plus reusable
actions). All logic runs in Forge functions; the frontend is pure
UI Kit (`@forge/react`).

## Built with

Atlassian Forge · Forge UI Kit (@forge/react) · @forge/api ·
@forge/resolver · @forge/bridge · Rovo (agent + actions) ·
Jira Cloud REST API · Jira Service Management REST API · Node.js 24

## Links

- Installation link: [INSERT]
- Demo video (YouTube, public): [INSERT]
- Source repository: [INSERT if published]
