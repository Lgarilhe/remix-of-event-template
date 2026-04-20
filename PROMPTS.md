# PROMPTS.md — Bibliothèque Konekt

Prompts prêts à coller. Tous suivent les règles CLAUDE.md : investiguer avant de demander, anti-duplication, minimalisme.

---

## 🔍 Investigation & Audit

### Comprendre un module inconnu
```
Mappe le module `src/modules/<NOM>` : entrypoints, dépendances internes, dépendances croisées avec d'autres modules, edge functions associées, tables Supabase touchées. Renvoie un arbre + un paragraphe d'intention. Pas de suggestion de refacto à ce stade.
```

### Trouver un doublon
```
Cherche dans le repo toute fonction, composant ou edge function qui fait la même chose que `<CHOSE>`. Liste les candidats avec chemin + 3 lignes de signature. Ne modifie rien.
```

### Détecter les imports cross-module interdits
```
Liste tous les imports qui violent la règle "un module importe uniquement depuis shared/ ou depuis lui-même". Format : fichier source → import interdit. Ne corrige pas encore.
```

---

## 🧱 Construction

### Nouvelle feature (spec-first)
```
Feature : <DESCRIPTION EN 1 LIGNE>
Module cible : <sourcing|sequences|scoring|messaging|candidates|companies|config-studio|auth>
User type concerné : <client-final|cabinet-esn|freelance>

Étape 1 : /spec — liste les cas d'usage, les écrans touchés, les tables Supabase, les edge functions, les RLS, les limites (rate, safety).
Étape 2 : /plan — découpe en sous-tâches < 2h chacune.
Étape 3 : attends mon GO avant /build.
```

### Edge function Supabase
```
Crée une edge function `<nom>` qui :
- prend <INPUT>
- valide avec zod
- vérifie le JWT et extrait le tenant_id
- fait <ACTION>
- logge en structured JSON (niveau, tenant_id, user_id, action, duration_ms, result)
- renvoie <OUTPUT>

Tests vitest en parallèle. Pas de console.log, utilise le logger. Gère les erreurs métier (throw Response 4xx) et systèmes (throw Response 500 générique, log full stack).
```

### Composant UI (workflow Lovable → Claude Code)
```
Composant `<NOM>` généré dans Lovable : chemin <PATH>.
Je veux que tu :
1. Vérifies l'accessibilité (aria-label, focus, contraste AA).
2. Extraies la logique métier dans un hook `use<Nom>` dans `src/modules/<module>/hooks/`.
3. Remplaces tout `any` par des types stricts depuis `shared/types/`.
4. Ajoutes un test Vitest pour le hook et un test Playwright pour le flow complet.
Ne touche pas au JSX visuel (Lovable le régénère).
```

---

## 🧪 Test & QA

### Test Playwright E2E
```
Écris un test Playwright pour le flow <DESCRIPTION>, multi-tenant :
- seed 2 tenants via fixture
- connecte-toi tenant A, exécute le flow
- vérifie que les données sont invisibles depuis tenant B (via API directe ET via UI)
- cleanup via fixture teardown
Nomme le fichier `tests/e2e/<module>/<flow>.spec.ts`.
```

### Test de régression sur bug corrigé
```
Bug corrigé : <DESCRIPTION> (commit <SHA>).
Écris le test qui aurait catché ce bug. Il doit FAIL sur le commit parent et PASS sur le commit de fix. Fichier dans `tests/regression/`.
```

### QA 4 personas
```
Lance /qa sur la feature <NOM>. Rapport sous forme de tableau. Si fail → listé dans LOGBOOK.md avec priorité.
```

---

## 🔐 Sécurité

### Audit RLS d'une table
```
Table Supabase `<nom>`. Audit RLS :
1. Liste toutes les policies (SELECT, INSERT, UPDATE, DELETE).
2. Pour chaque policy, décris en français quand elle autorise l'action.
3. Identifie les trous : y a-t-il un user_type qui peut accéder à des données d'un autre tenant ?
4. Propose un test SQL qui prouve l'étanchéité.
Ne modifie rien, c'est un rapport.
```

### Audit d'une edge function
```
Edge function `<nom>`. Checklist :
- [ ] JWT validé ?
- [ ] tenant_id extrait et utilisé dans chaque requête ?
- [ ] Inputs validés avec zod ?
- [ ] Pas de secret en clair (process.env OK) ?
- [ ] Rate limit ?
- [ ] Logs structurés sans PII sensible ?
- [ ] Idempotence pour les actions d'écriture ?
Rapport avec statut par point + plan de correction si écart.
```

---

## ♻️ Refactor

### Extraire un module
```
Le code de `<domaine>` est éparpillé dans <LISTE DE CHEMINS>. Je veux un module `src/modules/<domaine>/` propre :
- composants dans `components/`
- hooks dans `hooks/`
- types dans `types.ts`
- logique métier dans `services/`
- imports depuis `shared/` uniquement
Propose d'abord un plan de migration fichier par fichier. J'approuve avant que tu bouges quoi que ce soit.
```

### Nettoyer les morts
```
Trouve dans le repo :
- fichiers non importés (dead code)
- exports jamais utilisés
- dépendances npm non importées
- tables Supabase non référencées dans le code
- edge functions non appelées
Liste. Ne supprime rien sans mon GO explicite par item.
```

---

## 🚀 Déploiement

### Preflight avant /ship
```
Avant déploiement de <BRANCHE> sur <staging|prod> :
1. git status clean ?
2. tests unitaires passent ?
3. Playwright E2E passent ?
4. /qa 4 personas fait ?
5. migrations Supabase dry-run OK ?
6. edge functions compilent ?
7. CLAUDE.md à jour ?
8. LOGBOOK.md : entrée créée ?
Checklist avec status. Bloquant si un item KO.
```

### Rollback
```
Déploiement <VERSION> casse <DESCRIPTION>. Applique runbook-rollback.md. Étape par étape, confirme à chaque étape avant de passer à la suivante.
```

---

## 🗂️ Sourcing & Plateforme (méta)

### Relance la skill konekt-sourcing sur une fiche
```
Fiche de poste : <COLLE LA FICHE>
Lance la skill konekt-sourcing. Je veux : fiche analysée, vivier Airtable recherché d'abord, puis Apollo multi-angles, puis LinkedIn via Unipile MCP. Messages d'approche J0 prêts, 50-70 mots, un fait vérifiable, pas de tirets cadratins.
```

### Ajouter un connecteur au Connector Framework
```
Nouveau connecteur : <NOM> (<SERVICE>).
1. Respecte l'interface `IConnector` dans `src/connectors/core/`.
2. OAuth ou API key dans Supabase Vault, jamais en clair.
3. Gère les 429 avec backoff exponentiel + jitter.
4. Expose `health()` pour le health check global.
5. Logs structurés avec connector_name.
Tests d'intégration mockés. Documentation dans `docs/connectors/<nom>.md`.
```

---

## 💬 Meta

### Fin de conversation importante
```
Résume cette conversation au format LOGBOOK.md : décisions prises, specs validées, insights, actions en attente. Ajoute la section à la fin de LOGBOOK.md avec la date du jour.
```

### Demande d'explication (Laurent n'est pas dev)
```
Explique-moi <CHOSE TECHNIQUE> en français, sans jargon. 3-5 phrases max. Si je dois prendre une décision, donne-moi 2 options max avec leurs conséquences concrètes pour Konekt (pas pour "le code").
```
