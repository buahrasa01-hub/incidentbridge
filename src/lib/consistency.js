// ---------------------------------------------------------------------------
// IncidentBridge — consistency engine (pure logic, no Forge imports)
//
// Idea: a Jira issue's summary talks to humans; its workflow status talks
// to the process. When the two disagree ("Fixed crash on export" still
// sitting in To Do) dashboards, standups and reports all quietly lie.
// This engine detects that drift deterministically: same input, same
// verdict, no LLM, no network. That determinism is deliberate — a drift
// detector that hallucinates would be worse than the drift.
//
// Comparisons use status *categories* (new / indeterminate / done),
// which are stable across every Jira workflow, instead of status names,
// which every project customises. So the rules work on any site.
//
// Input shape (a normalised issue, see src/lib/jiraClient.js):
//   {
//     summary: string,               // issue summary (may be empty)
//     descriptionText?: string,      // plain-text description, optional
//     statusCategory: 'new' | 'indeterminate' | 'done',
//     statusName?: string,           // e.g. "In Progress" (display only)
//   }
//
// Options: { now } — injectable clock (Date or ISO string) so the
// stale-date rule is deterministic in tests; defaults to the real clock.
//
// Output of checkConsistency():
//   {
//     consistent: boolean,           // true iff findings is empty
//     findings: [Finding],           // every rule that fired
//     verdict: string,               // one-line human summary
//     claim / expectedCategory / suggestedAction
//                                    // primary-finding shortcuts, kept
//                                    // from skeleton v0 for the panel UI
//   }
//
// A Finding is:
//   {
//     rule: 'completion-claim' | 'progress-claim' | 'blocked-claim'
//         | 'not-reproducible-claim' | 'reopened-claim'
//         | 'empty-summary' | 'stale-date-promise',
//     claim: string | null,          // the exact words that triggered it
//     expectedCategory: string | null,
//     actualCategory: string,
//     message: string,               // human-readable explanation
//     fix: {                         // the one-click fix on offer
//       kind: 'transition' | 'reword-summary',
//       toCategory?: string,         // for kind 'transition'
//       suggestedSummary?: string | null, // for kind 'reword-summary'
//       label: string,               // button label for the panel
//     } | null,
//   }
//
// Nothing in this file writes anything. Fixes are only *described* here;
// src/lib/fixes.js performs them after an explicit human/agent request.
// ---------------------------------------------------------------------------

