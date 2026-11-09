// Fix-executor tests — applyFix/scanProject run against the real
// jiraClient wired to a fake transport, proving the executor picks the
// right transition, refuses safely when no fix path exists, and creates
// + links the JSM follow-up in the right order.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as jira from '../src/lib/jiraClient.js';
import { applyFix, scanProject } from '../src/lib/fixes.js';
import { checkConsistency } from '../src/lib/consistency.js';

afterEach(() => jira.setTransportForTests(null));

const ISSUE = {
  key: 'PROJ-7',
  fields: {
    summary: 'Fixed crash on PDF export',
    description: null,
    status: { name: 'To Do', statusCategory: { key: 'new' } },
    project: { key: 'PROJ' },
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

const TRANSITIONS = {
  status: 200,
  json: {
    transitions: [
      { id: '11', name: 'Start Progress', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
      { id: '31', name: 'Resolve Issue', to: { name: 'Done', statusCategory: { key: 'done' } } },
    ],
  },
};

test('transition fix picks the transition into the claimed category', async () => {
  const calls = wire({
    'GET /rest/api/3/issue/PROJ-7/transitions': TRANSITIONS,
    'POST /rest/api/3/issue/PROJ-7/transitions': { status: 204, json: null },
  });
  const result = await applyFix(jira, 'PROJ-7', { kind: 'transition', toCategory: 'done' });
  assert.equal(result.applied, true);
  assert.match(result.detail, /Done/);
  const post = calls.find((c) => c.method === 'POST');
  assert.deepEqual(post.body, { transition: { id: '31' } });
});

test('transition fix reports (not throws) when the workflow offers no path', async () => {
  wire({
    'GET /rest/api/3/issue/PROJ-7/transitions': {
      status: 200,
      json: {
        transitions: [
          { id: '11', name: 'Start Progress', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
        ],
      },
    },
  });
  const result = await applyFix(jira, 'PROJ-7', { kind: 'transition', toCategory: 'done' });
  assert.equal(result.applied, false);
  assert.match(result.detail, /manually/);
});

test('reword fix applies the human-edited summary over the suggestion', async () => {
  const calls = wire({ 'PUT /rest/api/3/issue/PROJ-7': { status: 204, json: null } });
  const result = await applyFix(
    jira,
    'PROJ-7',
    { kind: 'reword-summary', suggestedSummary: 'Crash on PDF export' },
    { summary: 'Crash on PDF export (fonts)' },
  );
  assert.equal(result.applied, true);
  assert.deepEqual(calls[0].body, { fields: { summary: 'Crash on PDF export (fonts)' } });
});

test('reword fix without any text refuses instead of writing an empty summary', async () => {
  wire({});
  const result = await applyFix(jira, 'PROJ-7', {
    kind: 'reword-summary',
    suggestedSummary: null,
  });
  assert.equal(result.applied, false);
  assert.match(result.detail, /No summary text/);
});

test('link-jsm fix creates the request and links it back to the issue', async () => {
  const calls = wire({
    'GET /rest/servicedeskapi/servicedesk': {
      status: 200,
      json: { values: [{ id: '3', projectKey: 'HELP', projectName: 'IT Help' }] },
    },
    'GET /rest/servicedeskapi/servicedesk/3/requesttype': {
      status: 200,
      json: { values: [{ id: '9', name: 'Get IT help' }] },
    },
    'GET /rest/api/3/issue/PROJ-7': { status: 200, json: ISSUE },
    'POST /rest/servicedeskapi/request': {
      status: 201,
      json: { issueKey: 'HELP-55', issueId: '10055' },
    },
    'POST /rest/api/3/issueLink': { status: 201, json: null },
  });
  const result = await applyFix(jira, 'PROJ-7', { kind: 'link-jsm' });
  assert.equal(result.applied, true);
  assert.equal(result.newIssueKey, 'HELP-55');
  const create = calls.find((c) => c.path === '/rest/servicedeskapi/request');
  assert.match(create.body.requestFieldValues.summary, /Follow-up for PROJ-7/);
  const link = calls.find((c) => c.path === '/rest/api/3/issueLink');
  assert.equal(link.body.inwardIssue.key, 'HELP-55');
  assert.equal(link.body.outwardIssue.key, 'PROJ-7');
});

test('link-jsm fix reports when no service desk exists', async () => {
  wire({
    'GET /rest/servicedeskapi/servicedesk': { status: 200, json: { values: [] } },
  });
  const result = await applyFix(jira, 'PROJ-7', { kind: 'link-jsm' });
  assert.equal(result.applied, false);
  assert.match(result.detail, /No Jira Service Management service desk/);
});

test('unknown fix kinds throw rather than silently no-op', async () => {
  wire({});
  await assert.rejects(() => applyFix(jira, 'PROJ-7', { kind: 'teleport' }), /Unknown fix kind/);
});

test('scanProject returns only the drifted issues', async () => {
  const drifted = { ...ISSUE };
  const clean = {
    key: 'PROJ-8',
    fields: {
      summary: 'Crash on PDF export with embedded fonts',
      description: null,
      status: { name: 'To Do', statusCategory: { key: 'new' } },
      project: { key: 'PROJ' },
    },
  };
  wire({
    'GET /rest/api/3/search/jql': {
      status: 200,
      json: { total: 2, startAt: 0, issues: [drifted, clean] },
    },
  });
  const result = await scanProject(jira, checkConsistency, 'PROJ', { now: new Date(Date.UTC(2026, 10, 15)) });
  assert.equal(result.scanned, 2);
  assert.equal(result.drifted.length, 1);
  assert.equal(result.drifted[0].issue.key, 'PROJ-7');
  assert.equal(result.drifted[0].findings[0].rule, 'completion-claim');
});
