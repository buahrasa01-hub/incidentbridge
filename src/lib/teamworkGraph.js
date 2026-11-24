// ---------------------------------------------------------------------------
// IncidentBridge — Teamwork Graph client (the mockable seam)
//
// What this is: Teamwork Graph is Atlassian's connected model of a site
// — users, teams, Jira work items, Confluence pages, goals, and whatever
// linked external tools (GitHub, CI/CD) report into it. This module
// reads it through the GraphQL endpoint
//   POST https://<site>.atlassian.net/gateway/api/graphql/twg
// using only CURATED queries — typed root fields maintained by
// Atlassian, no Cypher text sent at request time (raw `cypherQuery`
// is unavailable to new apps). One GraphQL document asks three
// curated fields about ONE issue:
//
//   * jiraWorkItemLinkedExternalPullRequests(id) — pull requests
//     linked to the issue (read:graph:pull-request:external)
//   * jiraWorkItemLinkedExternalDeployments(id) — deployments linked
//     to the issue (read:graph:deployment:external)
//   * jiraWorkItemGoals(id) — goals linked to the issue
//     (read:graph:goal:atlassian)
//
// Why these three: they are evidence from OUTSIDE Jira about whether
// the work is really done. A summary that claims "Fixed …" while the
// status sits in To Do is suspicious on its own; a SUCCESSFUL
// deployment linked to the same issue in the graph corroborates the
// claim independently — the code really shipped. Linked pull requests
// show work has started even when the workflow still says To Do.
// Linked goals only raise the stakes (who cares), so they are surfaced
// as context, never as a finding.
//
// What this is NOT: a write path. Every Teamwork Graph scope is
// read-only — "there is no write access to the graph through this
// API" (Scopes reference). IncidentBridge therefore only READS the
// graph; drift is still fixed through the Jira REST API, as before.
//
// Auth: the live transport is @forge/api's
// `api.asUser().requestTeamworkGraph(...)`, so the graph enforces the
// viewing user's permissions on top of the scopes, exactly like the
// Jira client. @forge/api is imported lazily, only when a live request
// is actually made, so importing this module (e.g. from the test
// suite) never requires the Forge runtime.
//
// Tests inject a transport with setTransportForTests() — the same seam
// pattern as src/lib/jiraClient.js. The fake receives (query,
// variables) and returns the parsed GraphQL body { data, errors }.
//
// ARIs: curated queries take an object ARI as `id`. A Jira issue ARI
// is `ari:cloud:jira:{cloudId}:issue/{issueId}` (numeric id from the
// Jira REST response, exposed as `issue.id` by jiraClient). The
// cloudId comes from the Forge invocation context
// (`req.context.cloudId` in resolvers, `context.cloudId` in Rovo
// actions). When either piece is missing the module says so
// ({ available: false }) instead of guessing an ARI — callers then
// answer from the engine alone and label the graph as unavailable.
//
// Two documented behaviours callers must know:
//   * A missing/ungranted scope produces NO error: the field just
//     comes back empty. Empty graph evidence therefore means "no
//     linked data visible to this user under the granted scopes",
//     never "the issue has no PRs". The code never treats absence as
//     proof of anything.
//   * Curated queries cap `first` at 25; 10 per field is plenty for
//     a verdict and keeps the response small.
//
// Operation names follow the documented `company_operation` shape
// (e.g. `incidentbridge_issueEvidence`).
//
// Docs (all developer.atlassian.com, read 2026-11-25):
//   * Call the Teamwork Graph API —
//     /platform/teamwork-graph/call-the-teamwork-graph-api/
//   * Curated queries —
//     /platform/teamwork-graph/curated-queries/
//   * Scopes — /platform/teamwork-graph/scopes/
//   * Object types: JiraWorkItem, ExternalPullRequest,
//     ExternalDeployment, AtlassianGoal —
//     /platform/teamwork-graph/api-reference/object-types/<Type>/
//   * Understanding ARIs —
//     /platform/teamwork-graph/understanding-aris/
// ---------------------------------------------------------------------------

let injectedTransport = null;

/**
 * Test seam: replace the live transport with a fake.
 * The fake receives (query, variables) and must return the parsed
 * GraphQL response body { data, errors }. Pass null to restore the
 * live transport.
 */
export function setTransportForTests(transport) {
  injectedTransport = transport;
}

/** Error type for Teamwork Graph failures (transport or GraphQL). */
export class TeamworkGraphError extends Error {
  constructor(message, graphQLErrors) {
    super(message);
    this.name = 'TeamworkGraphError';
    this.graphQLErrors = graphQLErrors || null;
  }
}

/**
 * Builds a Jira issue ARI from the site's cloudId and the issue's
 * numeric id, or null when either piece is missing. Never guesses.
 */
export function buildIssueAri(cloudId, issueId) {
  const cloud = String(cloudId || '').trim();
  const id = String(issueId || '').trim();
  if (!cloud || !id) {
    return null;
  }
  return `ari:cloud:jira:${cloud}:issue/${id}`;
}

