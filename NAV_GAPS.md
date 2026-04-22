# Gaps navigation, onglets, settings — Skalr

Date : 2026-04-16

## 1. Sidebar actuelle (5 items)
`Dashboard · Missions · Prospection · Pipeline · Messages`

### 🔴 Ce qui manque absolument
- **Calendrier / Entretiens** — une vue semaine des interviews à venir, slots à proposer, no-show à relancer. Aujourd'hui éclaté entre `mission_process_steps` (par mission) et `calendly-webhook` (externe).
- **Tâches & rappels** — `RemindersSidebar.tsx` existe pour un candidat, mais pas d'inbox de tâches globale ("relancer Paul", "préparer l'entretien de 14h"). Clé pour un recruteur qui ouvre Skalr le matin.
- **Analytics / Rapports cabinet** — vue globale agence : time-to-hire, sources performantes, ROI par consultant. Aujourd'hui uniquement `MissionInsights` (par mission).
- **Agents** — la page `Agents.tsx` existe mais n'est pas dans la sidebar. Soit la lier, soit la supprimer.

### 🟠 Utile
- **Bibliothèque** — templates de séquences, scorecards, briefs, snippets. Aujourd'hui éparpillé (Marketplace dans Settings, snippets dans l'éditeur outreach).
- **Clients** (agency-only) — vue des comptes clients + missions groupées. Utile aux cabinets.
- **Knowledge** — playbooks internes, process cabinet, docs RH. Mobilise le RAG.
- **Favoris / Listes** — pins sur missions / candidats, alternative au Vivier.

### 🟡 Nice-to-have
- **Activity** — feed temps réel de ce qui se passe dans l'org (nouveau candidat, réponse, offre signée).
- **Notifications center** — dropdown existe dans header (`NotificationDropdown`), mais pas de page dédiée archivable.

---

## 2. Onglets mission actuels (8)
`overview · brief · process · sourcing · outreach · pipeline · insights · config`

### 🔴 Manquants
- **Entretiens / Scorecards** — `ScorecardTab` existe mais dans la modale candidat. Pas de vue "tous les entretiens planifiés pour cette mission".
- **Documents** — JD PDF client, contrat cabinet, brief signé, CV reçus. Aucun endroit pour les stocker par mission.
- **Activité / Journal** — timeline des événements de la mission (qui a fait quoi, quand). `ATSTimeline` existe pour un candidat, pas pour la mission.
- **Client / Équipe hiring** — contacts client (hiring manager, HRBP), historique des échanges, notes. Aujourd'hui éparpillé.

