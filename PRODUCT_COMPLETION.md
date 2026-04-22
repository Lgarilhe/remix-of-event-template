# Ce qu'il manque pour un produit incroyable — Skalr

Date : 2026-04-16
Branche : `claude/app-audit-jHxht`

Les 3 audits précédents (`AUDIT_REPORT`, `FEATURE_AUDIT`, `UX_AUDIT`) ont couvert la sécurité, les incohérences et l'UX. Ce document liste ce qui manque **en tant que produit** pour passer de "complet" à "incroyable".

---

## 🔴 Blocs manquants qui cassent la promesse produit

### 1. Planification d'entretiens native
- **Aujourd'hui** : `mission_process_steps` décrit les étapes mais aucune UI pour **proposer des créneaux** au candidat. Calendly est en "intégration API-key" (Settings/Integrations) — l'utilisateur doit sortir de l'app.
- **Manque** :
  - OAuth Google Calendar / Outlook Calendar (pas juste API-key Calendly).
  - Slot picker intégré dans `CandidateDetailModal` → envoi d'un email avec un lien de réservation sous domaine Skalr.
  - Bloc auto dans le calendrier du recruteur, rappels J-1 et H-1 automatiques.
- **Impact** : un recruteur passe 10-15 % de sa journée sur ça. Sans, l'app reste un "sourcer" et pas un ATS.

### 2. Entretien vidéo + enregistrement
- **Aujourd'hui** : `LiveCoachingPanel` et `generate-scorecard` suggèrent qu'on est sur cette trajectoire, mais rien ne génère de lien visio ni ne capte l'audio.
- **Manque** : Zoom / Google Meet / Teams OAuth, enregistrement opt-in, transcription (déjà `deepgram-temp-key` existe — à brancher au vrai flux), résumé IA + scorecard auto-pré-remplie.
- **Impact** : la scorecard serait **pré-remplie par l'IA** à partir de la transcription ⇒ recruteur passe de 30 min de debrief à 5 min de validation. C'est le "moment wow".

### 3. Gestion d'offres et signature
- **Aujourd'hui** : rien. Le pipeline s'arrête à "Offre" sans générer d'offre.
- **Manque** : templates d'offre par org, variables dynamiques (salaire, date, benefits), e-signature (DocuSign/Yousign OAuth), suivi "vue / signée / refusée", relances auto.
- **Impact** : sans ça, on pousse le client hors de Skalr pour la dernière ligne droite ⇒ pas de données de conversion offer→hire.

### 4. Push vers les ATS clients (Greenhouse, Lever, Workable, Teamtailor, Recruitee)
- **Aujourd'hui** : Notion + Airtable + Aircall en intégrations "DIY". Aucun ATS recruteur pro.
- **Manque** : push candidat + CV + scorecard via API. Au minimum Greenhouse (standard marché) et Teamtailor (France).
- **Impact** : les cabinets de recrutement B2B ne peuvent pas vendre Skalr à leurs clients grands comptes sans ça.

### 5. Sync email deux sens (Gmail / Outlook)
- **Aujourd'hui** : Unipile gère la messagerie LinkedIn + InMail + sequence emails envoyés depuis l'adresse Skalr. Pas de sync avec le mail perso du recruteur.
- **Manque** : Gmail API / Microsoft Graph OAuth ⇒ les réponses qui arrivent sur l'email perso remontent dans `MessagesInbox`. Idem pour les envois manuels hors séquence.
- **Impact** : aujourd'hui, toute discussion hors séquence est invisible de Skalr ⇒ pipeline incomplet, IA sans contexte.

---

## 🟠 Fonctionnalités attendues par un utilisateur pro

### 6. Recherche globale (`Cmd+K`)
- **Aujourd'hui** : `Ctrl+K` ouvre l'agent IA uniquement. Aucune recherche qui saute à une mission/candidat/message par nom.
- **Manque** : palette de commandes (type Linear/Raycast) avec : missions, candidats, messages, actions ("Nouvelle mission", "Aller à Settings/Billing").
- **Impact** : sur un recruteur qui gère 20+ missions, la sidebar ne scale plus.

### 7. Collaboration temps réel + @mentions
- **Aujourd'hui** : `CandidateCommentsTab` existe. Mais pas de présence, pas d'@mention qui notifie, pas d'activity feed unifié.
- **Manque** : presence dots dans la mission (qui regarde quoi), `@user` dans commentaires → notif in-app + email, feed "Qui a fait quoi" par mission.
- **Impact** : produit d'équipe non-collaboratif au-delà de 2 recruteurs.