// Wordings that claim an outcome. Each entry maps a claim phrase to the
// status category that would make the claim true. Patterns are anchored
// with word boundaries and kept deliberately narrow: a rule that fires
// on innocent text destroys trust faster than a rule that misses a case.
export const CLAIM_RULES = [
  {
    rule: 'completion-claim',
    pattern:
      /\b(fixed|resolved|done|completed|complete|shipped|merged|deployed|implemented|delivered|closed)\b/i,
    expectsCategory: 'done',
    label: 'work is finished',
  },
  {
    rule: 'progress-claim',
    pattern: /\b(in progress|wip|started|working on|investigating|under investigation|in review)\b/i,
    expectsCategory: 'indeterminate',
    label: 'work has started',
  },
  {
    rule: 'blocked-claim',
    pattern: /\b(blocked|on hold|waiting|stuck|impediment)\b/i,
    expectsCategory: 'indeterminate',
    label: 'work is acknowledged but blocked',
  },
  {
    rule: 'not-reproducible-claim',
    pattern:
      /\b(not reproducible|cannot reproduce|can't reproduce|could not reproduce|unable to reproduce|works on my machine|no repro)\b/i,
    expectsCategory: 'done',
    label: 'the issue was closed as not reproducible',
  },
  {
    rule: 'reopened-claim',
    pattern: /\b(reopened|re-opened|regression|broken again|recurred)\b/i,
    expectsCategory: 'indeterminate',
    label: 'the issue is open again and being worked',
  },
];

// Summaries that carry no information at all. Compared case-insensitively
// against the whole trimmed summary.
const PLACEHOLDER_SUMMARIES = new Set([
  '',
  'todo',
  'tbd',
  'n/a',
  'na',
  'test',
  'testing',
  'asdf',
  'xxx',
  '...',
  '-',
  'untitled',
  'no title',
]);

// Cue words that turn a date in a summary into a *promise* ("by Friday",
// "due 2026-11-01"). A bare date ("Bug found 2026-10-03 in logs") is a
// record, not a promise, and must not fire the rule.
const DATE_CUE = /\b(by|due|eta|deadline|before|until|target)\b/i;

// Removes a matched claim phrase from a summary so the reword fix can
// offer a summary that no longer claims something untrue, e.g.
// "Fixed crash on PDF export" -> "Crash on PDF export". Only a leading
// claim phrase is stripped: mid-sentence surgery would be guesswork.
function stripLeadingClaim(summary, pattern) {
  const trimmed = summary.trim();
  const match = trimmed.match(pattern);
  if (!match || match.index > 3) {
    return null; // claim is not at the start — do not guess a rewrite
  }
  const rest = trimmed.slice(match.index + match[0].length).replace(/^[\s:–—-]+/, '');
  if (rest.length < 3) {
    return null;
  }
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

// First informative line of a description, used to propose a summary for
// the empty-summary fix. Deterministic: first non-empty line, first
// sentence, capped at 100 characters.
function summaryFromDescription(descriptionText) {
  if (!descriptionText) {
    return null;
  }
  const line = descriptionText
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length >= 8 && !/^(steps|repro|description|summary)\s*:/i.test(l));
  if (!line) {
    return null;
  }
  const sentence = line.split(/(?<=[.!?])\s/)[0].trim();
  return sentence.length > 100 ? `${sentence.slice(0, 97).trimEnd()}…` : sentence;
}

// Finds a promised date in the summary, if any. Supported formats are
// chosen to be unambiguous: ISO (2026-11-01), "12 Nov 2026",
// "Nov 12, 2026", and "Nov 12" / "12 Nov" (year taken from `now`).
// Slash dates are intentionally unsupported: 03/04 means different
// things in different locales, and a drift detector must not guess.
const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function findPromisedDate(summary, now) {
  const candidates = [];
  const iso = summary.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    candidates.push({
      text: iso[0],
      index: iso.index,
      date: new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3])),
    });
  }
  const dmy = summary.match(
    /\b(\d{1,2})\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s(\d{4})\b/i,
  );
  if (dmy) {
    candidates.push({
      text: dmy[0],
      index: dmy.index,
      date: new Date(Date.UTC(+dmy[3], MONTHS[dmy[2].slice(0, 3).toLowerCase()], +dmy[1])),
    });
  }
  const mdy = summary.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s(\d{1,2})(?:st|nd|rd|th)?,\s(\d{4})\b/i,
  );
  if (mdy) {
    candidates.push({
      text: mdy[0],
      index: mdy.index,
      date: new Date(Date.UTC(+mdy[3], MONTHS[mdy[1].slice(0, 3).toLowerCase()], +mdy[2])),
    });
  }
  if (candidates.length === 0) {
    // Year-less forms only when nothing explicit matched: "by Nov 12".
    const dm = summary.match(
      /\b(\d{1,2})\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/i,
    );
    if (dm) {
      candidates.push({
        text: dm[0],
        index: dm.index,
        date: new Date(Date.UTC(now.getUTCFullYear(), MONTHS[dm[2].slice(0, 3).toLowerCase()], +dm[1])),
      });
    }
    const md = summary.match(
      /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s(\d{1,2})(?:st|nd|rd|th)?\b/i,
    );
    if (md) {
      candidates.push({
        text: md[0],
        index: md.index,
        date: new Date(Date.UTC(now.getUTCFullYear(), MONTHS[md[1].slice(0, 3).toLowerCase()], +md[2])),
      });
    }
  }
  for (const c of candidates) {
    // A date is a promise only when a cue word appears shortly before it.
    const before = summary.slice(Math.max(0, c.index - 20), c.index);
    if (DATE_CUE.test(before)) {
      return c;
    }
  }
  return null;
}

