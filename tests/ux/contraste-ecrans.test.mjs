/**
 * Contraste des écrans, façon Qonto, partie 2 (docs/design/01-direction.md, § 4, § 6 et § 8 ;
 * 06-simplicite.md, « Contraste » ; décisions du propriétaire du 06/10/2026) :
 *  - kanban : en clair, colonne grise et carte de candidat blanche à ombre légère ; sombre inchangé ;
 *  - lignes faites lisibles : titre au gris secondaire, jamais d'opacité sur la ligne ;
 *  - champs et bascules faits main : bord de champ, rail gris plein, option en carte blanche ;
 *  - filets décoratifs : le bord de contrôle (border-strong) ne dessine pas de cadre ;
 *  - barre latérale : icônes de la rangée basse et des têtes de ligne à la couleur du texte de la barre ;
 *  - rétrogradations : un contour d'encre pour ce qui fait avancer, le discret pour l'entretien,
 *    le discret gris pour les retraits d'envoi ;
 *  - badges faits main : texte à l'encre, couleur dans la pastille ou l'icône, sans capitales ;
 *  - aucune icône voilée par une opacité dans les fichiers repris.
 *
 * Gardes sur le source. Lancer : node --test tests/ux/contraste-ecrans.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
/** Bloc `<Button …>` qui précède un libellé écrit en JSX (le plus proche ; commentaires ignorés). */
function buttonBefore(src, label) {
  const at = src.lastIndexOf(label);
  assert.ok(at >= 0, `libellé « ${label} » introuvable`);
  const start = src.lastIndexOf('<Button', at);
  assert.ok(start >= 0, `bouton de « ${label} » introuvable`);
  return src.slice(start, at);
}

