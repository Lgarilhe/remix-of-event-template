/**
 * Design simplifié, lot Suite 2 : la messagerie (/inbox) suit les règles de
 * docs/design/06-simplicite.md, comme le Pipeline global et les Tâches.
 *  - titre de page à 28 px, plus de bouton « Actualiser » (la liste se relit
 *    toutes les 30 s), bascule de la page mission, filtres sans compte ;
 *  - lignes : étiquette et intention en texte discret, sans pastille ;
 *    « À répondre » en orange ; les non-lus en gras, sans pastille chiffrée
 *    (le nombre reste lu) ; le logo du canal seulement hors LinkedIn ;
 *  - conversation : état de l'inscription en mots à côté du nom, « Inscrire
 *    dans une séquence » discret, panneau vide sans cadre ;
 *  - composeur : la mise en forme dans un menu, le nombre de suggestions sans
 *    couleur, « Envoyer » seul bouton plein.
 *
 * Rendu statique des lignes et du badge d'état (esbuild, alias @/ par
 * tsconfig.app.json, base et contextes remplacés par des modules vides),
 * gardes sur le source pour la colonne, la conversation et le composeur.
 * Lancer : node --test tests/ux/messagerie-simplicite.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
/** Code sans commentaires : les commentaires citent ce qui a été retiré. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const STUBS = {
  'integrations/supabase/client': 'export const supabase = {};',
  'hooks/useChatStatus': 'export const useChatStatus = () => globalThis.__chatStatus;',
  'contexts/AttendeePicturesContext': 'export const useAttendeePicturesContext = () => ({ getPicture: () => null, fetchPicture: () => {} });',
};
const stubs = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /(integrations\/supabase\/client|hooks\/useChatStatus|contexts\/AttendeePicturesContext)$/ }, (args) => ({
      path: Object.keys(STUBS).find((k) => args.path.endsWith(k)),
      namespace: 'stub',
    }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js' }));
  },
};

const { outputFiles } = await build({
  stdin: {
    contents: [
      "export { ChatListItem } from './src/components/outreach/inbox/ChatListItem';",
      "export { EnrollmentStatusBadge } from './src/components/outreach/SequenceBadges';",
      "export { TooltipProvider } from './src/components/ui/tooltip';",
      "export { createElement } from 'react';",
      "export { renderToStaticMarkup } from 'react-dom/server.browser';",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  loader: { '.webp': 'empty', '.svg': 'empty', '.png': 'empty' },
  tsconfig: join(ROOT, 'tsconfig.app.json'),
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [stubs],
});
const kit = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
globalThis.__chatStatus = { getSnoozedUntil: () => null, getArchivedAt: () => null };

const h = kit.createElement;
const render = (component, props) => kit.renderToStaticMarkup(h(kit.TooltipProvider, null, h(component, props)));

const MINUTE = 60_000;
const chat = (over = {}) => ({
  id: 'chat_ines',
  account_id: 'acc_demo',
  account_type: 'LINKEDIN',
  timestamp: new Date(Date.now() - 5 * MINUTE).toISOString(),
  unread_count: 2,
  folder: ['INBOX', 'INBOX_LINKEDIN_CLASSIC'],
  attendees: [{ id: 'att_ines', provider_id: 'demo-cand-0', name: 'Inès Durand', specifics: { occupation: 'Staff Engineer Go' } }],
  last_message: { text: 'Le poste m’intéresse.', is_sender: false, timestamp: new Date(Date.now() - 5 * MINUTE).toISOString() },
  ...over,
});
const enrollments = new Map([
  ['demo-cand-0', { job_title: 'Lead Developer Backend', status: 'active', replied_at: null, current_step_order: 1 }],
]);
const row = (props) =>
  render(kit.ChatListItem, {
    chat: chat(),
    isSelected: false,
    enrollmentsMap: enrollments,
    category: null,
    onSetCategory: () => {},
    onClick: () => {},
    ...props,
  });

test('Ligne non lue : « À répondre » en orange, gras, nombre lu sans pastille, intention en texte', () => {
  const html = row({ intent: { intent: 'wants_call', confidence: 0.9, summary: 'Propose un appel jeudi.' } });
  assert.match(html, /class="inline-flex shrink-0 items-center gap-1 font-medium text-warning">[\s\S]*?À répondre<\/span>/);
  assert.doesNotMatch(html, /text-brand/, 'plus d’accent de marque sur l’état');
  assert.match(html, /<span class="sr-only">2 messages non lus<\/span>/);
  assert.doesNotMatch(html, /rounded-full bg-brand/, 'plus de pastille chiffrée');
  assert.match(html, /font-semibold">Inès Durand</, 'les non-lus en gras');
  assert.match(html, /<span class="min-w-0 shrink-\[3\] truncate text-xs text-muted-foreground" title="Propose un appel jeudi\.">Veut un appel<\/span>/);
  assert.doesNotMatch(html, /text-success|text-info|bg-success|bg-info/, 'l’intention sans couleur');
  assert.match(html, /Lead Developer Backend/, 'la mission de l’inscription reste');
});

test('Étiquette posée à la main : en texte, elle l’emporte sur l’intention', () => {
  const html = row({ chat: chat({ unread_count: 0 }), category: 'to_recontact', intent: { intent: 'timing_issue', confidence: 0.8 } });
  assert.match(html, />À recontacter<\/span>/);
  assert.doesNotMatch(html, /Pas le bon moment/);
  assert.doesNotMatch(html, /text-warning/, 'lue : rien en orange');
  assert.match(html, /En attente/, 'inscription en cours sans réponse');
});

test('Canal : rien sur le visage pour LinkedIn, le logo pour un autre canal', () => {
  const linkedin = row({});
  assert.doesNotMatch(linkedin, /ring-1 ring-border/, 'pas de pastille LinkedIn sur chaque visage');
  const whatsapp = row({ chat: chat({ account_type: 'WHATSAPP' }) });
  assert.match(whatsapp, /absolute -bottom-0\.5 -right-0\.5 grid h-4 w-4 place-items-center rounded-full bg-background ring-1 ring-border/);
});

test('Liste repliée : un point orange pour les non-lus, sans chiffre, le nombre dans le nom accessible', () => {
  const html = row({ collapsed: true });
  assert.match(html, /aria-label="Inès Durand, 2 messages non lus"/);
  assert.match(html, /<span aria-hidden="true" class="absolute -right-0\.5 -top-0\.5 h-2\.5 w-2\.5 rounded-full bg-warning ring-2 ring-background"><\/span>/);
  assert.doesNotMatch(html, />2<\/span>/);
});

test('État d’inscription : en mots avec plain, même libellé que la pastille', () => {
  const plain = render(kit.EnrollmentStatusBadge, { status: 'active', plain: true });
  const badge = render(kit.EnrollmentStatusBadge, { status: 'active' });
  const label = badge.replace(/<[^>]+>/g, '');
  assert.equal(plain, `<span>${label}</span>`);
  assert.match(render(kit.EnrollmentStatusBadge, { status: 'paused', pauseReason: 'manual', plain: true }), /^<span>[^<]+<\/span>$/);
});

test('Colonne : titre à 28 px, plus d’« Actualiser », bascule quiet, filtres sans compte', () => {
  const src = code('src/components/outreach/inbox/ChatListSidebar.tsx');
  assert.match(src, /<h1 className="text-title font-semibold text-foreground">Messagerie<\/h1>/);
  assert.doesNotMatch(src, /Actualiser|RefreshCw/, 'la liste se relit seule toutes les 30 s');
  assert.match(src, /<SegmentedControl\s+aria-label="Conversations affichées"\s+variant="quiet"/);
  assert.doesNotMatch(src, /withCount|statusCounts|Count\)/, 'plus de « (0) » dans les filtres');
  assert.match(src, /<ErrorState[\s\S]*?onRetry=\{onRefresh\}/, '« Réessayer » reste sur une panne');
  assert.match(read('src/hooks/useMessagesInbox.ts'), /const intervalId = setInterval\(pollChats, 30_000\);/);
});

test('Conversation : état en mots près du nom, inscription discrète, panneau vide sans cadre', () => {
  const src = read('src/components/outreach/inbox/MessageView.tsx');
  assert.match(src, /<EnrollmentStatusBadge status=\{enrollmentStatus\} pauseReason=\{enrollmentPauseReason\} plain \/>/);
  assert.match(src, /<span className="sr-only">Séquence : <\/span>/);
  assert.match(src, /<Button variant="ghost" size="sm" onClick=\{onEnrollInSequence\}/);
  assert.match(src, /className="w-full max-w-sm border-0"/);
  assert.match(src, /\{channel !== 'linkedin' && \(/);
});

test('Composeur : mise en forme dans un menu, nombre de suggestions neutre, un seul bouton plein', () => {
  const src = read('src/components/outreach/inbox/MessageComposer.tsx');
  assert.match(src, /aria-label="Mise en forme" className=\{TOOL_ICON\}/);
  assert.doesNotMatch(src, /sm:hidden|hidden items-center gap-0\.5 sm:flex/, 'plus de barre de mise en forme à part');
  assert.match(src, /<DropdownMenuShortcut>\{cmd\}\+B<\/DropdownMenuShortcut>/, 'les raccourcis restent dits');
  assert.match(src, /<span className="tabular-nums text-muted-foreground">\{aiSuggestionsCount\}<\/span>/);
  assert.doesNotMatch(src, /bg-brand\/15/);
  assert.equal((src.match(/variant="primary"/g) || []).length, 2, 'Envoyer, et l’action d’un dialogue');
});
