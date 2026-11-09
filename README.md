# IncidentBridge

**Codegeist 2026 entry — Category: Apps for Software Teams.**
Bonus targets: **Best Agents (Rovo)** and **Best Marketplace published
app** (one Grand + one Bonus is the maximum a single submission can
win; both write-ups are drafted in `DEVPOST.md`).

**Pitch:** Jira issue summaries and workflow statuses drift apart
silently ("Fixed crash on export" still sitting in To Do).
IncidentBridge checks the summary against the status with a
deterministic rule engine, shows the verdict where the work happens
(issue panel, project page, Rovo chat), offers a one-click,
human-confirmed fix for every finding, and exposes the same check to
other agents as reusable Forge actions.

**Direction & ownership:** This project is entered by **Bayu Luqman
Fadilah** (solo entrant, Indonesia), who directs the project: he chose
the competition and category, set the product direction (a
deterministic checker, not an LLM guesser; fixes only on explicit
human confirmation), and owns the Atlassian/Devpost accounts, the
deployment, and the final submission. Implementation work is carried
out with an AI coding assistant (Muse) acting as his build tool,
under his direction; design decisions, prompts and review checkpoints
are recorded in this repository (`BUILD-LOG.md`, `../PREP.md`) so the
entrant can describe and defend every part of the submission as his
own work product.

## What is built

| Piece | File(s) | State |
|---|---|---|
| Consistency engine (7 rules, pure, deterministic) | `src/lib/consistency.js` | ✅ done, tested |
| Jira/JSM API client (single mockable seam, asUser) | `src/lib/jiraClient.js` | ✅ done, tested |
| Fix executor (transition / reword / JSM follow-up / project scan) | `src/lib/fixes.js` | ✅ done, tested |
| Issue panel backend (analyzeIssue, applyFix, scanProject resolvers) | `src/resolvers/index.js` | ✅ done |
| Issue panel UI (verdict, findings, fix buttons, summary editor) | `src/frontend/index.jsx` | ✅ done |
| Project page UI (drift table) | `src/frontend/project.jsx` | ✅ done |
| Rovo agent + 3 actions (check / fix / scan) | `manifest.yml`, `src/rovo.js` | ✅ done |
| Test suite — 44 tests, `npm test` | `test/` | ✅ passing |
| Devpost text + demo script | `DEVPOST.md`, `DEMO-SCRIPT.md` | ✅ drafted |

Checks at last build (2026-11-09): `npm test` 44/44 pass; ESLint clean
(`npm run lint`); `forge lint` reports **only** the expected
"app must have required property 'id'" — the manifest has no `app.id`
until `forge register` stamps a real one after login. **Do not invent
an id.**

## Design decisions (the ones a judge — or Bayu — should sanity-check)

1. **Status categories, not status names.** Rules compare claims
   against `statusCategory` (`new`/`indeterminate`/`done`), so the
   engine works on any workflow without configuration.
2. **Deterministic over clever.** Seven narrow rules, each explainable
   in one sentence. Slash-format dates are deliberately unsupported
   (03/04 is ambiguous across locales); bare dates without a promise
   cue ("by", "due", "deadline"…) do not fire. A drift detector that
   cries wolf is worse than the drift.
3. **Which side moves is decided by the workflow.** If the issue is
   already Done, the words are stale → reword fix. Otherwise the claim
   is the fresher fact → transition fix. The engine never does
   mid-sentence text surgery: reword suggestions only strip a leading
   claim phrase, or draft from the description's first sentence.
4. **Fixes are explicit and re-validated.** Nothing writes
   automatically. The Rovo fix action re-runs the check at invocation
   time and only applies a fix the engine currently offers.
5. **asUser everywhere.** No `asApp()` calls; Jira's own permissions
   gate every read/write. Minimal scopes: `read/write:jira-work`,
   `read/write:servicedesk-request`.
