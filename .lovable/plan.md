

## Recherche ATS — Features tendances qu'on pourrait ajouter

### Ce qu'on a déjà
- Kanban / Table / Timeline views
- Drag & drop entre stages
- Scoring AI multi-couche (hard filters + LLM)
- Scorecard structurée par étape d'entretien
- Live coaching Deepgram + CR auto
- Rappels / Notes / Tags
- Dashboard KPIs + funnel
- Séquences outreach automatisées
- Inbox messages LinkedIn
- Intégration Notion + Airtable + Aircall

### Features repérées chez les leaders (Ashby, Greenhouse, Lever, Teamtailor, Workable, Gem)

Voici les features les plus pertinentes qu'on n'a **pas encore** et qui apporteraient une vraie valeur :

---

#### 1. **Candidate Fraud Detection / AI Anomaly Alerts** (Ashby)
Détection automatique d'incohérences dans les profils : dates qui se chevauchent, diplômes douteux, expériences gonflées. Un badge d'alerte sur la card candidat.

#### 2. **AI Feedback Summary / Debrief automatique** (Ashby, Greenhouse)
Après que plusieurs évaluateurs ont rempli une scorecard, l'IA synthétise les avis, identifie les consensus et divergences, et génère une recommandation consolidée. Utile quand plusieurs personnes interviennent dans le process.

#### 3. **Candidate Experience Portal** (Teamtailor, Greenhouse)
Un portail candidat (page publique) où le candidat peut suivre l'avancement de sa candidature en temps réel, voir les prochaines étapes, et recevoir des updates automatiques. Améliore drastiquement l'image employeur.

#### 4. **Interview Scheduling / Calendrier intégré** (Ashby, Lever, Greenhouse)
Proposer automatiquement des créneaux d'entretien (lié à Calendly/Google Calendar), avec round-robin entre interviewers, gestion des conflits, et relance auto si pas de réponse.

#### 5. **Pipeline Analytics avancés — Time-in-Stage + Bottleneck Detection** (Ashby, Gem)
Au-delà du dashboard actuel : temps moyen par stage, détection automatique des goulots d'étranglement ("17 candidats bloqués en Technique depuis > 7j"), SLA alerts, et benchmarks par poste.

#### 6. **Duplicate Detection / Merge Candidates** (Greenhouse, Lever)
Détection automatique de candidats en double (même email, même LinkedIn URL, nom similaire) avec interface de merge pour consolider les historiques.

#### 7. **AI Auto-Reply Status Detection** (Ashby)
Classifier automatiquement le statut des réponses reçues : intéressé, pas intéressé, demande d'infos, out-of-office, relance nécessaire. On a déjà `auto-analyze-message` mais pas d'affichage visuel clair dans le Kanban.

#### 8. **Offer Management** (Greenhouse, Lever)
Module de gestion des offres : template d'offre, workflow d'approbation (manager → RH → direction), suivi accepté/refusé/négociation, comparaison package.

#### 9. **DEI Analytics / Diversity Dashboard** (Ashby, Greenhouse)
Tableau de bord diversité : répartition par genre/origine à chaque étape du funnel, détection de biais dans les taux de conversion, objectifs DEI.

#### 10. **Collaborative Evaluation — @mentions + Activity Feed** (Lever, Ashby)
Système de mentions dans les notes (@collègue), feed d'activité en temps réel sur un candidat (qui a fait quoi, quand), et notifications push quand on est mentionné.

---

### Recommandation de priorité

| Priorité | Feature | Impact | Effort |
|---|---|---|---|
| 1 | Pipeline Analytics + Bottleneck Detection | Très haut — actionnable immédiatement | Moyen |
| 2 | AI Feedback Summary / Debrief | Haut — différenciateur fort | Moyen |
| 3 | Duplicate Detection / Merge | Haut — pain point courant | Moyen |
| 4 | Interview Scheduling (Calendly) | Haut — gain de temps quotidien | Élevé |
| 5 | @mentions + Activity Feed | Moyen-haut — collaboration | Moyen |
| 6 | Auto-Reply Status visible dans Kanban | Moyen — on a déjà le backend | Faible |
| 7 | Candidate Portal | Moyen — image employeur | Élevé |
| 8 | Offer Management | Moyen | Élevé |
| 9 | Fraud Detection | Niche mais impressionnant | Moyen |
| 10 | DEI Dashboard | Important à terme | Moyen |