// One document, three curated fields. Field selections use only
// fields listed on the object-type reference pages:
//   * ExternalPullRequest: id, title, displayName, url, createdAt,
//     lastUpdatedAt. Its `status` field is deliberately NOT selected:
//     the reference lists its type as ExternalPullRequestStatus but
//     documents neither its shape nor its values, so selecting it
//     would be a guess that could break the whole query.
//   * ExternalDeployment: id, displayName, state, environment, url,
//     createdAt. `state` is a documented enum (SUCCESSFUL, FAILED,
//     IN_PROGRESS, …) and `environment.type` is a documented enum
//     (PRODUCTION, STAGING, …), so both are selected bare.
//   * AtlassianGoal: id, key, name, archived, url (no `status`
//     field exists on the type).
// NOTE: the Curated queries doc's example selects `title` on
// JiraWorkItem, but the JiraWorkItem reference lists `summary`, not
// `title`. This query never selects JiraWorkItem fields, so the
// discrepancy does not affect it; it is recorded here so a future
// query that does select work-item fields re-checks first.
export const ISSUE_EVIDENCE_QUERY = `
query incidentbridge_issueEvidence($id: ID!) {
  jiraWorkItemLinkedExternalPullRequests(id: $id, first: 10) {
    edges {
      node {
        ... on ExternalPullRequest {
          id
          title
          displayName
          url
          createdAt
          lastUpdatedAt
        }
      }
    }
  }
  jiraWorkItemLinkedExternalDeployments(id: $id, first: 10) {
    edges {
      node {
        ... on ExternalDeployment {
          id
          displayName
          state
          environment {
            displayName
            type
          }
          url
          createdAt
        }
      }
    }
  }
  jiraWorkItemGoals(id: $id, first: 10) {
    edges {
      node {
        ... on AtlassianGoal {
          id
          key
          name
          archived
          url
        }
      }
    }
  }
}
`;

const OPERATION_NAME = 'incidentbridge_issueEvidence';

async function requestGraph(query, variables) {
  if (injectedTransport) {
    return injectedTransport(query, variables);
  }
  // Live transport — lazy import so plain-Node tests never load Forge.
  const apiModule = await import('@forge/api');
  // Interop guard (same bundler-wrapping concern as jiraClient):
  // use whichever module level actually exposes asUser().
  const api = [apiModule, apiModule.default, apiModule.default?.default]
    .find((candidate) => candidate && typeof candidate.asUser === 'function');
  const response = await api
    .asUser()
    .requestTeamworkGraph(query, variables, OPERATION_NAME);
  return response.json();
}

// Pulls the node objects out of a Relay connection, tolerating the
// shapes a partially-granted query produces (a field the admin did
// not grant comes back absent, not erroring).
function connectionNodes(data, field) {
  const connection = (data && data[field]) || {};
  const edges = Array.isArray(connection.edges) ? connection.edges : [];
  return edges.map((edge) => (edge && edge.node) || null).filter(Boolean);
}

/**
 * Normalises one raw GraphQL response into the evidence shape:
 *   {
 *     pullRequests: [{ id, title, url, createdAt, updatedAt }],
 *     deployments:  [{ id, displayName, state, environment,
 *                       environmentType, url, createdAt }],
 *     goals:        [{ id, key, name, archived, url }],
 *   }
 * Unknown/missing pieces become empty lists — never a throw.
 */
export function parseIssueEvidence(data) {
  const pullRequests = connectionNodes(data, 'jiraWorkItemLinkedExternalPullRequests')
    .map((node) => ({
      id: node.id || null,
      title: node.title || node.displayName || '',
      url: node.url || null,
      createdAt: node.createdAt || null,
      updatedAt: node.lastUpdatedAt || null,
    }));
  const deployments = connectionNodes(data, 'jiraWorkItemLinkedExternalDeployments')
    .map((node) => ({
      id: node.id || null,
      displayName: node.displayName || '',
      state: node.state || null,
      environment: (node.environment && node.environment.displayName) || null,
      environmentType: (node.environment && node.environment.type) || null,
      url: node.url || null,
      createdAt: node.createdAt || null,
    }));
  const goals = connectionNodes(data, 'jiraWorkItemGoals')
    .map((node) => ({
      id: node.id || null,
      key: node.key || null,
      name: node.name || '',
      archived: node.archived === true,
      url: node.url || null,
    }));
  return { pullRequests, deployments, goals };
}

/**
 * Fetches graph evidence for one issue.
 * @returns {Promise<{available, reason?, pullRequests, deployments,
 *                    goals}>}
 *   `available: false` (with `reason`) when the ARI cannot be built —
 *   no request is sent. GraphQL `errors` or a transport failure
 *   throws TeamworkGraphError; callers degrade to the engine-only
 *   verdict and label the graph unavailable.
 */
