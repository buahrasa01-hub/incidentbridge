import Resolver from '@forge/resolver';
import { checkConsistency } from '../lib/consistency.js';
import * as jira from '../lib/jiraClient.js';
import { applyFix, scanProject } from '../lib/fixes.js';

// ---------------------------------------------------------------------------
// IncidentBridge — backend resolvers
//
// One brain, three surfaces: the issue panel, the project page and the
// Rovo agent actions (src/rovo.js) all end up calling the same engine
// (src/lib/consistency.js) and the same fix executor (src/lib/fixes.js)
// through the API seam in src/lib/jiraClient.js.
//
// Reads and writes run asUser() (inside jiraClient), so Jira enforces
// the viewing user's permissions on everything the app does.
//
// Until the app is registered/deployed on a real site the resolvers
// cannot reach a live Jira; analyzeIssue then answers from the demo
// fixture below and says so (source: 'fixture'), so the panel and the
// demo story stay honest before an account exists.
// ---------------------------------------------------------------------------

// Demo fixture: the classic silent drift — summary claims the fix is
// in, the workflow never moved. Used ONLY as a fallback when the live
// read fails (pre-registration local runs); live reads are the norm.
const SAMPLE_ISSUE = {
  key: 'DEMO-42',
  summary: 'Fixed crash on PDF export',
  descriptionText: 'Exporting a report to PDF crashes the renderer.',
  statusName: 'To Do',
  statusCategory: 'new',
  projectKey: 'DEMO',
};

const resolver = new Resolver();

// FORGE_ACTION_ANALYZE — the panel asks: "does this issue's summary
// agree with its status?" Answers with the normalised issue, the full
// findings list and the engine verdict.
resolver.define('analyzeIssue', async (req) => {
  const issueKey =
    (req.payload && req.payload.issueKey) ||
    (req.context && req.context.extension && req.context.extension.issue
      ? req.context.extension.issue.key
      : null);
  if (!issueKey) {
    return { source: 'fixture', issue: SAMPLE_ISSUE, ...checkConsistency(SAMPLE_ISSUE) };
  }
  try {
    const issue = await jira.getIssue(issueKey);
    return { source: 'live', issue, ...checkConsistency(issue) };
  } catch (error) {
    // No live site yet (or a transient API failure): fall back to the
    // fixture and label it, rather than rendering a broken panel.
    console.warn(`analyzeIssue: live read failed for ${issueKey}: ${error.message}`);
    return {
      source: 'fixture',
      issue: { ...SAMPLE_ISSUE, key: issueKey },
      ...checkConsistency(SAMPLE_ISSUE),
    };
  }
});

// FORGE_ACTION_APPLY_FIX — performs exactly one fix the human picked in
// the panel: { issueKey, fix, summary? }. The fix descriptor comes from
// a finding produced by analyzeIssue (or is the standalone 'link-jsm').
// Returns the executor's { applied, detail } result for display.
resolver.define('applyFix', async (req) => {
  const { issueKey, fix, summary } = req.payload || {};
  if (!issueKey || !fix) {
    return { applied: false, detail: 'Missing issueKey or fix in the request.' };
  }
  try {
    return await applyFix(jira, issueKey, fix, { summary });
  } catch (error) {
    return { applied: false, detail: `Fix failed: ${error.message}` };
  }
});

// FORGE_ACTION_CHECK_PROJECT — the project page asks for every drifted
// issue in the project. Bounded by the client's search cap.
resolver.define('scanProject', async (req) => {
  const projectKey =
    (req.payload && req.payload.projectKey) ||
    (req.context && req.context.extension && req.context.extension.project
      ? req.context.extension.project.key
      : null);
  if (!projectKey) {
    return { projectKey: null, scanned: 0, drifted: [], detail: 'No project key in context.' };
  }
  const result = await scanProject(jira, checkConsistency, projectKey);
  return { ...result, detail: `Scanned ${result.scanned} issues in ${projectKey}; ${result.drifted.length} drifted.` };
});

export const handler = resolver.getDefinitions();
