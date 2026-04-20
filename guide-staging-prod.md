# Guide Staging → Prod

**Principe n°1** : rien ne va en prod sans passer 24h en staging.
**Principe n°2** : staging doit être un miroir de prod sauf sur les données.
**Principe n°3** : staging casse. C'est son job. Il n'y a pas de "oups" en staging, il y a des découvertes.

---

## Les environnements

### `local` (ton poste)

- Supabase local (`supabase start`) + frontend Vite local.
- Données : seed fixtures seulement (fichier `supabase/seed.sql`).
- Credentials : `.env.local`, jamais commit.
- Usage : développement, tests unitaires, Playwright.

### `staging`

- URL : `https://staging.konekt.app` (à confirmer / ajuster selon config actuelle).
- Supabase staging (projet séparé, réf différente).
- Données : dataset synthétique représentatif (~2-3 tenants fictifs, candidats anonymisés). **Aucune donnée client réelle.**
- Accessible à : Laurent, Guillaume, Tiago, Thomas. Pas aux clients.
- Usage : intégration, QA 4 personas, tests contractuels, validation.

### `prod`

- URL : `https://app.konekt.app` (ou équivalent).
- Supabase prod. RLS activé. Backups automatiques.
- Données réelles, clients réels.
- **Aucun test** en prod. Aucun.
- Monitoring actif : logs structurés, alertes sur erreurs 500, quota.

---

## Workflow de déploiement

```
  feature/xxx  →  staging  →  prod
       ↑             ↑          ↑
    git push      merge PR    tag release
    feature       → main      v1.x.y
```

### 1. Développement local

- Branche `feature/<nom-court>`.
- Commits atomiques et descriptifs (`feat(sourcing): ajoute filtre graduation_year`).
- Tests locaux : `pnpm test` + `pnpm test:e2e` doivent passer.
- Fin de branche : `/qa` sur les flows touchés.

### 2. Push vers staging

- PR sur `main` (ou `develop` selon la convention du repo).
- CI GitHub Actions :
  - typecheck (`tsc --noEmit`)
  - lint (`eslint`)
  - tests unitaires (`vitest`)
  - tests E2E Playwright sur staging preview
  - audit sécurité deps (`pnpm audit`)
- Revue de code : Claude Code (`/review`) puis humain (Guillaume ou Tiago si dispo).
- Merge → déploiement staging automatique via webhook.

### 3. Validation staging

**Checklist 24h** (minimum) :

- [ ] `/qa` full 4 personas sur la feature — tout PASS
- [ ] Test Playwright de non-régression sur le flow principal — PASS
- [ ] Pas d'erreur nouvelle dans les logs staging pendant 24h
- [ ] Si la feature touche au multi-tenant : test d'étanchéité manuelle (2 comptes, 2 tenants)
- [ ] Si la feature touche aux séquences : dry-run sur dataset staging, vérifier safety limits (50 candidats max, 30 msg/jour/canal, 24h entre steps, circuit breaker OK)
- [ ] Si la feature touche à un connecteur externe (Unipile, Aircall, Outlook) : test avec un compte réel de test
- [ ] Mobile : test sur iPhone réel ou Chrome DevTools iPhone 13 portrait
- [ ] Performance : pas de régression visible (Lighthouse si UI, latence edge functions si backend)

Si **un** item fail → la feature ne va pas en prod. On corrige d'abord.

### 4. Promotion prod

**Fenêtre de déploiement** : en semaine, entre 10h et 16h. Jamais vendredi après-midi. Jamais la nuit.

Étapes :

1. Annonce Slack `#konekt-platform` : `🚀 Déploiement prod dans 10 min. Feature : <X>. Risque : <bas/moyen/élevé>.`
2. Vérifier que staging est vert depuis au moins 24h.
3. Tag release : `git tag -a v1.x.y -m "<desc>"` puis `git push --tags`.
4. Migration DB prod (si applicable) :
   - Dry-run d'abord : `supabase db diff --schema public`.
   - Vérifier qu'aucune opération destructive non-prévue n'est générée.
   - Appliquer : `supabase db push --project-ref <PROD_REF>`.
