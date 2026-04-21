# LOGBOOK.md — Journal de bord Konekt AI Platform

Un entry par décision, spec, insight, ou action majeure. Ajouté en fin de chaque conversation pro importante avec Claude Code. Du plus récent en haut.

**Format strict** : date ISO, type, titre, corps. Pas de padding, pas d'emoji dans les titres, pas de "j'ai fait" — seulement le fait.

---

## Template d'entry

```markdown
## AAAA-MM-JJ — <TYPE> — <Titre court>

**Contexte** : 1-2 phrases.
**Décision / Fait** : ce qui a été tranché ou livré.
**Raison** : pourquoi (si non évident).
**Impact** : fichiers touchés, modules, users concernés.
**Reste à faire** : bullets courts. `[ ]` ouvert, `[x]` fait.
**Refs** : commit SHA, ticket, URL Notion, page Airtable.
```

**Types autorisés** :
- `DECISION` — choix d'architecture, de lib, de process
- `SPEC` — nouvelle feature spécifiée (sortie de /spec)
- `SHIP` — déploiement (staging ou prod)
- `INSIGHT` — apprentissage, gotcha, surprise technique
- `BUG` — bug identifié (ouvert ou fermé)
- `REFACTOR` — restructuration significative
- `SECURITY` — finding sécurité (audit, fix, alerte)
- `ROLLBACK` — retour arrière
- `MEETING` — synthèse d'une discussion externe (client, équipe)

---

## 2026-04-20 — INSIGHT — Migration Lovable Cloud bloquée, plan révisé

**Contexte** : tentative de migration Lovable Cloud → Supabase konekt-production via supabase db push (173 migrations versionnées). Bloqué après 70 migrations sur des conflits de CREATE POLICY redondants.

**Cause racine** : les migrations historiques contiennent des CREATE POLICY identiques sur les mêmes tables, créés à différents moments du dev sans DROP IF EXISTS préalable. Joué sur une base vide ils se contredisent.

**Décision** : abandonner l'approche migration-by-migration. Reprendre samedi avec un dump SQL complet du schéma actuel Lovable Cloud.

**Décision metier** : ne migrer QUE les tables structurelles (organizations, members, profiles, subs, configs). Ignorer airtable_*, aircall_*, notion_*, knowledge_chunks, match_scores. Repartir clean pour commercialisation.

**Reste à faire** : voir MIGRATION_PLAN.md.

---

## 2026-04-20 — DECISION — Migration Lovable Cloud → Supabase préparée

**Contexte** : Lovable Cloud verrouillé (85 tables, 78 edge functions, 4 users). Migration vers Supabase externe pour retirer le vendor lock-in avant commercialisation.

**État de préparation** :
- Supabase konekt-production créé (ref: crckfywoyjxkawathdff, eu-west-3)
- Credentials sauvegardés dans supabase-creds.txt local
- CLI 2.90.0 installée et linkée au projet
- 175 migrations SQL et 78 edge functions déjà versionnées dans le repo → migration largement automatisable

**Reste à faire (ce week-end, 4-5h)** :
- [ ] Installer Docker Desktop
- [ ] supabase db push (migrations)
- [ ] supabase functions deploy --all
- [ ] Setter secrets (Anthropic, Apollo, Unipile, Aircall, Airtable, etc.)
- [ ] Export CSV data Lovable Cloud → import Supabase
- [ ] Script Node migration users
- [ ] Nouveau projet Lovable branché sur konekt-production
- [ ] Tests complets avant bascule

---

## 2026-04-20 — INSIGHT — Workflow Lovable + garde-fous Claude Code validés

