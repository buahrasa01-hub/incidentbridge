import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  DynamicTable,
  EmptyState,
  Heading,
  Inline,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Text,
} from '@forge/react';
import { invoke, view } from '@forge/bridge';

// ---------------------------------------------------------------------------
// IncidentBridge — Jira project page
//
// One row per drifted issue in the project: where the board is lying,
// in a single list a lead can work through before standup. The
// `scanProject` resolver fetches the project's issues (bounded) and
// runs the same consistency engine the issue panel and the Rovo
// actions use; this page only renders the result.
// ---------------------------------------------------------------------------

const head = {
  cells: [
    { key: 'issue', content: 'Issue' },
    { key: 'summary', content: 'Summary' },
    { key: 'status', content: 'Status' },
    { key: 'drift', content: 'Drift' },
    { key: 'fix', content: 'Suggested fix' },
  ],
};

const App = () => {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    view
      .getContext()
      .then((ctx) => {
        const projectKey =
          ctx && ctx.extension && ctx.extension.project ? ctx.extension.project.key : null;
        return invoke('scanProject', projectKey ? { projectKey } : {});
      })
      .then(setResult)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <Box padding="space.200">
        <SectionMessage title="Scan failed" appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      </Box>
    );
  }

  if (!result) {
    return (
      <Box padding="space.200">
        <Inline alignBlock="center" space="space.100">
          <Spinner size="medium" />
          <Text>Scanning the project for summary/status drift…</Text>
        </Inline>
      </Box>
    );
  }

  const rows = (result.drifted || []).map((entry) => ({
    key: entry.issue.key,
    cells: [
      { key: 'issue', content: <Text>{entry.issue.key}</Text> },
      { key: 'summary', content: <Text>{entry.issue.summary || '(no summary)'}</Text> },
      {
        key: 'status',
        content: (
          <Lozenge appearance="inprogress">
            {entry.issue.statusName} ({entry.issue.statusCategory})
          </Lozenge>
        ),
      },
      {
        key: 'drift',
        content: (
          <Stack space="space.050">
            {entry.findings.map((f) => (
              <Text key={f.rule}>{f.message}</Text>
            ))}
          </Stack>
        ),
      },
      {
        key: 'fix',
        content: (
          <Text>
            {entry.findings
              .map((f) => (f.fix ? f.fix.label : ''))
              .filter(Boolean)
              .join('; ') || '—'}
          </Text>
        ),
      },
    ],
  }));

  return (
    <Box padding="space.200">
      <Stack space="space.200">
        <Heading as="h2">IncidentBridge — project drift scan</Heading>
        <Text>
          Scanned {result.scanned} issues in {result.projectKey || 'this project'};{' '}
          {(result.drifted || []).length} have a summary that disagrees with the workflow
          status.
        </Text>
        {rows.length === 0 ? (
          <EmptyState
            header="No drift found"
            description="Every scanned issue's summary agrees with its status. The board is telling the truth."
          />
        ) : (
          <DynamicTable head={head} rows={rows} />
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
