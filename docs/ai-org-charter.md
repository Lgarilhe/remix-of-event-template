# Charte de l'équipe d'agents IA — Konekt

**Date** : 2026-07-06
**But** : faire fonctionner l'ingénierie de Konekt comme une équipe — un tech-lead, des exécutants par domaine, un contrôle qualité adversarial — mais bâtie sur les primitives réelles de Claude Code, pas sur un org-chart hors-sol.

---

## 1. Le principe : l'org-chart, mappé sur des primitives réelles

L'intuition « CTO → managers → exécutants » est juste pour **une** couche (les exécutants spécialisés) et un piège pour l'autre (une hiérarchie profonde). Un agent n'est pas un humain : il ne garde pas le contexte entre deux runs, chaque délégation **re-sérialise** le contexte, et il n'y a pas de daemon d'agents qui attendent. Donc :

- **Les exécutants** = des agents spécialisés (réels, `.claude/agents/*.md`). Grande valeur.
- **Le management** = du **code déterministe** (un workflow) + des **règles non négociables** (hooks/CI), pas un agent-manager bavard qui relaie. Plus fiable, moins cher.

Ton « entreprise d'agents » existe sous forme de 6 primitives :

| Concept humain | Primitive Claude Code | Fichier |
|---|---|---|
| Manuel de l'entreprise | `CLAUDE.md` (lu par tous) | `/CLAUDE.md` |
| Règles non négociables (le CTO qui bloque un merge) | **Hooks** + **CI** | `.claude/settings.json`, `.github/workflows/` |
| Les employés | **Agents** | `.claude/agents/*.md` |
| Les procédures / SOP | **Skills** | `.claude/skills/*.md` |
| L'organigramme / les process | **Workflows** | `.claude/workflows/*.js` |
| Les boutons | **Commandes** | `.claude/commands/*.md` |

Le « CTO agent » = le workflow + le tech-lead qui décompose et intègre. Les « managers de domaine » = des routeurs dans le workflow, pas un étage d'agents.

---

## 2. La roster

### Construits (noyau opérationnel)

| Agent | Rôle | Outils | Garde-fou signature |
|---|---|---|---|
| **`archi`** | Tech-lead : cadre la tâche (découpe front/edge/data, contrats, risques, hors-scope), écrit les ADRs, garde les frontières de modules | Read, Grep, Glob, Bash, Write | Ne code pas les features ; refuse la sur-conception |
| **`edge-dev`** | Backend edge functions Deno | `*` | Auth + tenant + crédits + timeout + passerelle LLM unique = **obligatoires** |
| **`frontend-dev`** | React/TS/shadcn | `*` | Branding, deps `useEffect` primitives, guards d'annulation, AlertDialog |
| **`security-reviewer`** | Auditeur **adversarial** (IDOR, tenant, RLS, injection, PII) | Read, Grep, Glob, Bash (lecture seule) | Prompté pour **réfuter**, ne corrige jamais → pas de masquage |

Déjà présents (QA) : **`playwright-planner`** / **`playwright-generator`** / **`playwright-healer`** (le healer ne masque jamais un bug applicatif — il le remonte).

### À ajouter quand le besoin arrive (ne pas sur-construire)

- **`db-migration`** — migrations SQL + RLS + GRANTs (la discipline de migration ; le skill `migration.md` existe déjà comme SOP).
- **`devops`** — CI/CD, deploy Vercel/Supabase, secrets, preview envs (étend `/deploy`).
- **`support-triage`** — lit Sentry / retours users, reproduit, ouvre des findings priorisés.

Règle : on ajoute un agent quand un rôle est **répété et distinct**, pas par symétrie avec un org-chart humain.

---

## 3. L'organigramme en code : le workflow `feature`

`.claude/workflows/feature.js` câble l'équipe sur une feature de bout en bout :

```
Cadrage         archi cadre → { frontendTasks, edgeTasks, dataTasks, risks, outOfScope }
   ↓
Implémentation  frontend-dev ∥ edge-dev   (zones disjointes src/ vs supabase/functions/)
   ↓
Revue           security-reviewer (adversaire) ∥ archi (conformité au plan + frontières)
```

