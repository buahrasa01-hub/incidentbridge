// ---------------------------------------------------------------------------
// IncidentBridge — Jira / JSM API client (the mockable seam)
//
// Every product API call in the app goes through this file. The actual
// HTTP transport is a single function, `request(method, path, body)`,
// with two implementations:
//
//   * live  — @forge/api's `api.asUser().requestJira(...)`. asUser is
//             used throughout (never asApp) so Jira's own permission
//             checks apply to every read and write, per Forge guidance.
//   * fake  — tests inject a transport with setTransportForTests() and
//             exercise the full client logic in plain Node, with no
//             Atlassian site and no credentials.
//
// @forge/api is imported lazily, only when a live request is actually
// made, so importing this module (e.g. from the test suite) never
// requires the Forge runtime.
//
// Normalised issue shape returned by getIssue()/searchIssues():
//   {
//     key, summary, descriptionText,
//     statusName,               // e.g. "In Progress"
//     statusCategory,           // 'new' | 'indeterminate' | 'done'
//     projectKey,
//   }
// That is exactly the input contract of src/lib/consistency.js.
// ---------------------------------------------------------------------------

let injectedTransport = null;

/**
 * Test seam: replace the live transport with a fake.
 * The fake receives (method, path, body) and must return
 * { status, json } where json is the already-parsed response body
 * (or null). Pass null to restore the live transport.
 */
export function setTransportForTests(transport) {
  injectedTransport = transport;
}

/** Error type carrying the HTTP status and a readable Jira message. */
export class JiraApiError extends Error {
  constructor(status, path, detail) {
    super(`Jira API ${status} on ${path}${detail ? `: ${detail}` : ''}`);
    this.name = 'JiraApiError';
    this.status = status;
    this.path = path;
  }
}

async function request(method, path, body) {
  if (injectedTransport) {
    const fake = await injectedTransport(method, path, body);
    return unwrap(fake, path);
  }
  // Live transport — lazy import so plain-Node tests never load Forge.
  const apiModule = await import('@forge/api');
  // Interop guard (same bundler-wrapping concern as the resolver):
  // use whichever module level actually exposes asUser().
  const api = [apiModule, apiModule.default, apiModule.default?.default]
    .find((candidate) => candidate && typeof candidate.asUser === 'function');
  const options = { method, headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  // The path is built entirely by this client (dynamic segments are
  // already encodeURIComponent'd), so it must go through
  // assumeTrustedRoute(): feeding a whole built path into the route``
  // tag as a single interpolated value is rejected by @forge/api with
  // "Disallowing path manipulation attempt" — that rejection is what
  // silently forced the panel's demo-fixture fallback on live sites.
  const trustedRoute = typeof apiModule.assumeTrustedRoute === 'function'
    ? apiModule.assumeTrustedRoute(path)
    : apiModule.route([path]);
  const response = await api.asUser().requestJira(trustedRoute, options);
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null; // e.g. 204 No Content on transitions / edits
  }
  return unwrap({ status: response.status, json }, path);
}

function unwrap({ status, json }, path) {
  if (status >= 400) {
    const detail =
      (json && (json.errorMessages || []).join('; ')) ||
      (json && json.errors && JSON.stringify(json.errors)) ||
      (json && json.message) ||
      '';
    throw new JiraApiError(status, path, detail);
  }
  return json;
}

// Extracts plain text from an Atlassian Document Format (ADF) node tree
// (issue descriptions arrive as ADF). Deliberately small: paragraphs,
// headings, list items and text runs — enough for the engine's
// summary-from-description heuristic. Returns '' for anything else.
export function adfToText(node) {
  if (!node || typeof node !== 'object') {
    return '';
  }
  if (node.type === 'text') {
    return node.text || '';
  }
  const blockTypes = new Set([
    'paragraph',
    'heading',
    'listItem',
    'blockquote',
    'codeBlock',
    'rule',
  ]);
  const children = (node.content || []).map(adfToText).filter((s) => s !== '');
  // Inline children (text runs, mentions) join seamlessly; block
  // children (paragraphs inside a doc, items inside a list) join with
  // newlines. The separator is chosen by the *children's* types, not
  // this node's — a doc's children are blocks, a paragraph's are runs.
  const hasBlockChild = (node.content || []).some((c) => blockTypes.has(c.type));
  const joined = children.join(hasBlockChild ? '\n' : '');
  return node.type === 'doc' ? joined.trim() : joined;
}