5. Déployer edge functions prod :
   - `supabase functions deploy <nom> --project-ref <PROD_REF>` par fonction touchée.
   - Ne pas tout redéployer en bloc — seulement ce qui a changé.
6. Déployer frontend prod (Lovable / Vercel / hébergeur frontend).
7. Smoke test post-deploy :
   - Login prod (compte de test dédié, tenant séparé)
   - Sourcing : ouvrir une mission, afficher candidats
   - Séquence : lister les séquences en cours, pas d'erreur
   - Mobile : vérif rapide
8. Surveiller les logs pendant 30 min. Si pic d'erreurs → rollback (`runbook-rollback.md`).
9. Annonce Slack : `✅ Prod à jour sur v1.x.y.`
10. Entry `SHIP` dans LOGBOOK.md.

---

## Différences staging vs prod — à connaître

| Aspect | Staging | Prod |
|---|---|---|
| Données | Fictives | Réelles, RGPD |
| RLS | Activé (doit être identique à prod) | Activé, audité |
| Feature flags | Tous visibles | Activation progressive |
| Backups DB | Quotidien | Quotidien + point-in-time |
| Logs | Rétention 7j | Rétention 30j, structurés |
| Rate limits | Larges | Stricts (quotas utilisateurs) |
| Connecteurs externes | Comptes de test (Unipile dev, Outlook test) | Comptes réels clients |
| Monitoring | Basique | Complet + alertes |
| Accès DB directe | Oui (équipe) | **Non** (sauf incident, avec audit) |

---

## Pièges connus (Konekt AI Platform)

### Migration Supabase avec RLS

Ajouter une colonne sur une table RLS : si la policy référence la nouvelle colonne, elle casse pour les rows existantes (NULL). **Toujours** : ajout colonne nullable → backfill → policy update → set NOT NULL si besoin. 4 étapes, 4 migrations séparées.

### Edge function qui appelle une autre edge function

Timeout Deno = 10s par défaut. Si enchaînement de 3 edge functions → risque timeout. Préférer : queue + worker, ou une seule fonction qui fait tout.

### Champs Unipile

Les noms changent parfois entre versions. Champs validés actuels : `reaction_counter` (pas `reactions_count`). Toujours vérifier sur un payload réel avant mise en prod d'un connecteur Unipile.

### JWT Supabase et tenant_id

Le `tenant_id` est dans les claims personnalisés du JWT, pas dans la session. Dans une edge function : `const { user } = await supabase.auth.getUser(jwt)` puis lire `user.app_metadata.tenant_id`. Ne **jamais** accepter un `tenant_id` depuis le body de la requête.

### Lovable ↔ GitHub sync

Casser le sync Lovable/GitHub t'oblige à recréer un projet Lovable. Protocole si tu sens que ça fragilise :
1. Push manuel vers GitHub avant toute manip de sync dans Lovable.
2. Snapshot local (`git bundle create backup.bundle --all`).
3. Si sync casse : nouveau projet Lovable, pointé sur le repo existant. Jamais l'inverse.

---

## Accès & secrets

- `.env.local` jamais commit.
- Secrets prod dans Supabase Vault. Pas dans le code. Pas dans GitHub Secrets côté frontend.
- Rotation des clés API connecteurs tous les 6 mois minimum.
- Si un secret leak (commit accidentel) : rotation immédiate + git filter-repo + force push + notification équipe.

---

## Checklist "Je suis prêt à pousser en prod"

- [ ] Feature validée 24h en staging
- [ ] `/qa` 4 personas PASS
- [ ] Tests E2E PASS
- [ ] Pas de TODO / FIXME / console.log dans le code
- [ ] CLAUDE.md et LOGBOOK.md à jour
- [ ] Migration DB dry-run OK
- [ ] Edge functions testées individuellement
- [ ] Fenêtre de déploiement appropriée
- [ ] Équipe prévenue sur Slack
- [ ] Plan de rollback mental clair (< 5 min si besoin)

Si un seul `[ ]` reste → tu n'es pas prêt. Attends.
