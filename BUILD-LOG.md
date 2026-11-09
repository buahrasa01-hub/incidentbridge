# Build log — IncidentBridge

Newest first. Direction decisions are Bayu's; implementation is built
with Muse as his coding tool under that direction (see README,
"Direction & ownership").

## 2026-11-09 — Full local build (no accounts yet)

Direction for the day (Bayu): start Codegeist with IncidentBridge as
the first portfolio entry; build as far as possible without any
Atlassian/Devpost account.

Done:
- **Engine v1** (`src/lib/consistency.js`): expanded the skeleton's
  3 claim patterns into 7 deterministic rules — completion, progress,
  blocked, not-reproducible, reopened, empty/placeholder summary, and
  stale date promises (cue-word gated; ISO + month-name formats;
  slash dates deliberately unsupported as locale-ambiguous). Findings
  carry a fix descriptor; the skeleton's verdict contract
  (consistent/verdict/claim/expectedCategory/suggestedAction) is
  preserved on top of the richer findings list.
- **API seam** (`src/lib/jiraClient.js`): all Jira/JSM REST behind one
  lazy-loaded `asUser()` transport with `setTransportForTests()`
  injection; ADF→text flattening; normalised issue shape shared with
  the engine. Added `@forge/api` 8.5.0 as a dependency.
- **Fix executor** (`src/lib/fixes.js`): transition (picks the real
  workflow transition into the claimed category; reports instead of
  throwing when none exists), summary reword (human edit wins over the
  engine suggestion; refuses to write an empty summary), JSM follow-up
  (first visible desk + request type, creates the request, links it
  back "Relates"), and the bounded project scan.
- **Resolvers** (`src/resolvers/index.js`): `analyzeIssue` reads the
  real issue from view context with a labelled fixture fallback;
  `applyFix` executes one chosen fix; `scanProject` powers the
  project page.
- **Panel UI** (`src/frontend/index.jsx`): verdict + per-finding
  explanations, fix buttons, an editable "Corrected summary" field for
  reword fixes, JSM follow-up button, post-fix re-check, and an honest
  "Demo data" banner when the fixture answered.
- **Project page** (`jira:projectPage` + `src/frontend/project.jsx`):
  DynamicTable of every drifted issue with reasons and offered fixes;
  EmptyState when the board is truthful.
- **Rovo** (`rovo:agent` + 3 `action` modules; handlers in
  `src/rovo.js`): agent prompt with three jobs (check / scan / fix)
  and honesty rules; fix action re-derives the offered fix from the
  issue's current state before writing. Manifest shapes verified
  against Atlassian's current module reference (module type is
  `action`; inputs carry title/type/required/description).
- **Scopes**: added `read:servicedesk-request` +
  `write:servicedesk-request` for the JSM fix (validated by lint).
- **Tests**: 44 node:test cases (engine rules × consistent/inconsistent,
  client over a fake transport, executor incl. JSM order-of-calls) —
  all passing via `npm test`. One real bug found and fixed by the
  suite: ADF block joining used the parent node's type instead of the
  children's (paragraph text runs were newline-split).
- **Checks**: ESLint clean; `forge lint` reports only the expected
  missing `app.id` (registration step, post-login).
- **Submission drafts**: `DEVPOST.md` (title, tagline, full
  description, category + both bonus write-ups, judge testing
  instructions) and `DEMO-SCRIPT.md` (7 scenes, ~2:45, with narration
  and recording setup).

Queued (blocked on Bayu's Atlassian account, exact commands in
README "Next steps"): `forge login` → `forge register` → `forge lint`
(expect clean) → `forge deploy` → `forge install` (jira, then
jira-servicedesk) → live run of the judging script → installation link
→ video → Marketplace listing submission → Devpost filing before
2026-12-23 03:00 WIB.

Human sanity-check items recorded in README "Design decisions":
status-category model, first-desk JSM default, date-format scope.

## 2026-11-09 (earlier) — Skeleton

- Scaffolded from Atlassian's official `jira-issue-panel-ui-kit`
  template zip (forge create needs login; the zip is served publicly).
- Renamed the panel module to IncidentBridge; scopes
  read/write:jira-work; planned modules documented as FORGE_ACTION_*
  comment seams in the manifest.
- `checkConsistency()` v0: 3 claim rules (fixed/resolved/done,
  wip/investigating, blocked/waiting) vs statusCategory; smoke-tested
  in plain Node. Panel rendered the verdict with a placeholder fix
  button.
- Toolchain: Forge CLI 15.0.0 installed (`--ignore-scripts` for
  keytar), LD_PRELOAD no-op-chown shim for the CLI's config writer,
  usage-analytics disabled for non-TTY shells.
