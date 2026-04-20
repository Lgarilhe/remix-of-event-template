# Runbook — Rollback Konekt AI Platform

**Quand l'utiliser** : un déploiement (staging ou prod) a cassé quelque chose. Latence, erreurs 500, feature cassée, données corrompues, fuite multi-tenant.

**Règle n°1** : tu ne debug pas en prod sous pression. Tu rollback, puis tu debug.
**Règle n°2** : tu communiques avant d'agir sur prod (Guillaume, Tiago, Thomas sur Slack).
**Règle n°3** : tu notes chaque étape dans LOGBOOK.md sous un entry `ROLLBACK`.

---

## Décision : est-ce que je rollback ?

| Symptôme | Rollback ? |
|---|---|
| Erreur 500 sur > 5% des requêtes | ✅ Oui, immédiat |
| Fuite de données cross-tenant | ✅ Oui, immédiat + incident sécurité |
| Feature principale cassée (sourcing / séquence / shortlist) | ✅ Oui |
| Bug UX visible mais non-bloquant | ❌ Non, hotfix via `/hotfix` |
| Bug sur feature secondaire, workaround possible | ❌ Non, ticket |
| Latence +30% mais fonctionnel | ⚠️ Dépend — si dégradation > 1h, rollback |

Si tu hésites **plus de 2 minutes** → rollback. On ne perd jamais rien à rollback, on perd toujours en prolongeant l'incident.

---

## Rollback PROD (Konekt AI Platform)

### 0. Annoncer

```
Slack #konekt-platform :
🚨 Rollback prod en cours. Cause : <1 phrase>. ETA : 5-10 min.
```

### 1. Frontend (Lovable / Vercel / hébergeur)

- Aller dans le dashboard de déploiement.
- Identifier le déploiement précédent (celui qui marchait).
- Cliquer "Promote to Production" ou équivalent.
- Vérifier que le déploiement est actif : ouvrir l'URL prod en navigation privée, tester un login.

**Temps cible** : < 3 min.

### 2. Edge functions Supabase

Si le problème vient d'une edge function déployée aujourd'hui :

```bash
# Lister les versions
supabase functions list

# Rollback à la version précédente
git checkout <SHA_précédent> -- supabase/functions/<nom>
supabase functions deploy <nom> --project-ref <PROD_REF>
```

⚠️ **Vérifier** : tester l'endpoint rollbacké avec curl + JWT valide AVANT de considérer l'étape faite.

### 3. Migration Supabase (base de données)

**Cas le plus dangereux.** Si la migration d'aujourd'hui est destructive (DROP, ALTER cassant) :

- **NE PAS rollback la migration en aveugle** — risque de perte de données.
- Restaurer depuis le backup automatique Supabase :
  1. Supabase Dashboard → Database → Backups.
  2. Identifier le dernier backup ANT la migration.
  3. **Ne pas restaurer directement** : clone dans une DB de staging, vérifier l'intégrité, comparer avec prod actuel.
  4. Si OK → faire un `pg_dump` de l'état actuel (preuve forensique), puis restore du backup.
- Si la migration était additive (ADD COLUMN, CREATE TABLE sans contrainte) : écrire une migration inverse (`DROP COLUMN`, `DROP TABLE`) et la pousser.

**Si tu hésites** : stop, appelle Guillaume ou Tiago. Ne touche pas la DB prod seul.

### 4. Séquences en cours (impact utilisateurs)

Si le rollback affecte les séquences actives :

- Ouvrir la table `sequences_runs` → passer toutes les séquences `status = 'running'` en `status = 'paused'`.
- Les remettre en `running` manuellement après validation du rollback.
- Circuit breaker doit être déclenché automatiquement ; vérifier dans les logs.

### 5. Unipile MCP / connecteurs externes

Si le rollback a changé la version de l'Unipile MCP :

- Vérifier que les webhooks entrants pointent toujours vers la bonne URL.
- Tester un envoi de message LinkedIn depuis un compte de test.
- Vérifier `reaction_counter` (pas `reactions_count`) dans les champs récupérés.

### 6. Validation

Checklist post-rollback, dans l'ordre :

- [ ] Login prod fonctionne (tester avec compte de test)
- [ ] Sourcing : ouvrir un candidat, modifier, sauver
- [ ] Séquence : lister les séquences actives, pas d'erreur
- [ ] Shortlist : ouvrir une shortlist client, pas d'erreur
- [ ] Chatbot scorecard : ouvrir une mission, lancer une question
- [ ] Mobile : ouvrir sur iPhone, pas d'erreur

Si tout OK → étape 7. Si un point KO → re-rollback ou escalation.

### 7. Annoncer la résolution

```
Slack #konekt-platform :
✅ Rollback prod terminé. Prod stable sur version <SHA>. 
Post-mortem à suivre dans LOGBOOK.md.
```

### 8. LOGBOOK.md

```markdown
## AAAA-MM-JJ — ROLLBACK — <1 ligne cause>

**Contexte** : déploiement <SHA_cassé> à HH:MM, symptômes <X>.
**Décision** : rollback vers <SHA_précédent> à HH:MM.
**Raison** : <cause racine identifiée ou "en cours d'analyse">.
**Impact** : durée incident <X min>, users affectés <estimation>, données perdues <oui/non>.
**Reste à faire** :
- [ ] Post-mortem complet
- [ ] Test de régression écrit
- [ ] Correction puis re-déploiement staging avant prod
**Refs** : commit cassé <SHA>, commit rollback <SHA>, thread Slack <URL>.
```

---

## Rollback STAGING

Même procédure que prod mais :
- Pas d'annonce Slack obligatoire (tagger Guillaume / Tiago si blocage équipe).
- Pas de restauration de backup DB nécessaire en général → on peut re-seeder.
- Pas de PII en staging → moins de risque.

---

## Post-mortem (dans les 48h après rollback)

Court. 10-15 lignes. Dans LOGBOOK.md, entry `INSIGHT`.

Sections :
1. **Timeline** (HH:MM, fait).
2. **Cause racine** (le vrai pourquoi, pas le symptôme).
3. **Ce qui aurait dû bloquer** (test manquant, check CI manquant, review manquée).
4. **Action préventive** : 1 seul item, concret, avec owner et date.

Pas de blâme. Pas de 30 pages. Un problème = une leçon = une action.

---

## Numéros & contacts d'urgence

- **Supabase support** : via dashboard projet → "Support" (plan payant requis pour prio).
- **Lovable** : Discord officiel + mention @laurent_garilhe.
- **Hostinger VPS** (MCP servers) : panel Hostinger → tickets support.
- **Guillaume Valladier** : Slack prio, puis WhatsApp si critique.

---

*Si tu suis ce runbook ligne par ligne, même sous stress, tu ne casseras rien d'irréversible.*
