// teamworkGraph tests — the graph client runs against an injected
// fake transport, so the query text, the ARI building, the response
// normalisation and the verdict enrichment are verified with no
// Atlassian site, no Forge runtime and no credentials. The fake
// returns the parsed GraphQL body { data, errors }, exactly what the
// live @forge/api transport returns from response.json().
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  setTransportForTests,
  buildIssueAri,
  ISSUE_EVIDENCE_QUERY,
  parseIssueEvidence,
  getIssueGraphEvidence,
  enrichCheckWithGraph,
  TeamworkGraphError,
} from '../src/lib/teamworkGraph.js';
import { checkConsistency } from '../src/lib/consistency.js';

afterEach(() => setTransportForTests(null));

// A fake transport that records calls and answers one canned body.
function fakeTransport(body) {
  const calls = [];
  const transport = async (query, variables) => {
    calls.push({ query, variables });
    return body;
  };
  return { transport, calls };
}

const GRAPH_DATA = {
  jiraWorkItemLinkedExternalPullRequests: {
    edges: [
      {
        node: {
          id: 'ari:cloud:external::pull-request/1',
          title: 'Fix PDF export crash',
          displayName: 'Fix PDF export crash',
          url: 'https://github.com/example/repo/pull/12',
          createdAt: '2026-11-20T10:00:00.000Z',
          lastUpdatedAt: '2026-11-21T10:00:00.000Z',
        },
      },
    ],
  },
  jiraWorkItemLinkedExternalDeployments: {
    edges: [
      {
        node: {
          id: 'ari:cloud:external::deployment/1',
          displayName: 'release-42',
          state: 'SUCCESSFUL',
          environment: { displayName: 'Production', type: 'PRODUCTION' },
          url: 'https://ci.example.com/runs/42',
          createdAt: '2026-11-21T11:00:00.000Z',
        },
      },
      {
        node: {
          id: 'ari:cloud:external::deployment/2',
          displayName: 'release-41',
          state: 'FAILED',
          environment: { displayName: 'Staging', type: 'STAGING' },
          url: 'https://ci.example.com/runs/41',
          createdAt: '2026-11-20T11:00:00.000Z',
        },
      },
    ],
  },
  jiraWorkItemGoals: {
    edges: [
      {
        node: {
          id: 'ari:cloud:townsquare::goal/9',
          key: 'GOAL-9',
          name: 'Zero crashes in export',
          archived: false,
          url: 'https://example.atlassian.net/goals/9',
        },
      },
    ],
  },
};

const TODO_ISSUE = {
  id: '10001',
  key: 'PROJ-7',
  summary: 'Crash on PDF export',
  descriptionText: '',
  statusName: 'To Do',
  statusCategory: 'new',
  projectKey: 'PROJ',
};

test('buildIssueAri builds the documented Jira issue ARI', () => {
  assert.equal(
    buildIssueAri('a436116f-02ce-4520-8fbb-7301462a1674', '10001'),
    'ari:cloud:jira:a436116f-02ce-4520-8fbb-7301462a1674:issue/10001',
  );
  assert.equal(buildIssueAri(null, '10001'), null);
  assert.equal(buildIssueAri('cloud-id', null), null);
  assert.equal(buildIssueAri('', ''), null);
});

test('the query is one operation with three curated fields and no Cypher', () => {
  assert.match(ISSUE_EVIDENCE_QUERY, /query incidentbridge_issueEvidence\(\$id: ID!\)/);
  assert.match(ISSUE_EVIDENCE_QUERY, /jiraWorkItemLinkedExternalPullRequests\(id: \$id, first: 10\)/);
  assert.match(ISSUE_EVIDENCE_QUERY, /jiraWorkItemLinkedExternalDeployments\(id: \$id, first: 10\)/);
  assert.match(ISSUE_EVIDENCE_QUERY, /jiraWorkItemGoals\(id: \$id, first: 10\)/);
  assert.doesNotMatch(ISSUE_EVIDENCE_QUERY, /MATCH|cypherQuery|customQuery/i);
});

test('parseIssueEvidence normalises edges and keeps deployment state', () => {
  const evidence = parseIssueEvidence(GRAPH_DATA);
  assert.equal(evidence.pullRequests.length, 1);
  assert.equal(evidence.pullRequests[0].title, 'Fix PDF export crash');
  assert.equal(evidence.pullRequests[0].url, 'https://github.com/example/repo/pull/12');
  assert.equal(evidence.deployments.length, 2);
  assert.equal(evidence.deployments[0].state, 'SUCCESSFUL');
  assert.equal(evidence.deployments[0].environmentType, 'PRODUCTION');
  assert.equal(evidence.deployments[1].state, 'FAILED');
  assert.equal(evidence.goals.length, 1);
  assert.equal(evidence.goals[0].name, 'Zero crashes in export');
  assert.equal(evidence.goals[0].archived, false);
});

test('parseIssueEvidence tolerates missing fields (ungranted scope reads as empty)', () => {
  assert.deepEqual(parseIssueEvidence(null), {
    pullRequests: [],
    deployments: [],
    goals: [],
  });
  assert.deepEqual(parseIssueEvidence({}), {
    pullRequests: [],
    deployments: [],
    goals: [],
  });
  const partial = parseIssueEvidence({
    jiraWorkItemLinkedExternalDeployments: { edges: [{ node: { id: 'x', state: 'SUCCESSFUL' } }] },
  });
  assert.equal(partial.pullRequests.length, 0);
  assert.equal(partial.deployments[0].displayName, '');
  assert.equal(partial.deployments[0].environment, null);
});