Invocation : le runner de workflow avec `name: "feature"` et la feature en `args` (string). QA e2e (`/qa`, trio Playwright) et deploy (`/deploy`) restent des gates de suivi, volontairement hors du workflow (ils dépendent d'infra de test / d'un déploiement).

**Pourquoi ce découpage** : parallélisme réel là où les zones ne se chevauchent pas (front/edge), et **revue adversariale à deux lentilles** (sécurité + conformité archi) plutôt que redondante — c'est le pattern qui a rendu l'audit messagerie fiable (deux agents indépendants corroborant le même IDOR).

---

## 4. La couche d'enforcement (les invariants ne dépendent d'aucun agent)

Un agent peut oublier une règle ; un hook/CI ne peut pas. Les invariants critiques vivent donc en **code**, pas dans un prompt :

- **`scripts/check-branding.mjs`** — la règle « vendor names never user-facing » de CLAUDE.md, exécutable. Heuristique à faible faux-positif (match capitalisé uniquement, exclut identifiants/slugs/URLs). *Preuve que ça marche* : au moment de sa création, il a trouvé une fuite que l'audit messagerie n'avait pas vue — `ProviderLabel` (`src/components/ai/ModelLogo.tsx:66,112`) affiche « Anthropic Claude » / « Anthropic » en clair. Consommé par `security-reviewer` et destiné à la CI.
- **Hooks pre-commit** (`.claude/settings.json`) — `tsc --noEmit` + `vite build` bloquants (existant).
- **À venir (cf. `docs/engineering-transformation-plan.md`)** : gate CI PR (typecheck + lint + branding + unit), tests RLS/tenant-crossing, `strict: true` progressif. C'est là que `security-reviewer` passe de « vigilance » à « garanti ».

Principe : **les agents produisent, les hooks + la CI valident.** Personne ne « se souvient » d'être discipliné.

---

## 5. Arbitrages (où la métaphore casse)

1. **Profondeur = coût.** Max 2 niveaux (orchestrateur → exécutants). Le manager de domaine est un routeur de workflow, pas un agent intermédiaire qui relaie.
2. **Vérification adverse > redondance.** 1 chasseur + 2 réfutateurs à angles différents (correctness / sécurité / repro) valent mieux que 3 agents identiques.
3. **Pas de mémoire persistante.** La continuité vit dans git / docs / ADRs, jamais dans la tête d'un agent.
4. **Invariants critiques → hooks/CI, jamais « l'agent y pensera ».** Tenant-isolation, branding, typecheck.
5. **Calibrer à l'équipe.** Petite équipe → noyau de 4 agents, pas 12. On ajoute quand la douleur arrive.

---

## 6. Comment s'en servir

- **Tâche simple, un domaine** → délègue à l'agent adéquat (`edge-dev`, `frontend-dev`, `security-reviewer`, `archi`).
- **Feature transverse** → lance le workflow `feature` (cadrage → implémentation parallèle → revue adversariale).
- **Avant un merge** → `security-reviewer` sur le diff + `node scripts/check-branding.mjs` + QA Playwright (`/qa`).
- **Décision structurante** → `archi` produit un ADR dans `docs/adr/`.

## 7. Statut & prochaines étapes

- ✅ Noyau construit : `archi`, `edge-dev`, `frontend-dev`, `security-reviewer`, workflow `feature`, `check-branding.mjs`.
- ⏭️ Ancrer l'enforcement en CI (gate PR), ajouter `db-migration` / `devops` / `support-triage` au besoin, transformer les skills `edge-function.md` / `migration.md` en générateurs.
- ⚠️ Dette repérée en construisant : le skill `edge-function.md` enseigne le model ID **déprécié** `claude-sonnet-4-20250514` (interdit par CLAUDE.md) — à corriger ; fuite branding `ProviderLabel` ci-dessus.