function normaliseIssue(raw) {
  const fields = raw.fields || {};
  return {
    key: raw.key,
    summary: fields.summary || '',
    descriptionText: adfToText(fields.description),
    statusName: fields.status ? fields.status.name : '',
    statusCategory: fields.status ? fields.status.statusCategory.key : 'new',
    projectKey: fields.project ? fields.project.key : (raw.key || '').split('-')[0],
  };
}

const ISSUE_FIELDS = 'summary,status,project,description';

/** Fetches one issue, normalised for the consistency engine. */
export async function getIssue(issueKey) {
  const raw = await request(
    'GET',
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=${ISSUE_FIELDS}`,
  );
  return normaliseIssue(raw);
}

/** Lists the transitions currently available on an issue. */
export async function getTransitions(issueKey) {
  const raw = await request(
    'GET',
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
  );
  return (raw.transitions || []).map((t) => ({
    id: t.id,
    name: t.name,
    toName: t.to ? t.to.name : '',
    toCategory: t.to ? t.to.statusCategory.key : '',
  }));
}

/**
 * Picks the first available transition that lands the issue in the
 * given status category, or null when the workflow offers none (in
 * which case the honest answer is "a human must move this manually").
 */
export function pickTransitionToCategory(transitions, category) {
  return transitions.find((t) => t.toCategory === category) || null;
}

/** Performs a transition by id. Jira answers 204 on success. */
export async function transitionIssue(issueKey, transitionId) {
  await request('POST', `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    transition: { id: String(transitionId) },
  });
}

/** Replaces an issue's summary. */
export async function updateSummary(issueKey, summary) {
  await request('PUT', `/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
    fields: { summary },
  });
}

/**
 * Searches issues with JQL, normalised. Pages are followed until
 * `maxTotal` issues have been collected, so a project scan stays
 * bounded (default cap 200) even on huge projects.
 */
export async function searchIssues(jql, { maxTotal = 200 } = {}) {
  const issues = [];
  let startAt = 0;
  while (issues.length < maxTotal) {
    const page = await request(
      'GET',
      `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}` +
        `&startAt=${startAt}&maxResults=50&fields=${ISSUE_FIELDS}`,
    );
    const batch = page.issues || [];
    issues.push(...batch.map(normaliseIssue));
    startAt += batch.length;
    if (batch.length === 0 || startAt >= (page.total || 0)) {
      break;
    }
  }
  return issues.slice(0, maxTotal);
}

/** Lists Jira Service Management service desks visible to the user. */
export async function getServiceDesks() {
  const raw = await request('GET', '/rest/servicedeskapi/servicedesk?limit=50');
  return (raw.values || []).map((d) => ({ id: d.id, projectKey: d.projectKey, name: d.projectName }));
}

/** Lists request types of one service desk. */
export async function getRequestTypes(serviceDeskId) {
  const raw = await request(
    'GET',
    `/rest/servicedeskapi/servicedesk/${serviceDeskId}/requesttype?limit=50`,
  );
  return (raw.values || []).map((rt) => ({ id: rt.id, name: rt.name }));
}

/**
 * Creates a JSM customer request (which materialises as a JSM issue).
 * `raiseOnBehalfOf` is omitted: the request is raised as the invoking
 * user, matching the asUser permission model used everywhere here.
 */
export async function createServiceDeskRequest({ serviceDeskId, requestTypeId, summary, descriptionText }) {
  const raw = await request('POST', '/rest/servicedeskapi/request', {
    serviceDeskId: String(serviceDeskId),
    requestTypeId: String(requestTypeId),
    requestFieldValues: {
      summary,
      description: descriptionText || '',
    },
  });
  return { key: raw.issueKey, id: raw.issueId };
}

/** Links two issues (default relationship: "Relates"). */
export async function linkIssues(inwardKey, outwardKey, typeName = 'Relates') {
  await request('POST', '/rest/api/3/issueLink', {
    type: { name: typeName },
    inwardIssue: { key: inwardKey },
    outwardIssue: { key: outwardKey },
  });
}