### 🟠 À regrouper
Les 8 onglets actuels mélangent workflow (brief → outreach) et méta (config, insights). Garder 4 primaires + menu "Plus" pour secondaires (voir `UX_AUDIT` #3).

---

## 3. Settings actuels (9 onglets conditionnels)
`Général · Mon compte · Équipe · Abonnement · Crédits IA · Connecteurs · Intégrations · Agence · Marketplace`

### 🔴 Manquants critiques
- **Profil personnel** — "Mon compte" contient LinkedIn/Email/WhatsApp/Signatures, pas le profil user (nom, photo, timezone, langue, pronoms, titre). Les autres voient `display_name` brut.
- **Notifications** — aucun panneau pour choisir : email digest on/off, Slack webhook, quoi notifier (réponses, entretiens, offres, mentions).
- **Sécurité** — pas de 2FA, pas de gestion des sessions actives, pas d'historique de connexion, pas de révocation de tokens.
- **Confidentialité / RGPD** — `rgpd-purge` et `export-org-data` existent en edge mais pas d'UI. Besoin : export ZIP, purge candidats, anonymisation, politique de rétention configurable par org.
- **Audit logs** — qui a fait quoi dans l'org (exigence entreprise dès 20+ sièges).

### 🟠 Manquants importants
- **API & Webhooks** — clés API pour l'org (intégrations custom), webhooks sortants ("quand candidat → Offer, POST vers …").
- **Champs personnalisés** — ajouter un `seniority_custom` ou `talent_pool` par org ; aujourd'hui tout est en dur dans le schema.
- **Taxonomies** — stages kanban custom par org (`Sourcing → Contacté → En process → Offer → Hire` n'est pas le même flow dans toutes les boîtes), libellés statuts, tags candidats.
- **Templates org** — scorecards types, briefs standards, emails, séquences par défaut. Aujourd'hui la Marketplace mélange templates payants et seeds.
- **Domaines d'envoi** — custom domain pour sender email (`recruiter@client-xyz.com`), SPF/DKIM guide. Aujourd'hui forcé sur le domaine Skalr.
- **Données** — historique imports CSV, re-run ingestion, purge cache RAG, rebuild embeddings.

### 🟡 À structurer
- **Branding** — `OrgLogoEditor` existe dans "Général". À sortir en onglet "Branding" avec : logo, favicon, couleurs email, header newsletter, footer légal.
- **Automatisations** — règles "si candidat à X stage depuis Y jours, alors Z" ; aujourd'hui tout se fait manuellement ou via n8n externe.
- **Onboarding & aide** — bouton "relancer le tour", changelog, roadmap publique, lien support.

---

## 4. Synthèse chiffrée

| Zone | Existe | Manque critique | Manque utile |
|---|---|---|---|
| Sidebar | 5 | 3 (Calendrier, Tâches, Analytics) | 4 (Clients, Bibliothèque, Knowledge, Activity) |
| Onglets mission | 8 | 3 (Entretiens, Docs, Activité) | 1 (Client/Hiring team) |
| Settings | 9 | 5 (Profil perso, Notifs, Sécurité, RGPD, Audit) | 6 (API/Webhooks, Champs custom, Taxonomies, Templates org, Domaines, Données) |

**Total : 22 espaces/onglets manquants.** Les **11 critiques** conditionnent le passage en B2B sérieux (compliance + recruteur pro quotidien).

---

## 5. Plan d'intégration proposé

### Sprint 1 — Core daily flow (1 semaine)
1. **Calendrier** dans la sidebar (vue semaine, slots, no-shows)
2. **Tâches** dans la sidebar (inbox rappels + assignables à un teammate)
3. **Profil personnel** dans Settings (+ timezone/langue)

### Sprint 2 — Mission 360 (1 semaine)
4. Onglet **Entretiens** dans MissionWorkspace (scorecards + agenda)
5. Onglet **Documents** dans MissionWorkspace (upload + RAG auto)
6. Onglet **Activité** dans MissionWorkspace (feed événements)

### Sprint 3 — Compliance & trust (2 semaines)
7. Settings **Sécurité** (2FA, sessions, révocation)
8. Settings **Confidentialité** (UI pour `rgpd-purge` + `export-org-data`)
9. Settings **Notifications** (channels + digest)
10. Settings **Audit logs** (qui a fait quoi)

### Sprint 4 — Personnalisation org (2 semaines)
11. Settings **Champs personnalisés** + **Taxonomies** (stages, tags)
12. Settings **Templates org** (scorecards, briefs, séquences, emails)
13. Settings **API & Webhooks**
14. Settings **Domaines d'envoi** (custom + DKIM/SPF guide)

### Sprint 5 — Collaboration & intelligence (1-2 semaines)
15. Sidebar **Analytics cabinet** (agency-only)
16. Sidebar **Bibliothèque** (unifie Marketplace + templates + snippets)
17. Sidebar **Knowledge** (docs org RAG-indexés)
18. Nettoyer `Agents.tsx` (lier ou supprimer)

---

## 6. Ce qui est déjà bien pensé (à ne pas toucher)

- **Deep links Settings** via `?tab=…` — excellent pour les CTA intégrés.
- **`AICreditsSettings`** séparé de `BillingSettings` — bonne UX.
- **Marketplace + Agency** en onglets conditionnels — permissions bien faites.
- **Sidebar collapsible** avec credits display + theme toggle en bas — compact.
- **Mission tabs** avec `AnimatePresence` + lock state via `useMissionReadiness` — belle idée à peaufiner.