test('kanban : colonne grise et carte blanche en clair, sombre inchangé', () => {
  const board = read('src/components/missions/v3/pipeline/MissionBoard.tsx');
  assert.match(board, /rounded-\[10px\] bg-muted p-2\.5 transition-colors duration-150 dark:bg-card'/, 'colonne de la page mission');
  assert.match(board, /rounded-lg border bg-card p-2\.5 text-left text-sm shadow-sm transition-colors duration-150 ease-out dark:bg-muted dark:shadow-none'/, 'carte de la page mission');
  assert.match(board, /overlay && 'cursor-grabbing shadow-lg dark:shadow-lg'/, 'la carte glissée garde son ombre en sombre');
  assert.match(read('src/components/ats/ATSDroppableColumn.tsx'), /: 'bg-muted dark:bg-card',/, 'colonne du /pipeline');
  const card = read('src/components/ats/ATSCandidateCard.tsx');
  assert.match(card, /rounded-lg border bg-card p-2\.5 shadow-sm transition-colors duration-150 dark:bg-muted dark:shadow-none'/, 'carte du /pipeline');
  assert.match(card, /rounded-lg border border-border bg-card p-2\.5 shadow-lg dark:bg-muted"/, 'aperçu de glisser');
});

test('lignes faites : titre au gris secondaire, jamais d\'opacité sur la ligne', () => {
  const today = read('src/components/dashboard/DashboardTodayPanel.tsx');
  const tasks = read('src/components/tasks/TaskList.tsx');
  const reminders = read('src/components/missions/v3/panels/CandidateRemindersSection.tsx');
  for (const [name, src] of [['DashboardTodayPanel', today], ['TaskList', tasks], ['CandidateRemindersSection', reminders]]) {
    assert.doesNotMatch(src, /opacity-60/, `${name} : opacité`);
  }
  assert.match(today, /isDone \? 'text-muted-foreground line-through' : 'text-foreground'/, 'tâche faite de l\'accueil');
  assert.equal((today.match(/isDone \? 'text-muted-foreground' : 'text-foreground'/g) || []).length, 2, 'entretien passé et envoi parti');
  assert.match(tasks, /isCompleted \? 'text-muted-foreground line-through' : 'text-foreground'/);
  assert.match(reminders, /done \? 'text-muted-foreground line-through' : 'text-foreground'/);
  assert.match(reminders, /className="shrink-0 text-muted-foreground hover:text-danger"/, 'corbeille : geste de retrait gris, sans opacité');
});

test('champs faits main : bord de champ, désactivé sans opacité', () => {
  const top = read('src/components/missions/v3/sourcing/SourcingTopBar.tsx');
  assert.match(top, /rounded-lg border border-input bg-background pl-9/);
  assert.match(top, /disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground/);
  assert.doesNotMatch(top, /opacity-60/);
  assert.match(read('src/components/outreach/search/SourcingFlow.tsx'), /: 'border-input',/, 'invite du héros au repos');
  const icp = read('src/components/outreach/icp/ICPFormModal.tsx');
  assert.doesNotMatch(icp, /border-border focus:border-border|className="h-8 text-sm border-border"|<SelectTrigger className="h-9 border-border">/, 'ICP : surcharges retirées');
  const job = read('src/components/outreach/JobSelector.tsx');
  assert.equal((job.match(/border border-input bg-background px-3/g) || []).length, 2, 'sélecteur natif et déclencheur');
  assert.doesNotMatch(job, /selectedJob && "border-accent"|focus:shadow-sm/, 'bord gardé une fois choisi, focus visible');
});

test('bascules faites main : rail gris plein, option choisie en carte blanche (creusée en sombre)', () => {
  for (const rel of ['src/components/missions/v3/pipeline/PipelineToolbar.tsx', 'src/components/missions/v3/sourcing/SourcingResultsV3.tsx', 'src/components/missions/v3/cadrage/CriteriaSection.tsx']) {
    const src = read(rel);
    assert.doesNotMatch(src, /rounded-lg bg-muted\/60 p-0\.5/, `${rel} : rail voilé`);
    assert.match(src, /'bg-card font-semibold text-foreground dark:bg-background' : 'text-muted-foreground hover:text-foreground'/, `${rel} : option choisie`);
  }
});

test('filets décoratifs : pas de cadre au bord de contrôle, relief des cartes d\'étape', () => {
  assert.doesNotMatch(read('src/components/outreach/sequence/WorkflowCanvas.tsx'), /--border-strong-hsl/, 'grille du canevas au filet');
  assert.match(read('src/components/missions/v3/pipeline/BulkActionBar.tsx'), /rounded-xl border border-border bg-popover/);
  assert.match(read('src/components/outreach/inbox/MessageComposer.tsx'), /rounded-lg border border-border bg-card p-3 text-sm leading-relaxed text-foreground/);
  assert.match(read('src/components/sequences/editor/StepCard.tsx'), /'cursor-pointer rounded-xl border bg-card p-3 pr-11 text-left shadow-sm/);
});

test('barre latérale : icônes de la rangée basse et des têtes de ligne à la couleur du texte de la barre', () => {
  const row = read('src/components/sidebar/SidebarRow.tsx');
  assert.match(row, /items-center justify-center text-sidebar-foreground \[&>svg\]:h-4 \[&>svg\]:w-4/);
  const bottom = read('src/components/sidebar/SidebarBottomRow.tsx');
  assert.match(bottom, /'relative inline-flex items-center justify-center rounded-md text-sidebar-foreground outline-none/);
  assert.match(bottom, /active && 'bg-sidebar-accent text-sidebar-accent-foreground'/);
  assert.match(bottom, /'tabular-nums text-muted-foreground'/, 'le compteur des tâches en retard reste gris');
});

test('rétrogradations : contour aux actions qui font avancer, discret pour l\'entretien et les retraits', () => {
  const email = read('src/components/settings/MyEmailAccount.tsx');
  assert.match(buttonBefore(email, 'Rafraîchir les comptes'), /variant="ghost" size="sm" className="max-md:h-11"/, 'plus de troisième contour pleine largeur');
  assert.match(buttonBefore(read('src/components/settings/LinkedInSafetySettings.tsx'), 'Rétablir les valeurs par défaut'), /variant="ghost"/);
  const calendar = read('src/pages/Calendar.tsx');
  for (const name of ['onClick={goPrev}', 'onClick={goNext}', 'onClick={() => refetch()}']) {
    assert.match(buttonBefore(calendar, name), /variant="ghost"/, `agenda : ${name}`);
  }
  assert.match(calendar, /<Button type="button" variant="outline" onClick=\{goToday\}/, '« Aujourd\'hui » garde son contour');
  assert.match(buttonBefore(read('src/components/calendar/CalendarFiltersBar.tsx'), '<Bookmark aria-hidden="true" />\n              Vues'), /variant="ghost"/, '« Vues »');
  const tab = read('src/components/sequences/CandidatesTab.tsx');
  assert.match(tab, /case 'pause':\s*return ownRow\(e\) \? <Button type="button" variant="ghost" size="xs" className=\{retreat\}/);
  assert.match(tab, /case 'stop':\s*return ownRow\(e\) \? <Button type="button" variant="ghost" size="xs" className=\{retreat\}/);
  assert.match(tab, /const retreat = cn\(cls, 'text-muted-foreground'\);/);
  assert.equal((tab.match(/variant="ghost" size="sm" className="text-muted-foreground max-md:h-11" loading=\{bulkBusy === '(pause|stop)'\}/g) || []).length, 2, 'barre de sélection : pause et arrêt en discret gris');
  assert.match(tab, /variant="outline" size="sm" className="max-md:h-11" loading=\{bulkBusy === 'resume'\}/, '« Reprendre » garde son contour');
  const panel = read('src/components/outreach/SequenceEnrollmentsPanel.tsx');
  assert.equal((panel.match(/className="text-muted-foreground hover:text-danger max-md:h-11 max-md:w-full"/g) || []).length, 2, 'suivi : pause et arrêt groupés');
  assert.match(buttonBefore(read('src/components/outreach/SequenceActivityLog.tsx'), 'Ne pas envoyer cette étape\n'), /variant="ghost"[\s\S]*text-muted-foreground hover:text-danger/);
  assert.match(buttonBefore(read('src/components/outreach/CandidateSequencesPanel.tsx'), 'Mettre en pause pour ce candidat'), /variant="ghost"[\s\S]*text-muted-foreground/);
});

test('badges faits main : texte à l\'encre, couleur dans la pastille ou l\'icône, sans capitales', () => {
  const cv = read('src/components/ats/candidate-detail/CVTab.tsx');
  assert.doesNotMatch(cv, /uppercase tracking-wider px-1\.5 py-0\.5 rounded-full bg-success\/10 text-success/);
  assert.equal((cv.match(/<Badge variant="success" className="shrink-0">/g) || []).length, 2, 'CV principal');
  assert.match(read('src/components/missions/v3/panels/CandidatePanelHeader.tsx'), /badgeVariants\(\{ variant: 'warning' \}\), 'ml-2 translate-y-\[-1px\] align-middle text-2xs'/, '« sans mouvement »');
  const badges = read('src/components/outreach/result-card/CardStatusBadges.tsx');
  assert.doesNotMatch(badges, /bg-(success|info|warning) text-(success|info|warning)-foreground/, 'plus d\'aplat de couleur à texte blanc');
  assert.doesNotMatch(badges, /(?<![:\w-])text-(success|warning|destructive|info|brand-purple)\b(?!-)/, 'la couleur ne porte plus le texte (elle reste dans l\'icône)');
  const table = read('src/components/outreach/search/CompactResultsTable.tsx');
  assert.doesNotMatch(table, /uppercase tracking-wider font-bold/, 'statut sans capitales');
  assert.match(table, /variant: 'success' as const/);
  const refine = read('src/components/outreach/search/RefineSearchModal.tsx');
  // text-*-foreground (blanc en clair, vert ou brun très sombre en sombre) rendait titres, icônes et libellés illisibles.
  assert.doesNotMatch(refine, /text-(success|warning)-foreground/, 'texte blanc sur teinte pâle');
  assert.match(refine, /<Badge variant=\{impact\.variant\} className="text-xs">/);
  const jobScore = read('src/components/outreach/JobScoreDisplay.tsx');
  assert.doesNotMatch(jobScore, /text-emerald-700|text-amber-700/, 'verdicts aux jetons de statut');
  assert.match(read('src/components/outreach/QuotaDisplay.tsx'), /badgeVariants\(\{ variant: 'success' \}\), 'cursor-help'/, '« Mode protégé »');
  const shared = read('src/components/missions/process/shared.tsx');
  assert.match(shared, /\? badgeVariants\(\{ variant: inv\.status === 'accepted' \? 'success'/, 'invitations : badge derrière embedded');
  assert.match(shared, /inv\.status === 'accepted' \? "border-success\/30 text-success bg-success\/10"/, 'ancien rendu gardé hors embedded');
});

test('aucune icône voilée par une opacité dans les fichiers repris', () => {
  const ICON_OPACITY = /<[A-Z][A-Za-z0-9]*\s+className=\{?[`'"(][^>]*\bopacity-[3-7]0\b/;
  for (const rel of [
    'src/components/missions/v3/panels/CandidatePanelHeader.tsx',
    'src/components/missions/v3/pipeline/BulkActionBar.tsx',
    'src/components/outreach/FilterComponents.tsx',
    'src/components/outreach/InvitationsPanel.tsx',
    'src/components/outreach/JobSelector.tsx',
  ]) {
    assert.doesNotMatch(read(rel), ICON_OPACITY, `${rel} : icône à opacité`);
  }
});

test('bouton à contour dont l\'appel change la couleur du bord : le sombre suit (pas de filet blanc qui fuit)', () => {
  // Le contour d'encre du sombre (dark:border-foreground/70) n'est pas remplacé par une classe
  // border-* sans préfixe : un appel qui change la couleur du bord la redonne aussi en sombre.
  // Exceptions : l'ancienne page mission (inchangée) et border-foreground (le contour lui-même).
  const OLD_PAGE = new Set(['src/components/outreach/projects/ProjectCandidatesTableEnhanced.tsx']);
  const COLOR = /(?<![\w:-])(?:hover:)?border-(?!(?:0|2|4|8|t|b|l|r|x|y|s|e|solid|dashed|dotted|none|foreground)\b)[a-z][\w/[\]-]*/g;
  const leaks = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (rel !== 'src/components/ui') walk(rel); continue; }
      if (!rel.endsWith('.tsx') || OLD_PAGE.has(rel)) continue;
      const src = read(rel);
      for (const m of src.matchAll(/<Button\b/g)) {
        let depth = 0;
        let end = -1;
        for (let i = m.index; i < Math.min(src.length, m.index + 3000); i++) {
          const c = src[i];
          if (c === '{') depth++;
          else if (c === '}') depth--;
          else if (c === '>' && depth === 0) { end = i; break; }
        }
        if (end < 0) continue;
        const tag = src.slice(m.index, end);
        const variant = /variant=(?:"(\w+)"|\{([^}]*)\})/.exec(tag);
        if (variant?.[1] && !['outline', 'default', 'secondary'].includes(variant[1])) continue;
        if (variant?.[2] && !/outline|default|secondary/.test(variant[2])) continue;
        const cls = /className=(?:"([^"]*)"|\{([\s\S]*?)\}\s*(?:\w+=|$))/.exec(tag);
        const classes = cls ? (cls[1] ?? cls[2] ?? '') : '';
        if ((classes.match(COLOR) || []).length > 0 && !classes.includes('dark:border')) {
          leaks.push(`${rel}:${src.slice(0, m.index).split('\n').length}`);
        }
      }
    }
  };
  walk('src');
  assert.deepEqual(leaks, [], 'bord changé à l\'appel sans équivalent en sombre');
  assert.match(read('src/components/outreach/result-card/CardActions.tsx'), /border-transparent hover:border-transparent dark:border-transparent dark:hover:border-transparent/, '« Coordonnées » discret aussi en sombre');
});

test('tuiles et lignes de liste faites en Button : le rayon d\'une tuile, jamais l\'ovale cerclé du bouton', () => {
  // Un Button sur plusieurs lignes (h-auto, puis whitespace-normal ou flex-col) qui porte un bord (variante à contour, ou classe border)
  // prend le rayon d'une tuile ou d'une ligne (rounded-lg, rounded-xl…) : avec le rounded-full de la
  // base, c'était un ovale cerclé d'encre (packs de crédits, choix de « Nouvelle séquence », réponses
  // proposées de la messagerie, candidat choisi de l'inscription). Une tuile prend le filet décoratif
  // (ghost, border-border, hover:border-foreground), pas le contour d'encre réservé aux boutons.
  const shapeless = [];
  const inkTiles = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (rel !== 'src/components/ui') walk(rel); continue; }
      if (!rel.endsWith('.tsx')) continue;
      const src = read(rel);
      for (const m of src.matchAll(/<Button\b/g)) {
        let depth = 0;
        let quote = null;
        let end = -1;
        for (let i = m.index + 1; i < Math.min(src.length, m.index + 3000); i++) {
          const c = src[i];
          if (quote) { if (c === quote) quote = null; continue; }
          if (c === '"' || c === "'" || c === '`') quote = c;
          else if (c === '{') depth++;
          else if (c === '}') depth--;
          else if (c === '>' && depth === 0) { end = i; break; }
        }
        if (end < 0) continue;
        const tag = src.slice(m.index, end);
        if (!/(?<![\w:-])h-auto\b/.test(tag)) continue;
        const variant = /variant=(?:"(\w+)"|\{([^}]*)\})/.exec(tag);
        const name = variant ? (variant[1] ?? variant[2]) : 'default';
        const contoured = /\b(?:outline|default|secondary)\b/.test(name);
        const bordered = contoured || /(?<![\w:-])border(?![\w-])/.test(tag);
        // Sur plusieurs lignes : le texte revient à la ligne ou s'empile (une puce d'une ligne reste une pilule).
        const multiline = /(?<![\w:-])(?:flex-col|whitespace-normal)\b/.test(tag);
        const where = `${rel}:${src.slice(0, m.index).split('\n').length}`;
        if (bordered && multiline && !/(?<![\w:-])rounded-(?!full\b)[\w[\]-]+/.test(tag)) shapeless.push(where);
        if (contoured && multiline) inkTiles.push(where);
      }
    }
  };
  walk('src');
  assert.deepEqual(shapeless, [], 'Button sur plusieurs lignes avec un bord, sans rayon de tuile');
  assert.deepEqual(inkTiles, [], 'tuile de texte au contour d\'encre (passer en ghost, rounded-xl border border-border hover:border-foreground)');
  assert.match(read('src/components/outreach/enrollment-preview/CandidateSidebarCard.tsx'), /'h-auto w-full min-w-0 items-start justify-start gap-2\.5 whitespace-normal rounded-lg border /, 'candidat de l\'inscription : une ligne, pas un ovale');
  assert.match(read('src/components/outreach/enrollment-preview/CandidateSidebarCard.tsx'), /isSelected \? 'border-border-strong bg-accent' : 'border-transparent'/, 'ligne choisie : bord de contrôle (bg-accent seul : 1,16:1)');
});

test('bouton repeint d\'un aplat : désactivé et chargement lisibles (jamais un libellé gris sur l\'aplat)', () => {
  // Les variantes à contour et ghost grisent le libellé désactivé (disabled:text-muted-foreground) sans
  // toucher au fond : un aplat posé à l'appel garde sa couleur et le libellé gris s'y perd (2,71:1 sur
  // l'encre, 1,20:1 sur le bleu LinkedIn, 1,13:1 sur brand-solid). Un aplat d'encre passe par primary ;
  // un aplat de couleur ajoute disabled:bg-muted, et aria-busy:… s'il a un état de chargement.
  const FILL = /(?<![\w:/!-])bg-(?:foreground|primary|brand|brand-solid|linkedin|success|warning|danger|destructive|info)(?![\w/-])/;
  const inkFills = [];
  const unreadable = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (rel !== 'src/components/ui') walk(rel); continue; }
      if (!rel.endsWith('.tsx')) continue;
      const src = read(rel);
      for (const m of src.matchAll(/<Button\b/g)) {
        let depth = 0;
        let quote = null;
        let end = -1;
        for (let i = m.index + 1; i < Math.min(src.length, m.index + 3000); i++) {
          const c = src[i];
          if (quote) { if (c === quote) quote = null; continue; }
          if (c === '"' || c === "'" || c === '`') quote = c;
          else if (c === '{') depth++;
          else if (c === '}') depth--;
          else if (c === '>' && depth === 0) { end = i; break; }
        }
        if (end < 0) continue;
        const tag = src.slice(m.index, end);
        const variant = /variant=(?:"(\w+)"|\{([^}]*)\})/.exec(tag);
        const name = variant ? (variant[1] ?? variant[2]) : 'default';
        if (/^(?:primary|destructive)$/.test(name)) continue;
        const where = `${rel}:${src.slice(0, m.index).split('\n').length}`;
        if (/(?<![\w:/!-])bg-foreground(?![\w/-])[\s\S]*?(?<![\w:/!-])text-background\b/.test(tag)) inkFills.push(where);
        if (FILL.test(tag) && /\s(?:disabled|loading)[=\s]/.test(tag) && !/(?<![\w-])disabled:bg-/.test(tag)) unreadable.push(where);
        if (/\sloading[=\s]/.test(tag) && FILL.test(tag) && !/aria-busy:text-/.test(tag)) unreadable.push(`${where} (chargement)`);
      }
    }
  };
  walk('src');
  assert.deepEqual(inkFills, [], 'aplat d\'encre fait main sur une variante à contour (passer en variant="primary")');
  assert.deepEqual(unreadable, [], 'aplat sans désactivé lisible');
  assert.match(read('src/components/missions/v3/pipeline/ContactSelectionButton.tsx'), /<Button variant="primary" size="sm" disabled>/, '« Contacter » sans compte relié');
  assert.match(read('src/components/outreach/AutoFillFiltersButton.tsx'), /disabled:bg-muted dark:border-transparent aria-busy:bg-brand-solid aria-busy:text-brand-solid-foreground/);
});

test('champs faits main : focus en anneau plein comme Input, jamais le halo transparent ; désactivés sans opacité', () => {
  // Halo ring-[3px] ring-ring/20 : 1,29:1, à côté de l'anneau plein des primitives (4,55:1 au pire).
  const halos = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (!/^src\/components\/(ui|landing|public|portal)$/.test(rel)) walk(rel); continue; }
      if (!rel.endsWith('.tsx')) continue;
      const src = read(rel);
      for (const m of src.matchAll(/ring-ring\/20|ring-\[3px\]/g)) halos.push(`${rel}:${src.slice(0, m.index).split('\n').length}`);
    }
  };
  walk('src');
  assert.deepEqual(halos, [], 'halo de focus transparent hors des primitives');
  const job = read('src/components/missions/v3/cadrage/JobSection.tsx');
  assert.match(job, /'disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground'/, 'liste native du Cadrage');
  const steps = read('src/components/missions/v3/cadrage/InterviewStepsSection.tsx');
  assert.doesNotMatch(steps, /disabled:opacity-/, 'Cadrage : modèles d\'étapes et intervieweur');
  assert.match(steps, /group-disabled:text-muted-foreground/, 'modèle d\'étapes désactivé : libellé gris');
  assert.match(read('src/components/missions/MissionHuntMode.tsx'), /const EMB_INPUT = '[^']*border-input[^']*disabled:border-border disabled:bg-muted disabled:text-muted-foreground/, 'champs du mode chasse, rendu intégré');
  const composer = read('src/components/outreach/inbox/MessageComposer.tsx');
  assert.match(composer, /aria-disabled:cursor-not-allowed aria-disabled:text-muted-foreground/, '« Rendez-vous » sans lien : libellé gris, sans opacité');
  assert.doesNotMatch(composer, /aria-disabled:opacity-/);
  assert.doesNotMatch(read('src/components/missions/v3/sourcing/SourcingResultsV3.tsx'), /disabled:opacity-/, '« Relancer avec les nouveaux filtres »');
  assert.doesNotMatch(read('src/components/sequences/SettingsTab.tsx'), /disabled:opacity-/, 'Réglages en lecture seule : les champs portent leur désactivé');
});

