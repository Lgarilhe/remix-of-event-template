# Routines — Guide d'usage

Laurent n'est pas développeur. Ces routines sont conçues pour qu'un flux de travail propre émerge sans effort cognitif. Toutes s'exécutent avec une skill `/` + un geste manuel court.

---

## 🌅 Daily — Début de journée (3 min)

**But** : savoir où tu en es sans ouvrir 12 fichiers.

1. Ouvrir Claude Code dans le repo Konekt AI Platform.
2. Lancer `/status`.
   - Affiche : branche courante, tickets en cours, derniers commits, entries `[ ]` ouverts dans LOGBOOK.md, erreurs non-résolues dans health check.
3. Choisir une seule priorité pour la matinée.
4. Lancer `/kickoff <sujet>` → Claude prépare le contexte (lit les fichiers pertinents, résume, propose un plan).

**Anti-pattern** : ouvrir 3 chats en parallèle. Un focus à la fois.

---

## 🏁 Daily — Fin de journée (2 min)

**But** : rien ne se perd entre deux sessions.

1. Lancer `/update-docs` → Claude met à jour CLAUDE.md et LOGBOOK.md avec ce qui a été décidé / livré aujourd'hui.
2. Vérifier le résumé. Si OK → commit `docs: journal <date>`.
3. Pousser sur la branche perso (pas sur `main`).

**Si une décision non-triviale a été prise** : demander à Claude d'ajouter une entry `DECISION` dans LOGBOOK.md avec Contexte / Décision / Raison / Impact.

---

## 📅 Weekly — Lundi matin (15 min)

**But** : dette, sécurité, et direction.

1. `/audit` → audit sécurité rapide : RLS cohérent, nouvelles edge functions correctement protégées, secrets pas en clair, dépendances npm avec CVE.
2. `/health` → état runtime : erreurs Sentry/logs de la semaine, edge functions qui timeout, Supabase storage/DB quota.
3. Relire LOGBOOK.md des 7 derniers jours :
   - Chaque `[ ]` ouvert depuis 7+ jours → décider : faire, fermer, escalader.
   - Chaque `BUG` non-résolu → prioriser.
4. Ajuster la roadmap dans Notion (page "Konekt AI Platform — Roadmap") si nécessaire.

---

## 📅 Weekly — Vendredi fin de journée (10 min)

**But** : bilan + préparer la semaine prochaine.

1. Relire les 5 commits les plus importants de la semaine → rédiger 3 lignes dans LOGBOOK.md sous un entry `MEETING — Bilan semaine <S>`.
2. Prévoir la feature principale de la semaine suivante. `/spec <feature>` si pas encore fait.
3. Fermer les onglets, fermer Claude Code, fermer l'IDE. Weekend.

---

## 🗓️ Monthly — Premier lundi du mois (30 min)

**But** : hygiène du repo et de la doc.

1. `/refactor` mode audit : Claude liste tous les candidats à refactor (duplication, dette, imports cross-module, fichiers > 300 lignes).
2. Revue de CLAUDE.md :
   - Les règles sont-elles encore vraies ?
   - De nouvelles règles ont-elles émergé dans LOGBOOK.md ?
   - Si oui → mettre à jour CLAUDE.md.
3. Revue de PROMPTS.md : quels prompts je n'utilise plus ? Lesquels me manquent ?
4. Purge des branches locales mergées : `git branch --merged main | grep -v main | xargs git branch -d`.
5. Mettre à jour les dépendances non-breaking : `pnpm update` puis `pnpm test`. Breaking changes → ticket dédié.

---

## 🆘 Ad-hoc — Quand quelque chose casse

### Prod cassée
→ `runbook-rollback.md` immédiatement. Pas de debug en prod sous pression.

### Feature bloquée pendant > 2h
→ `/status` pour clarifier où ça bloque. Si toujours bloqué après 1h de plus → pause, marche de 20 min, puis `/kickoff` avec le même sujet pour réinitialiser le contexte.

### Doute sur une décision d'archi
→ `/plan <question>`. Claude propose 2-3 options avec trade-offs en français non-technique. Décider, puis `DECISION` dans LOGBOOK.md.

---

## Règles d'or

1. **Une routine = une skill + un geste.** Si tu dois lire un doc de 3 pages pour la faire, elle est cassée.
2. **Pas de routine optionnelle.** Ou elle est dans la liste et elle est faite, ou elle est supprimée.
3. **Le LOGBOOK est le seul endroit de vérité** pour le "qu'est-ce qui s'est passé". Notion = décisions stratégiques, LOGBOOK = décisions tactiques.
4. **Claude Code est l'exécuteur, pas le décideur.** Tu valides à chaque étape. Jamais de `git push` automatique sans lecture du diff.

---

## Signaux qu'une routine ne marche plus

- Tu la skippes 3 jours de suite → elle est trop longue ou mal placée.
- Tu ne lis plus le résultat → elle produit trop d'output, réduis le scope.
- Tu la fais mais rien n'en sort (décisions, actions) → elle est purement cosmétique, supprime-la.

Ajuste ce fichier chaque fois que tu ajustes une routine. Il est vivant.