export async function getIssueGraphEvidence({ cloudId, issueId }) {
  const ari = buildIssueAri(cloudId, issueId);
  if (!ari) {
    return {
      available: false,
      reason: 'missing-cloud-id-or-issue-id',
      pullRequests: [],
      deployments: [],
      goals: [],
    };
  }
  const body = await requestGraph(ISSUE_EVIDENCE_QUERY, { id: ari });
  if (body && Array.isArray(body.errors) && body.errors.length > 0) {
    const detail = body.errors.map((e) => e.message || JSON.stringify(e)).join('; ');
    throw new TeamworkGraphError(`Teamwork Graph query failed: ${detail}`, body.errors);
  }
  return { available: true, ...parseIssueEvidence(body && body.data) };
}

// Mirrors the verdict wording of consistency.js buildResult(), so a
// graph-enriched result reads exactly like an engine result.
function rebuildVerdict(findings) {
  if (findings.length === 0) {
    return 'Summary and status agree — no drift detected.';
  }
  const primary = findings[0];
  return findings.length === 1
    ? primary.message
    : `${findings.length} drifts detected. First: ${primary.message}`;
}

/**
 * Merges graph evidence into an engine result (pure — no network).
 * Appends at most one finding per evidence kind, AFTER the engine's
 * findings, so the engine's primary finding (and its shortcuts)
 * never moves — unless the engine found nothing and the graph is the
 * only voice, in which case the shortcuts follow the graph finding.
 *
 *   * A SUCCESSFUL deployment linked to the issue while the status
 *     category is not 'done' corroborates a completion claim: the
 *     work looks shipped. Fix on offer: transition to 'done'.
 *   * Linked pull request(s) while the status category is still
 *     'new' show work has started in the graph. Fix on offer:
 *     transition to 'indeterminate'. (Hedged on purpose: a linked
 *     PR may be a draft or a spike, so the message says "suggests",
 *     and no PR finding is raised once the workflow already admits
 *     the work started.)
 *   * Linked goals never become a finding — they only raise the
 *     stakes, so they are listed in the `graph` block as context.
 *   * Absence proves nothing: zero PRs / deployments / goals adds
 *     no finding and changes no verdict.
 *
 * The returned object is the check result plus a `graph` block the
 * panel and the Rovo action pass through verbatim.
 */
export function enrichCheckWithGraph(issue, check, evidence) {
  if (!evidence || !evidence.available) {
    return {
      ...check,
      graph: {
        available: false,
        reason: (evidence && evidence.reason) || 'graph-unavailable',
        pullRequests: [],
        deployments: [],
        goals: [],
      },
    };
  }
  const findings = [...(check.findings || [])];
  const successful = (evidence.deployments || []).filter((d) => d.state === 'SUCCESSFUL');
  const category = issue.statusCategory;
  if (successful.length > 0 && category !== 'done') {
    const names = successful
      .map((d) => {
        const where = d.environmentType
          ? ` (${d.environmentType.toLowerCase()}${d.environment ? `, ${d.environment}` : ''})`
          : '';
        return `"${d.displayName || 'deployment'}"${where}`;
      })
      .join(', ');
    findings.push({
      rule: 'graph-deployment-evidence',
      claim: null,
      expectedCategory: 'done',
      actualCategory: category,
      message:
        `Teamwork Graph links ${successful.length} successful deployment(s) to this issue ` +
        `(${names}) while the status category is "${category}" — the work looks shipped ` +
        'even though the workflow never moved.',
      fix: {
        kind: 'transition',
        toCategory: 'done',
        label: 'Move issue to a "done" status',
      },
    });
  }
  const prs = evidence.pullRequests || [];
  if (prs.length > 0 && category === 'new') {
    const first = prs[0].title ? ` ("${prs[0].title}")` : '';
    findings.push({
      rule: 'graph-pull-request-evidence',
      claim: null,
      expectedCategory: 'indeterminate',
      actualCategory: category,
      message:
        `Teamwork Graph links ${prs.length} pull request(s) to this issue${first} — ` +
        'work has started in the graph while the status is still "To Do".',
      fix: {
        kind: 'transition',
        toCategory: 'indeterminate',
        label: 'Move issue to an "in progress" status',
      },
    });
  }
  const primary = findings[0] || null;
  return {
    ...check,
    consistent: findings.length === 0,
    findings,
    verdict: rebuildVerdict(findings),
    // Primary-finding shortcuts, recomputed only when the graph is
    // the sole voice (engine found nothing); otherwise the engine's
    // shortcuts stand, as before.
    claim: check.findings && check.findings.length > 0 ? check.claim : primary ? primary.claim : null,
    expectedCategory:
      check.findings && check.findings.length > 0
        ? check.expectedCategory
        : primary
          ? primary.expectedCategory
          : null,
    suggestedAction:
      check.findings && check.findings.length > 0
        ? check.suggestedAction
        : primary && primary.fix
          ? 'offer-transition'
          : null,
    actualCategory: category,
    graph: {
      available: true,
      pullRequests: prs,
      deployments: evidence.deployments || [],
      goals: evidence.goals || [],
      successfulDeploymentCount: successful.length,
      linkedGoalNames: (evidence.goals || []).map((g) => g.name).filter(Boolean),
    },
  };
}
