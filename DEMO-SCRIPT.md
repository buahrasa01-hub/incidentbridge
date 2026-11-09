# Demo video script — IncidentBridge (target ≤ 3:00)

Rules limits: under 5 minutes, public on YouTube, no third-party
trademarks or unlicensed music. This script runs ~2:45 at a calm pace.
Narration is written to be read aloud (or captioned verbatim).

**Setup before recording:** dev site with a demo project `DEMO`
(default workflow) and these pre-created issues:
- DEMO-42 "Fixed crash on PDF export" — To Do
- DEMO-43 "Investigating the export crash" — Done
- DEMO-44 "Cannot reproduce on staging" — In Progress
- DEMO-45 "Export revamp due 2020-01-01" — To Do
- DEMO-46 (summary "TODO", description "Exporting a report to PDF
  crashes the renderer when the file has embedded fonts.") — To Do
- A handful of clean issues (truthful summaries) so the scan table is
  believable. Rovo enabled on the site; one JSM service desk exists.

---

### Scene 1 — The lie (0:00–0:25)
**Screen:** Jira board of DEMO; slow pan across columns. DEMO-42 sits in
To Do under the title "Fixed crash on PDF export".
**Narration:** "This is a healthy-looking Jira board. And it is lying.
This card says the crash is *fixed* — but the workflow says nobody has
even started it. Every Jira issue has two voices: the summary humans
read, and the status the process believes. When they drift apart,
standups, dashboards and reports quietly stop telling the truth."

### Scene 2 — The verdict on the issue (0:25–0:55)
**Screen:** Open DEMO-42. Scroll to the IncidentBridge panel: warning
verdict, finding "Summary claims work is finished ('Fixed') but the
status category is 'new'", fix button visible.
**Narration:** "IncidentBridge checks the bridge between the two.
Inside the issue, the panel compares what the summary claims with the
status *category* — the one thing that means the same in every
workflow. Here the verdict is unambiguous: the summary claims the work
is finished; the workflow disagrees. And notice — this is a
deterministic rule engine, not an AI guess. Same issue, same verdict,
every time."

### Scene 3 — One click repairs it (0:55–1:20)
**Screen:** Click **Move issue to a "done" status**. The issue
transitions; the panel re-checks and flips to the green "Consistent"
message.
**Narration:** "Every finding comes with its safe repair. One click
moves the issue through the workflow's own transition — and the panel
immediately re-checks, so what you see is the issue's real state, not
a cached promise. Fixes only ever happen on a human click."

### Scene 4 — Words can be the broken side (1:20–1:50)
**Screen:** Open DEMO-43 (Done, "Investigating the export crash").
Panel offers the reword with "Crash on PDF export"-style text
pre-filled in the Corrected summary field. Click apply.
Then quick cuts: DEMO-44 (not reproducible, In Progress) and DEMO-45
(past due date) panels.
**Narration:** "Sometimes the workflow is right and the words are
stale. Here the work *is* done, so IncidentBridge offers a corrected
summary instead — pre-filled, editable, applied on click. The same
engine catches work declared 'not reproducible' still sitting in
progress, and promises whose dates have already passed."

### Scene 5 — The whole project, ten seconds (1:50–2:15)
**Screen:** Project sidebar → IncidentBridge project page. Drift table
with the remaining findings; the scanned/drifted counts at the top.
**Narration:** "Zoom out, and the project page lists every drifted
issue in the project — the ten-second truth check a team lead runs
before standup."

### Scene 6 — The agent (2:15–2:40)
**Screen:** Rovo chat with the IncidentBridge agent. Type: "Scan the
DEMO project for drift." Show the agent's summary. Then: "Fix the
drift on DEMO-44." Show it naming the fix, then reporting the result.
Cut back to DEMO-44 — status updated.
**Narration:** "And the same brain works in chat. The IncidentBridge
Rovo agent checks issues, scans projects and applies fixes — but
safely: before writing anything, the fix action re-runs the check and
only applies a repair the engine offers *right now*. Agents propose;
the engine disposes. The actions are standard Forge actions, so any
other agent can reuse them as tools."

### Scene 7 — Close (2:40–2:50)
**Screen:** Back to the board; DEMO-42 now in Done; panel green.
**Narration:** "IncidentBridge: deterministic drift detection for
Jira — on the issue, across the project, and inside Rovo. So your
board can stop lying."
**End card (text):** IncidentBridge — Codegeist 2026 · Built on
Atlassian Forge (Jira + JSM + Rovo)

---

**Recording notes**
- Keep each click deliberate; let panels finish loading before
  narrating over them.
- If Rovo is unavailable on the recording site, Scene 6 can be shot
  against the agent's conversation starters; do not fake agent output —
  if the agent cannot be recorded, drop Scene 6 and extend Scene 5
  with the DEMO-46 empty-summary repair instead.