### 8. Centre de notifications + Slack/Teams
- **Aujourd'hui** : toasts éphémères + `NotificationDropdown` léger.
- **Manque** :
  - Notif persistantes filtrables (réponses, entretiens à venir, offres à relancer, séquences bloquées).
  - Slack/MS Teams webhooks par org : "Nouveau candidat intéressé sur [mission]" → canal dédié.
  - Digest quotidien par email.
- **Impact** : sans notifs persistantes, un recruteur qui rate une réponse la perd.

### 9. Templates + bibliothèque communautaire
- **Aujourd'hui** : `sequence-templates-crud` + Marketplace existent, mais contenu probablement pauvre.
- **Manque** :
  - Templates seedés par rôle (dev, sales, produit, ops…) x canal (email, InMail, classic).
  - Brief templates par métier.
  - Scorecards types (technical screen, culture fit, final).
  - Import depuis la communauté (upvote, fork).
- **Impact** : time-to-first-value > 30 min aujourd'hui. Avec des templates seedés : < 5 min.

### 10. Help center + onboarding guidé
- **Aujourd'hui** : `OnboardingWizard` (10 scènes statiques). Pas de docs en-app, pas de tooltip "? sur feature", pas de vidéos.
- **Manque** :
  - Help button persistant (type Intercom) : search docs + contact.
  - Product tour interactif sur la 1ʳᵉ mission ("Cliquez ici pour générer les filtres IA…").
  - Vidéo 90 s par feature clé.
  - Changelog in-app.
- **Impact** : churn au J7 élevé si l'utilisateur ne trouve pas les features IA.

---

## 🟡 Maturité entreprise

### 11. SSO + SCIM + audit logs
- **Aujourd'hui** : auth par email/mot de passe via `@lovable.dev/cloud-auth-js`.
- **Manque** : SAML/SSO (Okta, Google Workspace, Azure AD), provisioning SCIM, logs d'audit (qui a vu/modifié quoi).
- **Impact** : bloque les deals > 50 sièges.

### 12. Rôles et permissions granulaires
- **Aujourd'hui** : `organization_members.role` = admin/owner/collaborator (grossier).
- **Manque** : rôles custom, permissions par mission ("read-only", "can invite", "can send outreach"), deal rooms en lecture seule pour les clients finaux (le `ClientPortal` existe, à étendre).
- **Impact** : cabinets avec freelances ont besoin de restrictions fines.

### 13. Data residency + RGPD self-service
- **Aujourd'hui** : `rgpd-purge` edge function existe, `export-org-data` aussi. Mais pas d'UI exposée.
- **Manque** : page Settings "Confidentialité" avec export ZIP, purge candidats, anonymisation, politique de rétention configurable par org. Hébergement UE documenté.
- **Impact** : refus de signer des DPA sans ces garanties.

