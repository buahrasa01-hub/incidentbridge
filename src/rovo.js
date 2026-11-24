import { checkConsistency } from './lib/consistency.js';
import * as jira from './lib/jiraClient.js';
import { applyFix, scanProject } from './lib/fixes.js';
import {
  getIssueGraphEvidence,
  enrichCheckWithGraph,
} from './lib/teamworkGraph.js';

// ---------------------------------------------------------------------------
// IncidentBridge — Rovo action handlers
//
// These are the Forge functions behind the `action` modules declared in
// manifest.yml. The IncidentBridge agent (rovo:agent) invokes them, and
// because they are plain actions, any other Rovo agent a customer
// builds can invoke them too — the same brain the issue panel uses,
// exposed as reusable tools.
//
// Action functions receive (payload, context): payload carries the
// inputs declared in the manifest plus, in issue contexts, a
// deterministic context object (payload.context.jira.issueKey). Inputs
// come from an LLM extraction, so every handler validates them and
// falls back to the deterministic context value where one exists.
// Handlers return plain JSON; the agent turns it into natural language.
//
// Actions run with the invoking user's context; the API client uses
// asUser(), so the user's Jira permissions gate every read and write.
// ---------------------------------------------------------------------------

function resolveIssueKey(payload) {
  return (
    (payload && payload.issueKey) ||
    (payload && payload.context && payload.context.jira && payload.context.jira.issueKey) ||
    null
  );
}

/**
 * action: check-issue-consistency (GET, read-only)
 * Input: issueKey. Returns the engine verdict for one issue,
 * enriched with Teamwork Graph evidence (linked pull requests,
 * deployments, goals) when the graph is reachable — a successful
 * deployment linked to the issue is independent corroboration that
 * the work shipped, even if the workflow never moved. A graph
 * failure never fails the action: the engine-only verdict is
 * returned with graph.available false.
 */
export async function checkIssueConsistency(payload, context) {
  const issueKey = resolveIssueKey(payload);
  if (!issueKey) {
    return { ok: false, error: 'No issue key was provided and none was found in the context.' };
  }
  const issue = await jira.getIssue(issueKey);
  const result = checkConsistency(issue);
  let enriched = result;
  try {
    const evidence = await getIssueGraphEvidence({
      cloudId: context && context.cloudId,
      issueId: issue.id,
    });
    enriched = enrichCheckWithGraph(issue, result, evidence);
  } catch (error) {
    console.warn(
      `checkIssueConsistency: Teamwork Graph enrichment failed for ${issueKey}: ${error.message}`,
    );
    enriched = { ...result, graph: { available: false, reason: 'graph-error' } };
  }
  return {
    ok: true,
    issueKey: issue.key,
    summary: issue.summary,
    statusName: issue.statusName,
    statusCategory: issue.statusCategory,
    consistent: enriched.consistent,
    verdict: enriched.verdict,
    findings: enriched.findings.map((f) => ({
      rule: f.rule,
      claim: f.claim,
      message: f.message,
      suggestedFix: f.fix ? f.fix.label : null,
    })),
    graph: enriched.graph || { available: false, reason: 'graph-unavailable' },
  };
}

/**
 * action: fix-issue-consistency (UPDATE)
 * Inputs: issueKey, fixKind ('transition' | 'reword-summary' |
 * 'link-jsm'), newSummary (required for reword-summary when the engine
 * has no suggestion to reuse).
 *
 * The action re-runs the check first and applies the fix that matches
 * the requested kind from the *actual* findings — it never applies a
 * fix the engine did not offer for the issue's current state, so a
 * stale or hallucinated request fails safely instead of writing.
 * The re-run includes the Teamwork Graph enrichment (best-effort, so
 * a graph-only fix the check offered stays applicable here too).
 */
export async function fixIssueConsistency(payload, context) {
  const issueKey = resolveIssueKey(payload);
  const fixKind = payload && payload.fixKind;
  if (!issueKey || !fixKind) {
    return { ok: false, error: 'Both issueKey and fixKind are required.' };
  }
  if (fixKind === 'link-jsm') {
    const result = await applyFix(jira, issueKey, { kind: 'link-jsm' });
    return { ok: result.applied, issueKey, ...result };
  }
  const issue = await jira.getIssue(issueKey);
  const result = checkConsistency(issue);
  let enriched = result;
  try {
    const evidence = await getIssueGraphEvidence({
      cloudId: context && context.cloudId,
      issueId: issue.id,
    });
    enriched = enrichCheckWithGraph(issue, result, evidence);
  } catch (error) {
    console.warn(
      `fixIssueConsistency: Teamwork Graph enrichment failed for ${issueKey}: ${error.message}`,
    );
  }
  const finding = enriched.findings.find((f) => f.fix && f.fix.kind === fixKind);
  if (!finding) {
    return {
      ok: false,
      issueKey,
      error: `No "${fixKind}" fix is currently offered for ${issueKey} (consistent: ${enriched.consistent}).`,
    };
  }
  const applied = await applyFix(jira, issueKey, finding.fix, {
    summary: payload.newSummary,
  });
  return { ok: applied.applied, issueKey, rule: finding.rule, ...applied };
}

/**
 * action: scan-project-drift (GET, read-only)
 * Input: projectKey. Returns every drifted issue in the project with
 * its findings, so an agent can brief a team on where the board lies.
 */
export async function scanProjectDrift(payload) {
  const projectKey =
    (payload && payload.projectKey) ||
    (payload && payload.context && payload.context.jira && payload.context.jira.projectKey) ||
    null;
  if (!projectKey) {
    return { ok: false, error: 'No project key was provided.' };
  }
  const result = await scanProject(jira, checkConsistency, projectKey);
  return {
    ok: true,
    projectKey: result.projectKey,
    scanned: result.scanned,
    driftedCount: result.drifted.length,
    drifted: result.drifted.map((d) => ({
      issueKey: d.issue.key,
      summary: d.issue.summary,
      statusName: d.issue.statusName,
      findings: d.findings.map((f) => f.message),
    })),
  };
}
