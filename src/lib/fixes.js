// ---------------------------------------------------------------------------
// IncidentBridge — fix executor
//
// The consistency engine (consistency.js) only *describes* fixes; this
// module performs them. A fix runs only when a human presses a button
// in the panel, or when a Rovo agent action is invoked with an explicit
// fix request — never automatically, never on a scan.
//
// Fix descriptors come straight from a finding:
//   { kind: 'transition',    toCategory: 'done' | 'indeterminate' | 'new' }
//   { kind: 'reword-summary', suggestedSummary: string | null }
// plus one fix that is not tied to a single finding:
//   { kind: 'link-jsm' } — open a linked JSM follow-up request.
//
// applyFix(client, issueKey, fix, extras) takes the API client as its
// first argument (dependency injection), so the whole executor is
// unit-testable with the fake transport from jiraClient.js.
// `extras.summary` supplies the final wording for a reword fix when the
// human edited the engine's suggestion in the panel.
// ---------------------------------------------------------------------------

/**
 * Applies one fix to one issue.
 * @returns {Promise<{applied: boolean, kind: string, detail: string,
 *                    newIssueKey?: string}>}
 *   `applied: false` is returned (not thrown) for the expected,
 *   user-actionable dead ends — e.g. the workflow simply has no
 *   transition into the needed category. Transport/API failures throw
 *   JiraApiError from the client layer.
 */
export async function applyFix(client, issueKey, fix, extras = {}) {
  if (!fix || !fix.kind) {
    throw new Error('applyFix requires a fix descriptor with a kind.');
  }

  if (fix.kind === 'transition') {
    const transitions = await client.getTransitions(issueKey);
    const chosen = client.pickTransitionToCategory(transitions, fix.toCategory);
    if (!chosen) {
      return {
        applied: false,
        kind: fix.kind,
        detail:
          `No workflow transition into a "${fix.toCategory}" status is available ` +
          `from the current status (offered: ${transitions.map((t) => t.toName).join(', ') || 'none'}). ` +
          'A human needs to move this issue manually.',
      };
    }
    await client.transitionIssue(issueKey, chosen.id);
    return {
      applied: true,
      kind: fix.kind,
      detail: `Transitioned ${issueKey} via "${chosen.name}" to "${chosen.toName}" (${fix.toCategory}).`,
    };
  }

  if (fix.kind === 'reword-summary') {
    const summary = (extras.summary || fix.suggestedSummary || '').trim();
    if (!summary) {
      return {
        applied: false,
        kind: fix.kind,
        detail:
          'No summary text was provided and the engine had no suggestion to apply. ' +
          'Provide the corrected summary text and try again.',
      };
    }
    await client.updateSummary(issueKey, summary);
    return {
      applied: true,
      kind: fix.kind,
      detail: `Rewrote the summary of ${issueKey} to: "${summary}".`,
    };
  }

  if (fix.kind === 'link-jsm') {
    // Discover the first visible service desk and its first request
    // type. A production multi-desk picker belongs in app settings;
    // for a single-site app the first desk is the honest default, and
    // the detail string reports exactly which desk was used.
    const desks = await client.getServiceDesks();
    if (desks.length === 0) {
      return {
        applied: false,
        kind: fix.kind,
        detail: 'No Jira Service Management service desk is visible to this user, so no follow-up request can be created.',
      };
    }
    const desk = desks[0];
    const types = await client.getRequestTypes(desk.id);
    if (types.length === 0) {
      return {
        applied: false,
        kind: fix.kind,
        detail: `Service desk "${desk.name}" has no request types, so no follow-up request can be created.`,
      };
    }
    const issue = await client.getIssue(issueKey);
    const created = await client.createServiceDeskRequest({
      serviceDeskId: desk.id,
      requestTypeId: types[0].id,
      summary: `Follow-up for ${issueKey}: ${issue.summary}`,
      descriptionText:
        `Created by IncidentBridge from ${issueKey}. The Jira issue's summary ` +
        'and workflow status disagree; this request tracks the follow-up with ' +
        'the service team.',
    });
    await client.linkIssues(created.key, issueKey, 'Relates');
    return {
      applied: true,
      kind: fix.kind,
      newIssueKey: created.key,
      detail: `Created JSM request ${created.key} on desk "${desk.name}" (${types[0].name}) and linked it to ${issueKey}.`,
    };
  }

  throw new Error(`Unknown fix kind: ${fix.kind}`);
}

/**
 * Scans a whole project for drift: fetches issues (bounded by the
 * client's search cap) and runs the engine over each one.
 * @returns {Promise<{projectKey, scanned, drifted: Array}>}
 *   Each drifted entry: { issue, findings, verdict }.
 */
export async function scanProject(client, checkConsistencyFn, projectKey, options = {}) {
  const issues = await client.searchIssues(`project = ${projectKey} ORDER BY updated DESC`, options);
  const drifted = [];
  for (const issue of issues) {
    const result = checkConsistencyFn(issue, options);
    if (!result.consistent) {
      drifted.push({ issue, findings: result.findings, verdict: result.verdict });
    }
  }
  return { projectKey, scanned: issues.length, drifted };
}