### 14. Facturation transparente + usage en temps réel
- **Aujourd'hui** : `BillingSettings` + `AICreditsSettings` existent, mais l'usage de crédits IA est opaque.
- **Manque** :
  - Graphe d'usage IA par jour / par feature / par membre.
  - Alertes quand on atteint 80 % du quota.
  - Plafonds configurables par membre (évite qu'un junior brûle 1000 crédits en 1 h).
- **Impact** : surprise en fin de mois = churn.

---

## 🟢 Ce qui ferait passer d'incroyable à légendaire (différenciation)

### 15. Agent IA proactif (pas juste réactif)
- **Aujourd'hui** : `AgentDrawer` répond quand on lui parle. `MissionCopilot` suggère des actions en bas de l'écran — c'est un bon début.
- **Manque** :
  - **Matinée** : "Bonjour, 3 candidats ont répondu cette nuit, 2 entretiens à préparer aujourd'hui, la mission [X] stagne depuis 5 jours, voici pourquoi."
  - **Sourcing auto de nuit** : à mission créée, tourne toutes les nuits à la recherche de nouveaux profils correspondants, pré-score, propose le lendemain.
  - **Relances intelligentes** : détecte un prospect "tiède" qui a ouvert 3 fois sans répondre ⇒ suggère un nouveau message adapté.
- **Impact** : c'est la différence entre "un outil qui travaille quand j'y pense" et "un collègue qui me livre du boulot fini".

### 16. Transcription + coaching d'entretien temps réel
- **Aujourd'hui** : `live-coach` et `LiveCoachingPanel` existent, à brancher.
- **Manque** : transcription live pendant l'entretien, notes auto, suggestions de questions en live (basé sur la scorecard et le brief), détection de red flags.
- **Impact** : premier produit français à faire ça. Vrai wow-moment de démo.

### 17. Market intelligence par mission
- **Manque** :
  - Taux de réponse moyen observé dans Skalr pour ce rôle + zone + seniority.
  - Salaire médian observé, évolution 12 mois.
  - Concurrents qui recrutent le même profil.
  - "Probabilité de closer sous 30 j" avec les données du brief.
- **Impact** : justifie un prix premium, fait de Skalr un conseil marché.

### 18. Experience candidat premium
- **Aujourd'hui** : `CandidatePortal` existe, probablement minimal.
- **Manque** :
  - Page de mission personnalisée (photo team, vidéo hiring manager, salaire, stack).
  - Timeline du process "vous êtes à l'étape 2/4".
  - Auto-booking d'entretien.
  - Demande de feedback post-process (même si refusé).
- **Impact** : 40 % des candidats qualifiés sont perdus à cause d'un mauvais experience candidat. Avantage retention + NPS candidat + données.

### 19. Workflow builder visuel
- **Aujourd'hui** : `n8n-create-workflow` suggère une intégration externe. `SequenceBuilder` est propre mais limité aux séquences outreach.
- **Manque** : "Quand [candidat passe en Offer], alors [notifier Slack channel X + créer tâche Calendar + push Greenhouse]". Un builder Zapier-like limité aux events Skalr.
- **Impact** : chaque org a ses petites particularités, on ne peut pas tout coder.

### 20. Analytics cabinet / reporting client
- **Aujourd'hui** : `MissionInsights` par mission + `ATSPipelineAnalytics`. Pas de vue globale cabinet.
- **Manque** :
  - Dashboard agency : time-to-hire moyen par consultant, conversion funnel, sources les + performantes.
  - Rapport client PDF auto-généré : "Pour la mission X, 127 profils sourcés, 15 contactés, 4 en process, 1 embauché. Salaire final : 68 k€. Délai : 23 j."
  - Benchmark interne entre consultants (fair-play).
- **Impact** : les directeurs de cabinet paient pour les insights, pas pour le sourcing.

---

## Roadmap proposée (6 mois, 4 releases)

### Release 1 — "Finir le workflow" (6 semaines)
1. Gmail/Outlook OAuth deux sens (#5)
2. Google/Outlook Calendar OAuth + slot picker natif (#1)
3. Cmd+K palette de commandes (#6)
4. Centre de notifications + digest email (#8)
5. Help center in-app + product tour (#10)

### Release 2 — "Le moment wow IA" (8 semaines)
6. Visio OAuth + transcription + scorecard pré-remplie (#2, #16)
7. Agent IA proactif (briefing du matin, relances) (#15)
8. Templates seedés par métier + marketplace curée (#9)
9. Export PDF client auto (#20)

### Release 3 — "Couverture B2B" (8 semaines)
10. Push ATS (Greenhouse + Teamtailor en priorité) (#4)
11. Gestion d'offres + e-signature (#3)
12. Slack / MS Teams webhooks (#8)
13. Workflow builder basique (#19)

### Release 4 — "Enterprise ready" (6 semaines)
14. SSO + SCIM + audit logs (#11)
15. Rôles/permissions granulaires + deal rooms (#12)
16. Page RGPD self-service + alertes crédits (#13, #14)
17. Market intelligence par mission (#17)
18. Experience candidat premium (#18)

---

## Ce qui est déjà en avance sur le marché

- **Brief → filtres IA → scoring → message** : chaîne complète en un seul produit, peu de concurrents font ça.
- **Unipile + Apollo + PDL** : triple source de sourcing, permet de dé-risquer le "no-LinkedIn".
- **Scorecard + live coaching** : embryon prêt à brancher.
- **Edge functions Deno bien structurées** avec `_shared/` pour auth/credentials/AI.
- **Multi-tenant propre** (quand `requireAuth` est appliqué — voir `AUDIT_REPORT` A1).
- **Design system shadcn + animations framer-motion** : qualité perçue déjà au niveau Linear/Ashby.

Le squelette est solide. Les 5 blocs critiques (calendrier, visio, offre, ATS push, email sync) transforment Skalr d'un "super sourcer IA" en "ATS IA complet".