test('getIssueGraphEvidence sends the ARI and returns parsed evidence', async () => {
  const { transport, calls } = fakeTransport({ data: GRAPH_DATA });
  setTransportForTests(transport);
  const evidence = await getIssueGraphEvidence({
    cloudId: 'cloud-1',
    issueId: '10001',
  });
  assert.equal(evidence.available, true);
  assert.equal(evidence.pullRequests.length, 1);
  assert.equal(evidence.deployments.length, 2);
  assert.equal(evidence.goals.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].variables.id, 'ari:cloud:jira:cloud-1:issue/10001');
  assert.equal(calls[0].query, ISSUE_EVIDENCE_QUERY);
});

test('getIssueGraphEvidence sends nothing without a buildable ARI', async () => {
  const { transport, calls } = fakeTransport({ data: GRAPH_DATA });
  setTransportForTests(transport);
  const evidence = await getIssueGraphEvidence({ cloudId: null, issueId: '10001' });
  assert.equal(evidence.available, false);
  assert.equal(evidence.reason, 'missing-cloud-id-or-issue-id');
  assert.equal(calls.length, 0);
});

test('getIssueGraphEvidence throws TeamworkGraphError on GraphQL errors', async () => {
  const { transport } = fakeTransport({
    data: null,
    errors: [{ message: 'Field not found' }],
  });
  setTransportForTests(transport);
  await assert.rejects(
    getIssueGraphEvidence({ cloudId: 'cloud-1', issueId: '10001' }),
    (error) => error instanceof TeamworkGraphError && /Field not found/.test(error.message),
  );
});

test('enrichCheckWithGraph adds a deployment finding for a To Do issue', async () => {
  const { transport } = fakeTransport({ data: GRAPH_DATA });
  setTransportForTests(transport);
  const evidence = await getIssueGraphEvidence({ cloudId: 'cloud-1', issueId: '10001' });
  const check = checkConsistency(TODO_ISSUE);
  assert.equal(check.consistent, true); // "Crash on PDF export" claims nothing
  const enriched = enrichCheckWithGraph(TODO_ISSUE, check, evidence);
  assert.equal(enriched.consistent, false);
  assert.equal(enriched.findings.length, 2); // deployment + pull request
  const deployment = enriched.findings.find((f) => f.rule === 'graph-deployment-evidence');
  assert.match(deployment.message, /successful deployment/);
  assert.match(deployment.message, /production/i);
  assert.equal(deployment.fix.kind, 'transition');
  assert.equal(deployment.fix.toCategory, 'done');
  const pr = enriched.findings.find((f) => f.rule === 'graph-pull-request-evidence');
  assert.match(pr.message, /pull request/);
  assert.equal(pr.fix.toCategory, 'indeterminate');
  assert.equal(enriched.graph.successfulDeploymentCount, 1);
  assert.deepEqual(enriched.graph.linkedGoalNames, ['Zero crashes in export']);
  assert.equal(enriched.suggestedAction, 'offer-transition');
});

test('enrichCheckWithGraph adds no deployment finding once the issue is done', async () => {
  const { transport } = fakeTransport({ data: GRAPH_DATA });
  setTransportForTests(transport);
  const evidence = await getIssueGraphEvidence({ cloudId: 'cloud-1', issueId: '10001' });
  const doneIssue = { ...TODO_ISSUE, statusName: 'Done', statusCategory: 'done' };
  const enriched = enrichCheckWithGraph(doneIssue, checkConsistency(doneIssue), evidence);
  assert.equal(enriched.consistent, true);
  assert.equal(enriched.findings.length, 0);
  // The evidence is still reported — the verdict just does not use it.
  assert.equal(enriched.graph.deployments.length, 2);
});

test('enrichCheckWithGraph adds no pull-request finding once work started', async () => {
  const { transport } = fakeTransport({ data: GRAPH_DATA });
  setTransportForTests(transport);
  const evidence = await getIssueGraphEvidence({ cloudId: 'cloud-1', issueId: '10001' });
  const startedIssue = { ...TODO_ISSUE, statusName: 'In Progress', statusCategory: 'indeterminate' };
  const enriched = enrichCheckWithGraph(
    startedIssue,
    checkConsistency(startedIssue),
    evidence,
  );
  // The successful deployment still fires (status is not done); the
  // pull-request finding does not (the workflow already admits work).
  assert.equal(
    enriched.findings.filter((f) => f.rule === 'graph-pull-request-evidence').length,
    0,
  );
  assert.equal(
    enriched.findings.filter((f) => f.rule === 'graph-deployment-evidence').length,
    1,
  );
});

test('enrichCheckWithGraph keeps engine findings first and adds nothing when the graph is empty', () => {
  const drifted = { ...TODO_ISSUE, summary: 'Fixed crash on PDF export' };
  const check = checkConsistency(drifted);
  assert.equal(check.findings[0].rule, 'completion-claim');
  const enriched = enrichCheckWithGraph(drifted, check, {
    available: true,
    pullRequests: [],
    deployments: [],
    goals: [],
  });
  assert.equal(enriched.findings.length, 1);
  assert.equal(enriched.findings[0].rule, 'completion-claim');
  assert.equal(enriched.verdict, check.verdict);
  assert.deepEqual(enriched.graph.linkedGoalNames, []);
});

test('enrichCheckWithGraph passes an unavailable graph through unchanged', () => {
  const check = checkConsistency(TODO_ISSUE);
  const enriched = enrichCheckWithGraph(TODO_ISSUE, check, {
    available: false,
    reason: 'missing-cloud-id-or-issue-id',
  });
  assert.equal(enriched.consistent, true);
  assert.equal(enriched.findings.length, 0);
  assert.equal(enriched.graph.available, false);
  assert.equal(enriched.graph.reason, 'missing-cloud-id-or-issue-id');
});
