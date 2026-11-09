import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  Heading,
  Inline,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  Textfield,
} from '@forge/react';
import { invoke, view } from '@forge/bridge';

// ---------------------------------------------------------------------------
// IncidentBridge — Jira issue panel
//
// Shows the consistency verdict for the issue being viewed: the summary
// claims one thing, the workflow status says another → drift. The
// resolver (`analyzeIssue`) runs the shared engine; this panel renders
// every finding and offers the fix attached to it.
//
// Fixes are applied only when the user presses a fix button
// (`applyFix` resolver). After a fix, the panel re-checks the issue so
// what is on screen always reflects the issue's real state. A separate
// button creates a linked JSM follow-up request for the issue.
// ---------------------------------------------------------------------------

const App = () => {
  const [result, setResult] = useState(null);
  const [issueKey, setIssueKey] = useState(null);
  const [notice, setNotice] = useState(null); // { appearance, text }
  const [busy, setBusy] = useState(false);
  const [summaryDrafts, setSummaryDrafts] = useState({}); // finding idx -> edited summary

  const load = useCallback(async (key) => {
    const data = await invoke('analyzeIssue', key ? { issueKey: key } : {});
    setResult(data);
  }, []);

  useEffect(() => {
    // The issue key comes deterministically from the view context —
    // never from user input — so the panel always checks the issue on
    // screen.
    view
      .getContext()
      .then((ctx) => {
        const key =
          ctx && ctx.extension && ctx.extension.issue ? ctx.extension.issue.key : null;
        setIssueKey(key);
        return load(key);
      })
      .catch(() => load(null));
  }, [load]);

  const applyFix = async (fix, findingIndex) => {
    setBusy(true);
    setNotice(null);
    const summary =
      fix.kind === 'reword-summary'
        ? summaryDrafts[findingIndex] || fix.suggestedSummary
        : undefined;
    const outcome = await invoke('applyFix', { issueKey, fix, summary });
    setBusy(false);
    setNotice({
      appearance: outcome.applied ? 'success' : 'warning',
      text: outcome.detail,
    });
    if (outcome.applied) {
      await load(issueKey); // re-check so the verdict reflects reality
    }
  };

  const createJsmFollowUp = async () => {
    setBusy(true);
    setNotice(null);
    const outcome = await invoke('applyFix', { issueKey, fix: { kind: 'link-jsm' } });
    setBusy(false);
    setNotice({
      appearance: outcome.applied ? 'success' : 'warning',
      text: outcome.detail,
    });
  };

  if (!result) {
    return (
      <Box padding="space.200">
        <Inline alignBlock="center" space="space.100">
          <Spinner size="medium" />
          <Text>Checking summary against status…</Text>
        </Inline>
      </Box>
    );
  }

  const { issue, consistent, verdict, findings, source } = result;

  return (
    <Box padding="space.200">
      <Stack space="space.200">
        <Heading as="h3">IncidentBridge</Heading>
        <Text>
          {issue.key}: “{issue.summary || '(no summary)'}” — status: {issue.statusName} (
          {issue.statusCategory})
        </Text>
        {source === 'fixture' && (
          <SectionMessage title="Demo data" appearance="information">
            <Text>
              Live read unavailable, so this verdict uses the built-in demo issue. Deploy the
              app to a site to check the real issue.
            </Text>
          </SectionMessage>
        )}
        {notice && (
          <SectionMessage
            title={notice.appearance === 'success' ? 'Fix applied' : 'Fix not applied'}
            appearance={notice.appearance}
          >
            <Text>{notice.text}</Text>
          </SectionMessage>
        )}
        {consistent ? (
          <SectionMessage title="Consistent" appearance="success">
            <Text>{verdict}</Text>
          </SectionMessage>
        ) : (
          <>
            <SectionMessage title="Summary and status disagree" appearance="warning">
              <Text>{verdict}</Text>
            </SectionMessage>
            {findings.map((finding, i) => (
              <Stack key={finding.rule} space="space.100">
                <Inline space="space.100" alignBlock="center">
                  <Lozenge appearance="inprogress">{finding.rule}</Lozenge>
                  {finding.claim && <Lozenge appearance="moved">“{finding.claim}”</Lozenge>}
                </Inline>
                <Text>{finding.message}</Text>
                {finding.fix && finding.fix.kind === 'reword-summary' && (
                  <Textfield
                    label="Corrected summary"
                    placeholder="Write a summary that matches the status"
                    value={summaryDrafts[i] || finding.fix.suggestedSummary || ''}
                    onChange={(e) =>
                      setSummaryDrafts((drafts) => ({ ...drafts, [i]: e.target.value }))
                    }
                  />
                )}
                {finding.fix && (
                  <Inline space="space.100">
                    <Button
                      appearance="primary"
                      isDisabled={busy}
                      onClick={() => applyFix(finding.fix, i)}
                    >
                      {finding.fix.label}
                    </Button>
                  </Inline>
                )}
              </Stack>
            ))}
            <Inline space="space.100">
              <Button isDisabled={busy} onClick={createJsmFollowUp}>
                Create linked JSM follow-up
              </Button>
            </Inline>
          </>
        )}
      </Stack>
    </Box>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
