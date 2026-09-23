/**
 * Barre latérale, lot 6 : onglet Assistant et renommage « Assistant » (C4).
 *
 * Invariants épinglés, par inspection de source :
 *   - la bulle flottante est retirée, Ctrl K reste (A2, §5.3) ;
 *   - AgentContext expose startNewConversation, qui relance le panneau par le
 *     nonce comme openConversation ; le compteur non lu de la bulle disparaît ;
 *   - l'effet du nonce du panneau vide le poste choisi sur un fil neuf ;
 *   - renommage D12 : plus de « copilot », « copilote » ni « agents IA » dans
 *     les textes visibles du front, ni dans les libellés et messages serveur ;
 *   - panneau Assistant : nouvelle conversation, reprise, lien /agents,
 *     indicateur fixe (sans animation), Récentes sans exclusion par statut ;
 *   - palette : un nom par page (Agenda, Messagerie) ;
 *   - résumés d'action serveur sans tiret long (titres des lignes À valider).
 *
 * Sans navigateur ni base. Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** Fichiers .ts et .tsx d'un dossier, récursivement (dossiers exclus en paramètre). */
const walk = (dir, skip = []) => {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (skip.includes(rel) || name === 'node_modules') continue;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel, skip));
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
};

/** Littéraux de chaîne et textes JSX, sans commentaires ni chemins d'import (patron de lot2-parametres-coquille). */
const visibleStrings = (src) => {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
    .replace(/\bfrom\s+(['"])[^'"\n]*\1/g, '')
    .replace(/^\s*import\s+(['"])[^'"\n]*\1/gm, '')
    .replace(/\bimport\(\s*(['"])[^'"\n]*\1\s*\)/g, '');
  return [
    ...[...code.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]),
    ...[...code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]),
    ...[...code.matchAll(/`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1]),
    ...[...code.matchAll(/>([^<>{}=;]*[A-Za-zÀ-ÿ][^<>{}=;]*)(?=[<{])/g)].map((m) => m[1].trim()),
  ];
};

const OLD_NAMES = /copilot|copilote|agents? IA/i;

const drawer = read('src/components/agent/AgentDrawer.tsx');
const context = read('src/contexts/AgentContext.tsx');
const chatPanel = read('src/components/agent/AgentChatPanel.tsx');
const panel = read('src/components/sidebar/assistant/AssistantPanel.tsx');
const recent = read('src/hooks/sidebar/useAssistantRecent.ts');
const palette = read('src/components/layout/NavigationPalette.tsx');
const mutations = read('supabase/functions/_shared/agent-tools-mutations.ts');

test('B6A-1 : bulle retirée, Ctrl K gardé', () => {
  assert.doesNotMatch(drawer, /AgentFAB/);
  assert.doesNotMatch(drawer, /HIDDEN_FAB_ROUTES/);
  assert.doesNotMatch(drawer, /Ouvrir l'agent IA/);
  assert.ok(drawer.includes("e.key === 'k'"), 'gestionnaire Ctrl K absent');
  assert.ok(drawer.includes('toggleAgent()'), 'toggleAgent() absent');
});

test('B6A-2 : startNewConversation relance par le nonce, plus de compteur non lu', () => {
  assert.ok(context.includes('startNewConversation'));
  const bumps = context.split('setOpenRequestNonce((n) => n + 1)').length - 1;
  assert.ok(bumps >= 2, `nonce relancé ${bumps} fois (openConversation et startNewConversation attendus)`);
  assert.doesNotMatch(context, /setUnreadCount/);
  assert.doesNotMatch(context, /unreadCount/);
  // Le fil neuf part sans conversation, sans contexte de mission.
  const body = context.slice(context.indexOf('const startNewConversation'));
  const fn = body.slice(0, body.indexOf('}, []);'));
  for (const call of ['setConversationId(null)', 'setProjectId(null)', 'setContextMode(null)', 'setIsOpen(true)']) {
    assert.ok(fn.includes(call), `startNewConversation : ${call} absent`);
  }
});

test('B6A-3 : l\'effet du nonce vide le poste choisi sur un fil neuf', () => {
  const start = chatPanel.indexOf('const handledNonceRef = useRef(openRequestNonce)');
  assert.ok(start > 0, 'effet du nonce introuvable');
  const effect = chatPanel.slice(start, chatPanel.indexOf('}, [openRequestNonce]);', start));
  assert.match(effect, /if \(!conversationId\) setSelectedJob\(null\);/);
  assert.ok(effect.includes('seedFrom(conversationId)'));
});

test('B6A-4 : renommage D12, aucun ancien nom dans les textes visibles', () => {
  const offenders = [];
  for (const rel of walk('src', ['src/integrations'])) {
    for (const text of visibleStrings(read(rel))) {
      if (OLD_NAMES.test(text)) offenders.push(`${rel} : « ${text.slice(0, 80)} »`);
    }
  }
  assert.deepEqual(offenders, []);

  const serverFiles = [
    'supabase/functions/search-agent-chat/index.ts',
    'supabase/functions/_shared/ai-config.ts',
    'supabase/functions/_shared/conversation-compaction.ts',
    'supabase/functions/_shared/user-memory.ts',
    'supabase/functions/_shared/agent-tools-mutations.ts',
  ];
  for (const rel of serverFiles) {
    const src = read(rel);
    for (const m of src.matchAll(/\b(description|label|reason):\s*(['"`])((?:(?!\2)[^\\]|\\.)*)\2/g)) {
      assert.doesNotMatch(m[3], OLD_NAMES, `${rel} : ${m[1]} « ${m[3].slice(0, 80)} »`);
    }
  }
  const chat = read('supabase/functions/search-agent-chat/index.ts');
  const promptLine = chat.split('\n').find((l) => l.includes('const freeSystemPrompt ='));
  assert.ok(promptLine, 'prompt libre introuvable');
  assert.doesNotMatch(promptLine, OLD_NAMES);
  assert.ok(promptLine.includes("Tu es l'assistant IA de Konekt"));

  // Libellés de crédits alignés front et serveur, sans tiret long.
  for (const rel of ['src/types/aiCredits.ts', 'supabase/functions/_shared/ai-config.ts']) {
    const src = read(rel);
    for (const label of [
      'Assistant, titre de conversation',
      "Assistant, routage d'intention",
      'Assistant, résumé de conversation',
      'Assistant, mémorisation',
      'Assistant, chat (par message)',
    ]) {
      assert.ok(src.includes(`"${label}"`), `${rel} : « ${label} » absent`);
    }
  }
});

test('B6A-5 : panneau Assistant', () => {
  for (const needle of ['startNewConversation', 'openConversation', 'Nouvelle conversation']) {
    assert.ok(panel.includes(needle), `AssistantPanel : ${needle} absent`);
  }
  assert.match(panel, /to=["']\/agents["']/, 'lien vers /agents absent');
  assert.doesNotMatch(panel, /animate-/, 'indicateur fixe : aucune animation');
  assert.ok(panel.includes('<ApprovalsSection variant="assistant" />'));
  assert.ok(panel.includes('Toutes les conversations'));
  assert.ok(panel.includes("Posez une question à l'assistant ou confiez-lui une recherche."));
  // Chaque ouverture ferme d'abord la feuille sur téléphone.
  assert.ok((panel.match(/closeMobile\(\);/g) ?? []).length >= 2);
});

test('B6A-6 : Récentes, lecture bornée et exclusion par identifiant', () => {
  for (const needle of [
    ".eq('created_by', userId)",
    ".eq('organization_id', organizationId)",
    ".is('archived_at', null)",
    '.limit(30)',
    'if (error) throw error',
  ]) {
    assert.ok(recent.includes(needle), `useAssistantRecent : ${needle} absent`);
  }
  assert.doesNotMatch(recent, /\.not\('status'/);
  assert.doesNotMatch(recent, /placeholderData/);
  assert.match(recent, /'sidebar', 'assistant-recent'/);

  assert.match(panel, /signals\.plans\.map\(\(p\) => p\.id\)/);
  assert.match(panel, /signals\.running\.map\(\(r\) => r\.id\)/);
  assert.match(panel, /!shownElsewhere\.has\(c\.id\)/);
  assert.match(panel, /const RECENT_LIMIT = 8;/);
  assert.match(panel, /\.slice\(0, RECENT_LIMIT\)/);
});

test('B6A-7 : palette, un nom par page', () => {
  const item = (path) => {
    const at = palette.indexOf(`go('${path}')`);
    assert.ok(at > 0, `entrée ${path} absente`);
    return palette.slice(at, palette.indexOf('</CommandItem>', at));
  };
  assert.match(item('/calendar'), /\n\s*Agenda\n/);
  assert.match(item('/inbox'), /\n\s*Messagerie\n/);
  assert.match(item('/agents'), /\n\s*Assistant\n/);
  const texts = visibleStrings(palette);
  assert.ok(!texts.some((t) => t.includes('Calendrier')), 'Calendrier encore présent');
  assert.ok(!texts.some((t) => /Agents IA/.test(t)), 'Agents IA encore présent');
  assert.ok(palette.includes("Ouvrir l'assistant"));
});

test('B6A-8 : résumés d\'action serveur sans tiret long', () => {
  const lines = mutations.split('\n').filter((l) => /\bsummary:/.test(l));
  assert.ok(lines.length > 0);
  for (const line of lines) assert.ok(!line.includes('—'), line.trim());
  assert.ok(mutations.includes('summary: `Mettre à jour le brief de "${jobLabel}" : champs ${fieldsChanged}`'));
  assert.ok(mutations.includes('summary: `Mettre à jour les quotas LinkedIn de ${memberLabel} : '));
});

test('e2e : chat-connectors passe par l\'onglet Assistant', () => {
  const spec = read('e2e/flows/chat-connectors.spec.ts');
  assert.doesNotMatch(spec, /Ouvrir l'agent IA/);
  assert.ok(spec.includes("getByRole('tab', { name: 'Assistant' })"));
  assert.ok(spec.includes("getByRole('button', { name: 'Nouvelle conversation' }).first()"));
});
