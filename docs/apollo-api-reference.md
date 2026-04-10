# Apollo.io API Reference — Konekt Integration

## Endpoints utilises

### 1. People API Search (POST /mixed_people/search)
- **Usage** : Sourcing de candidats dans la base Apollo
- **Ne consomme PAS de credits** (pas d'emails/telephones retournes)
- **Limite** : 50,000 records max (100/page, 500 pages)
- **Parametres cles** :
  - `person_titles` : array de titres (ex: ["DevOps Engineer", "SRE"])
  - `person_locations` : array de lieux (ex: ["France", "Paris"])
  - `person_seniorities` : ["senior", "manager", "director", "vp", "c_suite"]
  - `organization_locations` : filtre par siege de l'entreprise
  - `organization_num_employees_ranges` : ["1,10", "11,50", "51,200", "201,500"]
  - `q_keywords` : recherche texte libre (noms, titres, entreprises)
  - `q_organization_keyword_tags` : ["SaaS", "fintech", "cloud"]
  - `q_organization_domains_list` : ["apollo.io", "google.com"]
  - `currently_using_any_of_technology_uids` : ["salesforce", "kubernetes"]
  - `organization_num_jobs_range` : {min, max}
  - `organization_job_posted_at_range` : {min: "2025-07-25", max: "2025-09-25"}
  - `revenue_range` : {min, max} (pas de symboles monetaires)
  - `include_similar_titles` : true par defaut, false pour strict match
  - `page`, `per_page` (max 100)
- **Note** : Ne retourne PAS d'emails ni de telephones. Utiliser People Enrichment pour ca.

### 2. People Enrichment (POST /people/match)
- **Usage** : Enrichir un profil candidat
- **CONSOMME DES CREDITS** — demander confirmation utilisateur
- **Parametres** :
  - `first_name`, `last_name` (ou `name`)
  - `email` ou `hashed_email` (MD5/SHA-256)
  - `organization_name`, `domain`
  - `linkedin_url`
  - `id` : Apollo person ID
  - `reveal_personal_emails` : false par defaut
- **Plus on fournit d'infos, plus Apollo trouve un match**

### 3. Bulk People Enrichment (POST /people/bulk_match)
- **Usage** : Enrichir jusqu'a 10 personnes en un appel
- **CONSOMME DES CREDITS**
- **Parametres** :
  - `details` : array d'objets (max 10), chacun avec first_name, last_name, email, domain, linkedin_url, organization_name
  - `reveal_personal_emails` : false par defaut

### 4. Organization Search (POST /mixed_companies/search)
- **Usage** : Trouver des entreprises dans la base Apollo
- **CONSOMME DES CREDITS**
- **Limite** : 50,000 records max
- **Parametres cles** :
  - `q_organization_name` : nom de l'entreprise
  - `q_organization_keyword_tags` : ["SaaS", "fintech"]
  - `organization_locations` / `organization_not_locations`
  - `organization_num_employees_ranges` : ["1,10", "51,200"]
  - `currently_using_any_of_technology_uids`
  - `latest_funding_amount_range` : {min, max}
  - `latest_funding_date_range` : {min: "2025-07-25", max: "2025-09-25"}
  - `total_funding_range` : {min, max}
  - `revenue_range` : {min, max}
  - `organization_num_jobs_range` : {min, max}
  - `q_organization_job_titles` : postes activement recrutes
  - `organization_job_locations` : lieux des postes ouverts

### 5. Organization Enrichment (POST /organizations/enrich)
- **CONSOMME DES CREDITS**
- Enrichit donnees d'une entreprise (industrie, revenue, effectif, funding)

### 6. Bulk Organization Enrichment (POST /organizations/bulk_enrich)
- **CONSOMME DES CREDITS**
- **Parametre** : `domains` : array de domaines (max 10)

### 7. Organization Job Postings (GET)
- **Usage** : Recuperer les offres d'emploi actives d'une entreprise
- **CONSOMME DES CREDITS**
- **Parametres** : `id` (Apollo org ID), `page`, `per_page` (max 10000)

### 8. Contacts Search (POST /contacts/search)
- **Usage** : Chercher dans les contacts DEJA ajoutes a ton compte Apollo
- **Different de People Search** (qui cherche dans toute la base Apollo)
- **Parametres** :
  - `q_keywords` : noms, titres, entreprises, emails
  - `sort_by_field` : contact_last_activity_date, contact_email_last_opened_at, contact_created_at, contact_updated_at
  - `sort_ascending` : true/false
  - `page`, `per_page`
- **Limite** : 50,000 records

### 9. Create Contact (POST /contacts)
- **Pas de deduplication par defaut** — mettre `run_dedupe: true` pour eviter les doublons
- **Parametres** : first_name, last_name, email, title, organization_name, label_names, phones, present_raw_address, website_url, account_id

### 10. Update Contact (PUT /contacts/:id)
- **Parametres** : meme que Create + `id` (obligatoire)
- `label_names` ecrase les listes existantes (pas d'ajout incremental)

### 11. Create Account (POST /accounts)
- Cree une entreprise dans ton compte Apollo
- **Pas de deduplication** — peut creer des doublons
- **Parametres** : name, domain, phone, raw_address

### 12. Update Account (PUT /accounts/:id)
- Met a jour une entreprise existante

### 13. Sequences (Emailer Campaigns)

#### Search Sequences (POST /emailer_campaigns/search)
- `q_name` : recherche par nom de sequence

#### Add Contacts to Sequence (POST /emailer_campaigns/:id/add_contact_ids)
- **ENVOIE DES VRAIS EMAILS — IRREVERSIBLE**
- **Workflow obligatoire** :
  1. Search Sequences pour trouver l'ID
  2. Get Email Accounts pour trouver le sender ID
  3. Confirmation utilisateur avec resume (sender, sequence, nb contacts, statut)
  4. Seulement apres confirmation, appeler l'endpoint
- **Parametres requis** : emailer_campaign_id, id, send_email_from_email_account_id
- **Options** :
  - `contact_ids` ou `label_names`
  - `status` : "active" ou "paused"
  - `auto_unpause_at` : ISO 8601 datetime (avec status=paused)
  - `sequence_active_in_other_campaigns` : true pour ajouter meme si dans d'autres sequences
  - `sequence_no_email` : true pour ajouter sans email
  - `sequence_unverified_email` : true pour emails non verifies
  - `run_dedupe` : eviter doublons

#### Remove/Stop Contacts from Sequence
- **Parametres requis** : contact_ids, emailer_campaign_ids, mode ("remove" ou "stop")
- `stop_reason` : raison de l'arret

### 14. User Profile (GET /users/me)
- Recupere le profil utilisateur (nom, email, titre, credits)
- `include_credit_usage: true` pour voir les credits restants

### 15. Analytics Sync Report
- Query des donnees analytics avec filtrage, grouping et agregation

## Regles importantes pour l'integration

1. **People Search ne consomme PAS de credits** — c'est le seul endpoint gratuit pour le sourcing
2. **Tous les enrichments consomment des credits** — toujours demander confirmation
3. **Pas de deduplication par defaut** sur Create Contact/Account — utiliser `run_dedupe: true`
4. **label_names en update ECRASE** les listes existantes
5. **Sequences envoient de vrais emails** — workflow de confirmation obligatoire
6. **Technologies** : utiliser des underscores (salesforce, google_analytics, wordpress_org)
7. **Montants financiers** : pas de symboles, virgules ou decimales
8. **Pagination** : max 100 resultats/page, max 500 pages
