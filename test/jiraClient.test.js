// jiraClient tests — the client logic runs against an injected fake
// transport, so the REST paths, payloads and normalisation are verified
// with no Atlassian site and no credentials.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as jira from '../src/lib/jiraClient.js';

afterEach(() => jira.setTransportForTests(null));

// A fake transport that records calls and answers from a route table.
// Routes map "METHOD path-prefix" -> { status, json }.
function fakeTransport(routes) {
  const calls = [];
  const transport = async (method, path, body) => {
    calls.push({ method, path, body });
    for (const [prefix, answer] of Object.entries(routes)) {
      const [m, p] = prefix.split(' ');
      if (method === m && path.startsWith(p)) {
        return answer;
      }
    }
    return { status: 404, json: { errorMessages: [`no route for ${method} ${path}`] } };
  };
  return { transport, calls };
}

const RAW_ISSUE = {
  key: 'PROJ-7',
  fields: {
    summary: 'Fixed crash on PDF export',
    description: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Exporting crashes the renderer.' }],
        },
      ],
    },
    status: { name: 'To Do', statusCategory: { key: 'new' } },
    project: { key: 'PROJ' },
  },
};

test('getIssue normalises the REST payload for the engine', async () => {
  const { transport, calls } = fakeTransport({
    'GET /rest/api/3/issue/PROJ-7': { status: 200, json: RAW_ISSUE },
  });
  jira.setTransportForTests(transport);
  const issue = await jira.getIssue('PROJ-7');
  assert.equal(issue.key, 'PROJ-7');
  assert.equal(issue.summary, 'Fixed crash on PDF export');
  assert.equal(issue.descriptionText, 'Exporting crashes the renderer.');
  assert.equal(issue.statusCategory, 'new');
  assert.equal(issue.projectKey, 'PROJ');
  assert.equal(calls[0].method, 'GET');
});

test('adfToText flattens paragraphs and ignores unknown nodes', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'First line.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second line.' }] },
      { type: 'mediaSingle', content: [] },
    ],
  };
  assert.equal(jira.adfToText(doc), 'First line.\nSecond line.');
  assert.equal(jira.adfToText(null), '');
  assert.equal(jira.adfToText('plain string'), '');
});

test('pickTransitionToCategory selects by target category', () => {
  const transitions = [
    { id: '11', name: 'Start', toName: 'In Progress', toCategory: 'indeterminate' },
    { id: '31', name: 'Resolve', toName: 'Done', toCategory: 'done' },
  ];
  assert.equal(jira.pickTransitionToCategory(transitions, 'done').id, '31');
  assert.equal(jira.pickTransitionToCategory(transitions, 'new'), null);
});

test('transitionIssue posts the transition id as a string', async () => {
  const { transport, calls } = fakeTransport({
    'POST /rest/api/3/issue/PROJ-7/transitions': { status: 204, json: null },
  });
  jira.setTransportForTests(transport);
  await jira.transitionIssue('PROJ-7', 31);
  assert.deepEqual(calls[0].body, { transition: { id: '31' } });
});

test('updateSummary PUTs the new summary', async () => {
  const { transport, calls } = fakeTransport({
    'PUT /rest/api/3/issue/PROJ-7': { status: 204, json: null },
  });
  jira.setTransportForTests(transport);
  await jira.updateSummary('PROJ-7', 'Crash on PDF export');
  assert.equal(calls[0].method, 'PUT');
  assert.deepEqual(calls[0].body, { fields: { summary: 'Crash on PDF export' } });
});

test('searchIssues follows pages until total is reached', async () => {
  const page = (startAt, items, total) => ({
    status: 200,
    json: { total, startAt, issues: items },
  });
  const item = (n) => ({ ...RAW_ISSUE, key: `PROJ-${n}` });
  const { transport } = fakeTransport({
    'GET /rest/api/3/search/jql': page(0, [item(1), item(2)], 3),
  });
  // The fake answers the same page for every startAt; the client must
  // stop via the total counter rather than loop forever: page 1 gives
  // startAt 2, page 2 another 2 would exceed... instead cap maxTotal.
  jira.setTransportForTests(transport);
  const issues = await jira.searchIssues('project = PROJ', { maxTotal: 3 });
  assert.equal(issues.length, 3);
  assert.equal(issues[0].statusCategory, 'new');
});

test('HTTP errors surface as JiraApiError with the Jira message', async () => {
  const { transport } = fakeTransport({
    'GET /rest/api/3/issue/NOPE-1': {
      status: 404,
      json: { errorMessages: ['Issue does not exist'] },
    },
  });
  jira.setTransportForTests(transport);
  await assert.rejects(
    () => jira.getIssue('NOPE-1'),
    (err) => err.name === 'JiraApiError' && err.status === 404 && /Issue does not exist/.test(err.message),
  );
});

test('createServiceDeskRequest posts the servicedesk payload', async () => {
  const { transport, calls } = fakeTransport({
    'POST /rest/servicedeskapi/request': {
      status: 201,
      json: { issueKey: 'HELP-55', issueId: '10055' },
    },
  });
  jira.setTransportForTests(transport);
  const created = await jira.createServiceDeskRequest({
    serviceDeskId: 3,
    requestTypeId: 9,
    summary: 'Follow-up for PROJ-7',
    descriptionText: 'Details',
  });
  assert.equal(created.key, 'HELP-55');
  assert.equal(calls[0].body.serviceDeskId, '3');
  assert.equal(calls[0].body.requestFieldValues.summary, 'Follow-up for PROJ-7');
});

test('linkIssues posts a Relates link by default', async () => {
  const { transport, calls } = fakeTransport({
    'POST /rest/api/3/issueLink': { status: 201, json: null },
  });
  jira.setTransportForTests(transport);
  await jira.linkIssues('HELP-55', 'PROJ-7');
  assert.deepEqual(calls[0].body, {
    type: { name: 'Relates' },
    inwardIssue: { key: 'HELP-55' },
    outwardIssue: { key: 'PROJ-7' },
  });
});
