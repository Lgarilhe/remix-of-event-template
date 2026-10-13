import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

/** Même famille et mêmes graisses que main.tsx ; les fichiers restent dans le HTML du banc. */
async function instrumentSansStyles(root: string) {
  const fontRoot = path.join(root, 'node_modules/@fontsource/instrument-sans');
  const styles = await Promise.all([400, 500, 600, 700].map(async weight => {
    let css = await readFile(path.join(fontRoot, `${weight}.css`), 'utf8');
    for (const match of [...css.matchAll(/url\(([^)]+)\)/g)]) {
      const fontPath = match[1].replace(/^['"]|['"]$/g, '');
      const font = await readFile(path.resolve(fontRoot, fontPath));
      const mime = fontPath.endsWith('.woff2') ? 'font/woff2' : 'font/woff';
      css = css.replace(match[0], `url(data:${mime};base64,${font.toString('base64')})`);
    }
    return css;
  }));
  return styles.join('\n');
}

/** Real mission, search, filter UI and React lifecycle; remote boundaries only. */
export async function sourcingReturnHarnessHtml(entry = 'main.tsx') {
  const root = process.cwd();
  const fixture = path.join(root, 'e2e/fixtures/sourcing-return');
  const mocked = new Set([
    'integrations/supabase/client', 'hooks/useOrganization', 'hooks/useAuthReady', 'hooks/useAuth',
    'contexts/LinkedInAccountsContext', 'hooks/useMemberLinkedInAccounts', 'contexts/AgentContext',
    'hooks/useAgentMemories', 'hooks/useSourcingProjects', 'hooks/useJobCandidateStatus',
  ].map(file => path.join(root, 'src', file)));
  const baselineFiles = new Set(['src/components/outreach/LinkedInSearch.tsx', 'src/hooks/useFilteredLinkedInAccounts.ts', 'src/components/missions/MissionSourcing.tsx',
    'src/components/missions/v3/sourcing/SourcingResultsV3.tsx', 'src/hooks/useLinkedInSearchActions.ts']);
  const observedSources = new Set([...baselineFiles, 'src/hooks/useLinkedInSearch.ts',
    'src/hooks/useLinkedInScoring.ts', 'src/lib/invokeWithCredits.ts', 'src/lib/invokeEdgeFunction.ts',
    'src/components/outreach/search/SearchResultsPanel.tsx', 'src/components/missions/v3/sourcing/SourcingResultsV3.tsx',
    'src/components/missions/v3/sourcing/SourcingSearchFeedback.tsx',
    'src/components/missions/v3/sourcing/SourcingTopBar.tsx', 'src/lib/sourcingSearchLifecycle.ts']);
  const sourceHashes: Record<string, string> = {};
  const bundle = await build({
    entryPoints: [path.join(fixture, entry)], bundle: true, write: false,
    platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: '/qa-api', VITE_SUPABASE_PUBLISHABLE_KEY: 'fixture-only' }) },
    loader: { '.svg': 'dataurl', '.webp': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl' },
    plugins: [{ name: 'sourcing-fixture-boundaries', setup(api) {
      api.onResolve({ filter: /^(@\/|\.)/ }, args => {
        const full = args.path.startsWith('@/') ? path.join(root, 'src', args.path.slice(2)) : path.resolve(args.resolveDir, args.path);
        if (mocked.has(full)) return { path: path.join(fixture, 'mocks.tsx') };
      });
      api.onLoad({ filter: /\.(tsx|ts)$/ }, args => {
        const relative = path.relative(root, args.path);
        if (!observedSources.has(relative)) return;
        const contents = process.env.SOURCING_QA_BASELINE === '1' && baselineFiles.has(relative)
          ? execFileSync('git', ['show', 'HEAD:' + relative], { cwd: root, encoding: 'utf8' })
          : readFileSync(args.path, 'utf8');
        sourceHashes[relative] = createHash('sha256').update(contents).digest('hex');
        return { contents, loader: relative.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: path.dirname(args.path) };
      });
    } }],
    alias: { '@': path.join(root, 'src') },
  });
  const cssSource = await readFile(path.join(root, 'src/index.css'), 'utf8');
  sourceHashes['src/index.css'] = createHash('sha256').update(cssSource).digest('hex');
  const css = await postcss([tailwindcss({ config: path.join(root, 'tailwind.config.ts') })])
    .process(cssSource, { from: path.join(root, 'src/index.css') });
  const fonts = await instrumentSansStyles(root);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sourcing QA</title><style>${fonts}\n${css.css}</style></head><body><div id="root"></div><script>window.qaSourceHashes=${JSON.stringify(sourceHashes)};${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
}
