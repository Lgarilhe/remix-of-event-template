import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

/** Composants réels, sans serveur, identité ni fournisseur calendrier. */
export async function calendarDemoHarnessHtml() {
  const root = process.cwd();
  const fixture = path.join(root, 'e2e/fixtures/calendar-demo');
  const bundle = await build({
    entryPoints: [path.join(fixture, 'main.tsx')],
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
    loader: { '.svg': 'dataurl', '.webp': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl' },
    alias: {
      '@/components/SEOHead': path.join(fixture, 'mocks.tsx'),
      '@/components/tasks/CreateTaskModal': path.join(fixture, 'mocks.tsx'),
      '@/components/calendar/CreateEventModal': path.join(fixture, 'mocks.tsx'),
      '@/hooks/useCalendarEvents': path.join(fixture, 'mocks.tsx'),
      '@/hooks/useAuthReady': path.join(fixture, 'mocks.tsx'),
      '@/integrations/supabase/client': path.join(fixture, 'mocks.tsx'),
      '@': path.join(root, 'src'),
    },
  });
  const css = await postcss([tailwindcss({ config: path.join(root, 'tailwind.config.ts') })])
    .process(await readFile(path.join(root, 'src/index.css'), 'utf8'), { from: path.join(root, 'src/index.css') });
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agenda QA</title><style>${css.css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
}