// Start-of-day UTC for a Date, so "promised today" is not yet stale.
function startOfDayUtc(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Compare what an issue's summary claims against its actual status.
 * See the file header for the exact input/output contract.
 */
export function checkConsistency(issue, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const summary = (issue.summary || '').trim();
  const actual = issue.statusCategory;
  const findings = [];

  // Rule: empty / placeholder summary. The summary carries no claim at
  // all, so no other rule can meaningfully run — return early.
  if (summary.length < 3 || PLACEHOLDER_SUMMARIES.has(summary.toLowerCase())) {
    findings.push({
      rule: 'empty-summary',
      claim: null,
      expectedCategory: null,
      actualCategory: actual,
      message:
        'The summary is empty or a placeholder, so the issue makes no readable claim at all — lists, boards and reports show a blank where the work should be described.',
      fix: {
        kind: 'reword-summary',
        suggestedSummary: summaryFromDescription(issue.descriptionText),
        label: 'Write a real summary',
      },
    });
    return buildResult(findings, actual);
  }

  // Rules: wording claims vs status category.
  for (const rule of CLAIM_RULES) {
    const match = summary.match(rule.pattern);
    if (!match) {
      continue;
    }
    if (actual === rule.expectsCategory) {
      continue; // the claim and the workflow agree — nothing to report
    }
    // Which side should move? If the workflow already says "done", the
    // claim word is stale text — fix the words. Otherwise the claim is
    // the newer information and the workflow has not caught up — offer
    // to move the issue to the category the claim implies.
    const fix =
      actual === 'done'
        ? {
            kind: 'reword-summary',
            suggestedSummary: stripLeadingClaim(summary, rule.pattern),
            label: 'Reword the summary',
          }
        : {
            kind: 'transition',
            toCategory: rule.expectsCategory,
            label: `Move issue to a "${rule.expectsCategory}" status`,
          };
    findings.push({
      rule: rule.rule,
      claim: match[0],
      expectedCategory: rule.expectsCategory,
      actualCategory: actual,
      message: `Summary claims ${rule.label} ("${match[0]}") but the status category is "${actual}".`,
      fix,
    });
  }

  // Rule: promised date already passed while the work is not done.
  const promised = findPromisedDate(summary, now);
  if (promised && promised.date < startOfDayUtc(now) && actual !== 'done') {
    findings.push({
      rule: 'stale-date-promise',
      claim: promised.text,
      expectedCategory: 'done',
      actualCategory: actual,
      message: `Summary promises delivery "${promised.text}", which has already passed, but the status category is "${actual}" — the date in the summary no longer tells the truth.`,
      fix: {
        kind: 'transition',
        toCategory: 'done',
        label: 'Move issue to a "done" status (or reword the date)',
      },
    });
  }

  return buildResult(findings, actual);
}

function buildResult(findings, actual) {
  const primary = findings[0] || null;
  return {
    consistent: findings.length === 0,
    findings,
    verdict:
      findings.length === 0
        ? 'Summary and status agree — no drift detected.'
        : findings.length === 1
          ? primary.message
          : `${findings.length} drifts detected. First: ${primary.message}`,
    // Skeleton-v0 compatibility fields (primary finding shortcuts).
    claim: primary ? primary.claim : null,
    expectedCategory: primary ? primary.expectedCategory : null,
    suggestedAction: primary
      ? primary.fix
        ? primary.fix.kind === 'transition'
          ? 'offer-transition'
          : 'offer-summary-reword'
        : null
      : null,
    actualCategory: actual,
  };
}