**Contexte** : setup check final sur worktree `hungry-rhodes-5ca453`, branche `claude/hungry-rhodes-5ca453`.
**Synthèse** :
1. Hooks `PreToolUse` sur `Bash(git commit:*)` déclenchent `tsc --noEmit` + `vite build --mode production` et bloquent le commit si l'un échoue — fichiers traces `/tmp/tsc-check.txt` et `/tmp/vite-build.txt`.
2. Skill `/qa` chargé avec 4 personas (Guillaume power-user, Claire DRH client, Théo edge-case sécurité, Sophie freelance mobile) — règle absolue : touche à `requireAuth`/`verifyOrgMembership`/RLS = Théo obligatoire.
3. LOGBOOK.md adopté comme journal source de vérité : une entry par décision/insight, format strict daté ISO, newest-first, pas de PII client.
4. Workflow standard confirmé : branche feature + PR vers main (Lovable deploy prod depuis main), aucun push direct main sans confirmation explicite — option A recommandée, option C demande warning.
5. Option B validée aujourd'hui : `git push -u origin <branche>` sans PR = sauvegarde propre sans déclencher redeploy Lovable.

**Impact** : `.claude/settings.json` (hooks), `.claude/skills/qa.md` (QA), `LOGBOOK.md` (journal), branche distante `claude/hungry-rhodes-5ca453`.
**Refs** : commits `ae81aac8` (test hooks) + commit à venir (cette synthèse).

---

## 2026-04-20 — INSIGHT — Hooks préflight tsc + vite vérifiés sur worktree

**Contexte** : setup check final sur worktree `hungry-rhodes-5ca453`.
**Fait** : hooks `PreToolUse` sur `Bash(git commit:*)` exécutent `npx tsc --noEmit` puis `npx vite build --mode production` et bloquent le commit si l'un échoue.
**Impact** : `.claude/settings.json` (config hooks confirmée).
**Refs** : worktree `hungry-rhodes-5ca453`, commit de vérification à venir.

---

## 2026-04-20 — DECISION — Package Claude Code consolidé livré

**Contexte** : 25 fichiers (CLAUDE.md + 15 skills + settings + 4 guides + LOGBOOK + PROMPTS + routines) prêts à être déposés dans le repo Konekt AI Platform.
**Décision** : structure finale adoptée, plus de versions parallèles.
**Raison** : éviter la dérive documentaire et les règles contradictoires entre fichiers.
**Impact** : `CLAUDE.md`, `.claude/settings.json`, `skills/*.md` remplacent toute version antérieure.
**Reste à faire** :
- [ ] Déposer le package dans le repo
- [ ] Tester /go sur une feature réelle
- [ ] Ajuster PROMPTS.md après 2 semaines d'usage
**Refs** : conversation du 2026-04-20.

---

## Règles d'usage

1. **Une ligne suffit si c'est tout ce qui est vrai.** Pas d'étirement artificiel.
2. **Pas de PII client dans LOGBOOK.md.** Noms de candidats, emails, téléphones interdits. Remplacer par des IDs.
3. **Les `BUG` ouverts restent en haut** jusqu'à fermeture (flag `[RESOLVED]` dans le titre + date de résolution).
4. **Chaque `SHIP` référence le commit SHA et la cible** (staging ou prod).
5. **Relecture hebdo** : lundi matin, parcourir les 7 derniers jours. Ce qui est `[ ]` depuis 7+ jours → soit fait, soit fermé, soit escaladé.

---

## Anti-patterns à éviter

- ❌ `J'ai implémenté la feature X` → le verbe à la 1ère personne n'ajoute rien.
- ✅ `SPEC — Feature X : scope, contrats, limites`.

- ❌ Entry de 10 paragraphes avec code inline → mettre le code dans le repo, lier le commit.
- ✅ Entry de 5 bullets + `Refs: <SHA>`.

- ❌ `INSIGHT — Claude Code est cool` → vide.
- ✅ `INSIGHT — Playwright échoue sur Safari mobile à cause de <raison précise>, workaround : <X>`.

---

*Ce fichier est lu par Claude Code en début de chaque conversation via la skill /status. Garder concis pour ne pas polluer le contexte.*
