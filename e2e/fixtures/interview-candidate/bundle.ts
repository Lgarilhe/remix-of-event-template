import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

/** Vrais ATS, CandidateDetailModal et EvaluationTab ; lectures et grille observées localement. */
export async function interviewCandidateHarnessHtml() {
  const root = process.cwd();
  const fixture = path.join(root, 'e2e/fixtures/interview-candidate');
  const mocked = new Set([
    'components/SEOHead', 'hooks/useATSData', 'hooks/useOrganization', 'hooks/useAuthReady', 'hooks/useEnrollmentPreview',
    'integrations/supabase/client', 'hooks/useCandidateFullProfile', 'hooks/useMyLinkedInAccountId',
    'contexts/AgentContext', 'lib/candidateContacts', 'components/outreach/CandidateSequencesPanel',
    'components/outreach/result-card/CardMessageThread', 'components/outreach/result-card/ProfileDetailSheet',
    'components/ats/ATSKanban', 'components/ats/ATSTable', 'components/ats/ATSTimeline',
    'components/ats/ATSPipelineAnalytics', 'components/ats/ATSFilters', 'components/ats/ATSStats',
    'components/ats/ATSKanbanSkeleton', 'components/ats/ATSTableSkeleton', 'components/ats/RemindersSidebar',
    'components/ats/JobDetailSheet', 'components/ats/BulkActionsBar', 'components/ats/ScorecardTab',
    'components/ats/FraudDetectionTab', 'components/ats/candidate-detail',
    'components/ats/candidate-detail/CVTab', 'components/ats/candidate-detail/OverviewTab',
    'components/ats/candidate-detail/ProfileDetailedTab', 'components/ats/candidate-detail/ManualContactsEditor',
    'components/ats/candidate-detail/PrepSheetTab', 'components/ats/candidate-detail/ScoringCard',
    'components/missions/v3/pipeline/CandidateListRow',
    'components/dashboard/CandidateAvatar',
  ].map(p => path.join(root, 'src', p)));
  const bundle = await build({
    entryPoints: [path.join(fixture, 'main.tsx')], bundle: true, write: false,
    platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
    loader: { '.svg': 'dataurl', '.webp': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl' },
    plugins: [{ name: 'interview-boundaries', setup(buildApi) {
      buildApi.onResolve({ filter: /^(@\/|\.)/ }, args => {
        const full = args.path.startsWith('@/') ? path.join(root, 'src', args.path.slice(2)) : path.resolve(args.resolveDir, args.path);
        if (mocked.has(full)) return { path: path.join(fixture, 'mocks.tsx') };
        return undefined;
      });
    } }],
    alias: { '@': path.join(root, 'src') },
  });
  const css = await postcss([tailwindcss({ config: path.join(root, 'tailwind.config.ts') })])
    .process(await readFile(path.join(root, 'src/index.css'), 'utf8'), { from: path.join(root, 'src/index.css') });
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fiche entretien QA</title><style>${css.css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
}