6. **JSM follow-up uses the first visible service desk/request type.**
   Honest default for a single-site app; a desk picker belongs in app
   settings if this grows. The created request is linked back with a
   "Relates" issue link.
7. **Fixture fallback is labelled.** Before the app is deployed, the
   panel answers from a demo fixture and displays a "Demo data" banner
   (`source: 'fixture'`) rather than pretending to read a live issue.

## Layout

```
manifest.yml              Forge modules: issuePanel, projectPage,
                          rovo:agent, 3× action, functions, scopes
src/index.js              Function entry (resolver handler)
src/resolvers/index.js    Panel/project-page backend
src/rovo.js               Rovo action handlers
src/lib/consistency.js    The engine (pure — read this first)
src/lib/jiraClient.js     REST client + setTransportForTests seam
src/lib/fixes.js          Fix executor + project scan (DI over client)
src/frontend/index.jsx    Issue panel UI (UI Kit only)
src/frontend/project.jsx  Project page UI (UI Kit only)
test/                     node:test suites (engine, client, executor)
DEVPOST.md                Submission text (draft)
DEMO-SCRIPT.md            ≤3-minute demo video script
BUILD-LOG.md              What was done, when, and what is queued
```

## Commands

```sh
npm test          # 44 tests, plain Node, no site needed
npm run lint      # ESLint over src/
export LD_PRELOAD=/tmp/no_chown.so   # VM quirk, see below
forge lint        # expect ONLY the app.id error until registration
```

## Next steps — blocked on Bayu's Atlassian account (exact queue)

```sh
# On the VM, in this directory, with the LD_PRELOAD shim loaded:
forge login        # Bayu's Atlassian email + API token (his hand)
forge register     # stamps the real app.id into manifest.yml
forge lint         # expect: zero errors
forge deploy --non-interactive
forge install --non-interactive --site <dev-site> --product jira
# JSM follow-up needs the app installed on the JSM product of the
# same site as well:
forge install --non-interactive --site <dev-site> --product jira-servicedesk
```

Then: run the DEVPOST.md judging script live on the dev site, record
the video per DEMO-SCRIPT.md, create the Forge installation link,
(optionally) submit the Marketplace listing early for the bonus, and
file the Devpost submission **before 2026-12-23 03:00 WIB**.

## Provenance & VM quirks

- Scaffolded 2026-11-09 from Atlassian's official
  `jira-issue-panel-ui-kit` template (MIT). The template zip was
  fetched from Atlassian's public template service because
  `forge create` itself requires a logged-in account (it registers
  the app server-side). `manifest.template-original.yml` keeps the
  pristine template manifest for diffing; `AGENTS.md` in this
  directory is the template's Forge coding guidance and governs work
  here.
- Forge CLI 15.0.0 lives at
  `~/workspace/tools/forge/node_modules/.bin/forge` (installed with
  `--ignore-scripts`; the native keytar build fails on this VM for
  lack of libsecret, and keytar is optional).
- The VM forbids `chown`, which crashes the CLI's config writer.
  Shim (`/tmp` does not survive VM replacement — rebuild when forge
  dies with EPERM):
  ```sh
  cat > /tmp/no_chown.c <<'C'
  #define _GNU_SOURCE
  #include <sys/types.h>
  #include <unistd.h>
  int chown(const char*p,uid_t o,gid_t g){(void)p;(void)o;(void)g;return 0;}
  int lchown(const char*p,uid_t o,gid_t g){(void)p;(void)o;(void)g;return 0;}
  int fchown(int f,uid_t o,gid_t g){(void)f;(void)o;(void)g;return 0;}
  int fchownat(int d,const char*p,uid_t o,gid_t g,int fl){(void)d;(void)p;(void)o;(void)g;(void)fl;return 0;}
  C
  cc -shared -fPIC -o /tmp/no_chown.so /tmp/no_chown.c
  ```
- Per fresh HOME, run once:
  `forge settings set usage-analytics false` (otherwise the CLI blocks
  on an interactive analytics prompt in non-TTY shells).