test('invite du Sourcing et puces de filtres : le focus se voit, les champs ont un bord de champ', () => {
  const flow = read('src/components/outreach/search/SourcingFlow.tsx');
  // Au repos border-input et l'ancien bord de focus (--k-hairline-focus) ont la même valeur.
  assert.match(flow, /focused \? 'border-ring ring-1 ring-ring' : 'border-input',/, 'héros : focus en anneau plein');
  assert.match(flow, /const chipField = isV3 \? 'border-input focus:border-ring' : 'border-\[var\(--k-hairline\)\] focus:border-\[var\(--k-hairline-focus\)\]';/);
  assert.match(flow, /const chipPop = isV3 \? 'border-border' : 'border-\[var\(--k-hairline-focus\)\]';/);
  assert.equal((flow.match(/border \$\{chipField\}/g) || []).length, 13, 'tous les champs des puces');
  assert.equal((flow.match(/border \$\{chipPop\}/g) || []).length, 3, 'menus des puces');
  assert.doesNotMatch(flow, /border border-\[var\(--k-hairline\)\][^"`]*focus:border-\[var\(--k-hairline-focus\)\]/, 'plus de champ au filet en dur');
});

test('illustration dans une fenêtre : sans tuile (la tuile de surface carte y ferait un creux en sombre)', () => {
  assert.match(read('src/components/missions/v2/BriefAnalysisPanel.tsx'), /<Illustration name="brief" size="sm" tile=\{false\} className="mx-auto mb-4" \/>/);
  assert.match(read('docs/design/01-direction.md'), /ou dans une fenêtre \(surface `popover`\)/);
});
