// MCP-tool tests — the three Rovo action handlers behind the
// `rovo:mcp` module (check-issue-consistency, fix-issue-consistency,
// scan-project-drift) run against the real jiraClient wired to a fake
// transport, exactly like the rest of the suite: no Atlassian site,
// no credentials, no live MCP connection. This proves the tools the
// MCP server exposes behave as their manifest descriptions promise —
// verdicts for checks, safe refusal for fixes that are not offered,
// and drift-only results for scans.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as jira from '../src/lib/jiraClient.js';
import {
  checkIssueConsistency,
  fixIssueConsistency,
  scanProjectDrift,
} from '../src/rovo.js';

afterEach(() => jira.setTransportForTests(null));

const DRIFTED_ISSUE = {
  key: 'PROJ-7',
  fields: {
    summary: 'Fixed crash on PDF export',
    description: null,
    status: { name: 'To Do', statusCategory: { key: 'new' } },
    project: { key: 'PROJ' },
  },
};

const CLEAN_ISSUE = {
  key: 'PROJ-8',
  fields: {
    summary: 'Crash on PDF export with embedded fonts',
    description: null,
    status: { name: 'To Do', statusCategory: { key: 'new' } },
    project: { key: 'PROJ' },
  },
};

const TRANSITIONS = {
  status: 200,
  json: {
    transitions: [
      { id: '11', name: 'Start Progress', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
      { id: '31', name: 'Resolve Issue', to: { name: 'Done', statusCategory: { key: 'done' } } },
    ],
  },
};

function wire(routes) {
  const calls = [];
  jira.setTransportForTests(async (method, path, body) => {
    calls.push({ method, path, body });
    for (const [prefix, answer] of Object.entries(routes)) {
      const [m, p] = prefix.split(' ');
      if (method === m && path.startsWith(p)) {
        return typeof answer === 'function' ? answer(body) : answer;
      }
    }
    return { status: 404, json: { errorMessages: [`no route ${method} ${path}`] } };
  });
  return calls;
}

test('MCP check-issue-consistency reports drift with the offered fix', async () => {
  wire({ 'GET /rest/api/3/issue/PROJ-7': { status: 200, json: DRIFTED_ISSUE } });
  const result = await checkIssueConsistency({ issueKey: 'PROJ-7' });
  assert.equal(result.ok, true);
  assert.equal(result.issueKey, 'PROJ-7');
  assert.equal(result.summary, 'Fixed crash on PDF export');
  assert.equal(result.statusName, 'To Do');
  assert.equal(result.statusCategory, 'new');
  assert.equal(result.consistent, false);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].rule, 'completion-claim');
  assert.match(result.findings[0].suggestedFix, /done/i);
});

test('MCP check-issue-consistency reports a clean issue as consistent', async () => {
  wire({ 'GET /rest/api/3/issue/PROJ-8': { status: 200, json: CLEAN_ISSUE } });
  const result = await checkIssueConsistency({ issueKey: 'PROJ-8' });
  assert.equal(result.ok, true);
  assert.equal(result.consistent, true);
  assert.deepEqual(result.findings, []);
});

test('MCP check-issue-consistency falls back to the issue key in context', async () => {
  wire({ 'GET /rest/api/3/issue/PROJ-7': { status: 200, json: DRIFTED_ISSUE } });
  const result = await checkIssueConsistency({
    context: { jira: { issueKey: 'PROJ-7' } },
  });
  assert.equal(result.ok, true);
  assert.equal(result.issueKey, 'PROJ-7');
  assert.equal(result.consistent, false);
});

test('MCP check-issue-consistency fails safely with no issue key', async () => {
  wire({});
  const result = await checkIssueConsistency({});
  assert.equal(result.ok, false);
  assert.match(result.error, /issue key/i);
});

test('MCP fix-issue-consistency applies the offered transition', async () => {
  const calls = wire({
    // Listed first: the transitions path also starts with the issue
    // path, and the fake matches routes in declaration order.
    'GET /rest/api/3/issue/PROJ-7/transitions': TRANSITIONS,
    'GET /rest/api/3/issue/PROJ-7': { status: 200, json: DRIFTED_ISSUE },
    'POST /rest/api/3/issue/PROJ-7/transitions': { status: 204, json: null },
  });
  const result = await fixIssueConsistency({ issueKey: 'PROJ-7', fixKind: 'transition' });
  assert.equal(result.ok, true);
  assert.equal(result.applied, true);
  assert.equal(result.rule, 'completion-claim');
  assert.match(result.detail, /Done/);
  const post = calls.find((c) => c.method === 'POST');
  assert.deepEqual(post.body, { transition: { id: '31' } });
});

test('MCP fix-issue-consistency refuses a fix the check does not offer', async () => {
  wire({ 'GET /rest/api/3/issue/PROJ-8': { status: 200, json: CLEAN_ISSUE } });
  const result = await fixIssueConsistency({ issueKey: 'PROJ-8', fixKind: 'transition' });
  assert.equal(result.ok, false);
  assert.match(result.error, /No "transition" fix is currently offered/);
});

test('MCP scan-project-drift returns only the drifted issues', async () => {
  wire({
    'GET /rest/api/3/search/jql': {
      status: 200,
      json: { total: 2, startAt: 0, issues: [DRIFTED_ISSUE, CLEAN_ISSUE] },
    },
  });
  const result = await scanProjectDrift({ projectKey: 'PROJ' });
  assert.equal(result.ok, true);
  assert.equal(result.projectKey, 'PROJ');
  assert.equal(result.scanned, 2);
  assert.equal(result.driftedCount, 1);
  assert.equal(result.drifted[0].issueKey, 'PROJ-7');
  assert.equal(result.drifted[0].findings.length, 1);
});

test('MCP scan-project-drift fails safely with no project key', async () => {
  wire({});
  const result = await scanProjectDrift({});
  assert.equal(result.ok, false);
  assert.match(result.error, /project key/i);
});
