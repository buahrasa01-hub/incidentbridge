// Consistency-engine tests — every rule gets a consistent case and at
// least one inconsistent case, with the exact fix the engine must offer.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkConsistency } from '../src/lib/consistency.js';

// Fixed clock so date rules are deterministic: "today" is 2026-11-15.
const NOW = new Date(Date.UTC(2026, 10, 15, 12, 0, 0));

function check(summary, statusCategory, extra = {}) {
  return checkConsistency({ summary, statusCategory, ...extra }, { now: NOW });
}

function rulesOf(result) {
  return result.findings.map((f) => f.rule);
}

// --- completion claims -----------------------------------------------------

test('completion claim agrees with done status', () => {
  const r = check('Fixed crash on PDF export', 'done');
  assert.equal(r.consistent, true);
  assert.deepEqual(r.findings, []);
});

test('completion claim vs open status drifts and offers a transition', () => {
  const r = check('Fixed crash on PDF export', 'new');
  assert.equal(r.consistent, false);
  assert.deepEqual(rulesOf(r), ['completion-claim']);
  assert.equal(r.findings[0].claim, 'Fixed');
  assert.equal(r.findings[0].expectedCategory, 'done');
  assert.equal(r.findings[0].fix.kind, 'transition');
  assert.equal(r.findings[0].fix.toCategory, 'done');
  // Back-compat primary fields follow the first finding.
  assert.equal(r.suggestedAction, 'offer-transition');
  assert.equal(r.claim, 'Fixed');
});

test('completion claim vs in-progress status drifts', () => {
  const r = check('Resolved login timeout for SSO users', 'indeterminate');
  assert.equal(r.consistent, false);
  assert.deepEqual(rulesOf(r), ['completion-claim']);
});

test('shipped/merged claims behave like completion claims', () => {
  assert.equal(check('Shipped dark mode for settings', 'done').consistent, true);
  assert.equal(check('Merged the billing refactor', 'new').consistent, false);
});

test('neutral summary makes no claim and is consistent in any status', () => {
  for (const category of ['new', 'indeterminate', 'done']) {
    const r = check('Crash on PDF export when file has embedded fonts', category);
    assert.equal(r.consistent, true, `category ${category}`);
  }
});

// --- progress claims -------------------------------------------------------

test('progress claim agrees with indeterminate status', () => {
  assert.equal(check('Investigating crash on PDF export', 'indeterminate').consistent, true);
  assert.equal(check('In progress: rework of the export pipeline', 'indeterminate').consistent, true);
});

test('progress claim vs new status drifts (claims started, workflow disagrees)', () => {
  const r = check('Investigating crash on PDF export', 'new');
  assert.equal(r.consistent, false);
  assert.deepEqual(rulesOf(r), ['progress-claim']);
  assert.equal(r.findings[0].fix.kind, 'transition');
  assert.equal(r.findings[0].fix.toCategory, 'indeterminate');
});

test('progress claim vs done status drifts and offers a reword', () => {
  const r = check('Investigating crash on PDF export', 'done');
  assert.equal(r.consistent, false);
  assert.deepEqual(rulesOf(r), ['progress-claim']);
  assert.equal(r.findings[0].fix.kind, 'reword-summary');
  // Leading claim word is stripped for the suggestion.
  assert.equal(r.findings[0].fix.suggestedSummary, 'Crash on PDF export');
  assert.equal(r.suggestedAction, 'offer-summary-reword');
});

// --- blocked claims --------------------------------------------------------

test('blocked claim agrees with indeterminate status', () => {
  assert.equal(check('Blocked: waiting on vendor API keys', 'indeterminate').consistent, true);
});

test('blocked claim vs done status drifts (a done issue is not blocked)', () => {
  const r = check('Blocked: waiting on vendor API keys', 'done');
  assert.equal(r.consistent, false);
  assert.deepEqual(rulesOf(r), ['blocked-claim']);
  assert.equal(r.findings[0].fix.kind, 'reword-summary');
});

test('blocked claim vs new status drifts toward indeterminate', () => {
  const r = check('On hold pending legal review', 'new');
  assert.equal(r.consistent, false);
  assert.deepEqual(rulesOf(r), ['blocked-claim']);
  assert.equal(r.findings[0].fix.toCategory, 'indeterminate');
});

// --- not-reproducible claims ----------------------------------------------

test('not reproducible agrees with done status', () => {
  assert.equal(check('Not reproducible: export crash on staging', 'done').consistent, true);
});

test('not reproducible vs in progress drifts (cannot work what you declared dead)', () => {
  const r = check('Cannot reproduce the export crash', 'indeterminate');
  assert.equal(r.consistent, false);
  assert.deepEqual(rulesOf(r), ['not-reproducible-claim']);
  assert.equal(r.findings[0].fix.kind, 'transition');
  assert.equal(r.findings[0].fix.toCategory, 'done');
});

test('"works on my machine" is a not-reproducible claim', () => {
  const r = check('Works on my machine — export crash', 'new');
  assert.equal(r.consistent, false);
  assert.deepEqual(rulesOf(r), ['not-reproducible-claim']);
});

// --- reopened claims -------------------------------------------------------

test('reopened claim agrees with indeterminate status', () => {
  assert.equal(check('Reopened: export crash is back', 'indeterminate').consistent, true);
});

test('reopened claim vs done status drifts and offers a reword (workflow says closed)', () => {
  const r = check('Regression: export crash returned', 'done');
  assert.equal(r.consistent, false);
  assert.deepEqual(rulesOf(r), ['reopened-claim']);
  assert.equal(r.findings[0].fix.kind, 'reword-summary');
});

// --- empty / placeholder summaries ----------------------------------------

test('empty summary drifts in any status', () => {
  for (const category of ['new', 'indeterminate', 'done']) {
    const r = check('', category);
    assert.equal(r.consistent, false);
    assert.deepEqual(rulesOf(r), ['empty-summary']);
    assert.equal(r.findings[0].fix.kind, 'reword-summary');
  }
});

test('placeholder summaries drift', () => {
  for (const summary of ['TODO', 'tbd', 'test', 'asdf', 'Untitled']) {
    const r = check(summary, 'new');
    assert.deepEqual(rulesOf(r), ['empty-summary'], `summary "${summary}"`);
  }
});

test('empty summary fix proposes text from the description', () => {
  const r = check('', 'new', {
    descriptionText: 'Exporting a report to PDF crashes the renderer. It happens every time.',
  });
  assert.equal(
    r.findings[0].fix.suggestedSummary,
    'Exporting a report to PDF crashes the renderer.',
  );
});

test('empty summary without a description offers no invented text', () => {
  const r = check('  ', 'new');
  assert.equal(r.findings[0].fix.suggestedSummary, null);
});

// --- stale date promises ---------------------------------------------------

test('past promised date vs open status drifts', () => {
  const r = check('Export revamp due 2026-11-01', 'indeterminate');
  assert.equal(r.consistent, false);
  assert.deepEqual(rulesOf(r), ['stale-date-promise']);
  assert.equal(r.findings[0].claim, '2026-11-01');
});

test('past promised date is fine once the work is done', () => {
  assert.equal(check('Export revamp due 2026-11-01', 'done').consistent, true);
});

test('future promised date does not drift', () => {
  assert.equal(check('Export revamp due 2026-12-24', 'new').consistent, true);
});

test('promised date of today is not yet stale', () => {
  assert.equal(check('Export revamp due 2026-11-15', 'new').consistent, true);
});

test('a bare date without a promise cue is a record, not a promise', () => {
  assert.equal(check('Bug first seen 2026-10-03 in renderer logs', 'new').consistent, true);
});

test('month-name promise formats are recognised', () => {
  const a = check('Ship export revamp by Nov 1, 2026', 'new');
  // "Ship" is not a claim verb; the only finding must be the stale date.
  assert.deepEqual(rulesOf(a), ['stale-date-promise']);
  const b = check('Export revamp — deadline 1 Nov 2026', 'indeterminate');
  assert.deepEqual(rulesOf(b), ['stale-date-promise']);
});

test('multiple drifts are all reported', () => {
  const r = check('Fixed export revamp due 2026-11-01', 'new');
  assert.equal(r.consistent, false);
  assert.deepEqual(rulesOf(r), ['completion-claim', 'stale-date-promise']);
  assert.match(r.verdict, /2 drifts detected/);
});
