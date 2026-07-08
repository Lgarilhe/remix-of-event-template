# Audit d'intégration Coresignal — « Base Konekt » v2

> Audit réalisé le 2026-07-08 à partir de la documentation officielle complète (docs.coresignal.com,
> ~215 pages dépouillées) et de **tests réels sur l'API** (compte trial Konekt, cf. annexe).
> Objectif : réintroduire une recherche « Base Konekt » (browsing base de données) en remplacement
> du couple Apollo/PDL retiré le 2026-04-27, avec identité visible dès le browsing.
>
> ⚠️ Branding : « Coresignal » ne doit JAMAIS apparaître côté UI (règle CLAUDE.md) → « Base Konekt ».

---

## 1. Pourquoi Coresignal (rappel décision)

| Critère | Apollo (testé) | PDL | Coresignal (testé) |
|---|---|---|---|
| Identité en recherche | ❌ nom masqué (`Bl***d`), pas d'URL LinkedIn | ✅ | ✅ nom complet + URL LinkedIn **dès le preview** |
| Coût browsing | Gratuit mais inutilisable (masqué) | ~$0,28/profil affiché | ~2 crédits/page de 20 previews |
| Coût fiche complète | 1 crédit (bulk_match) | inclus | 2 crédits (~$0,10-0,40 selon plan) |
| Fiche scorable par `score-profile-job` | ❌ (pas de summary/skills) | ✅ | ✅ (summary, descriptions d'expériences, skills inférés) |
| Fraîcheur constatée | refresh ~mensuel | ~mensuel | **profil testé mis à jour il y a 5 jours** |
| ToS SaaS multi-tenant | ❌ sans contrat OEM | ✅ (data provider) | ✅ conçu pour être intégré à des produits ; conditions multi-tenant à confirmer contractuellement |
| Signaux (job change, promo, posts) | ❌ | ❌ | ✅ (webhooks, `experience_recently_*`, posts) |

Couverture France validée par test réel : 1 338 « Talent Acquisition Manager » (phrase exacte),
13 857 profils skill React à Paris, profils FR à jour avec headlines FR.

---

## 2. Conventions techniques (transverses à toutes les APIs)

- **Base URLs** : `https://api.coresignal.com/cdapi/v2/...` (données) ; `https://api.coresignal.com/rtapi/v2/...` (real-time).
- **Auth** : header `apikey: {clé}` (string 32 chars, gérée sur dashboard.coresignal.com ; plusieurs clés possibles par compte).
- **Verbes stricts** : Search = POST uniquement, Collect = GET uniquement (mauvais verbe → 500).
- **Header `x-credits-remaining`** sur chaque réponse = solde restant (à logger côté edge function).
- **Codes** : 200 (débité), 400/422 (payload), 401 (clé), **402 (crédits épuisés)**, 404 (ID inexistant), 429 (rate limit), 5xx. Seuls les 200 débitent.
- **Rate limits (par COMPTE, pas par user)** : search 18 req/s, collect 54 req/s, bulk 27 req/s,
  Agentic fast 1 req/s, real-time 50 URLs/min.
  → ⚠️ risque de contention multi-tenant : prévoir un rate-limiter côté edge function
  (pattern `check_rate_limit` déjà utilisé dans `apollo-search`).
- **Crédits** : 2 types (Search / Collect). Multi-source = **2 crédits par requête** (search ET collect) ;
  Base/Clean/Jobs/Posts = 1. On n'achète que les Collect ; les Search sont offerts en ≥2×.
- **Recherche ES DSL** : max 15 000 caractères et 1 024 clauses booléennes par requête
  (⚠️ pertinent pour nos filtres générés par IA — prévoir une garde).

---

## 3. API cœur : Multi-source Employee (le moteur « Base Konekt »)

### 3.1 Endpoints

| Méthode | Path | Fonction | Coût |
|---|---|---|---|
| POST | `/cdapi/v2/employee_multi_source/search/es_dsl` | Recherche → **IDs uniquement** (1000/page) | 2 cr search |
| POST | `/cdapi/v2/employee_multi_source/search/es_dsl/preview` | **20 profils partiels** identité incluse | 2 cr search/page |
| GET | `/cdapi/v2/employee_multi_source/collect/{id}` | Fiche complète (300+ champs) | 2 cr collect |
| GET | `/cdapi/v2/employee_multi_source/collect/{shorthand}` | Fiche par slug/URL LinkedIn | 2 cr collect |
| POST | `/cdapi/v2/data_requests/employee_multi_source/ids` ou `/es_dsl` | Bulk collect (max 10 000) | crédits au POST |
| POST | `/v2/subscriptions/employee_multi_source/{ids\|es_dsl}` | Webhooks changements de profil | gratuit (plan Premium requis) |
| POST | `/v2/subscriptions/experience_changes/employee_multi_source/{ids\|es_dsl}` | Webhooks **changements de poste** | idem |

⚠️ Multi-source = **ES DSL uniquement** (pas d'endpoint « filtres simples »). Notre mapping
`LinkedInFiltersState → ES DSL` est donc obligatoire (cf. §8.2).

### 3.2 Preview — les champs exacts (testé)

`id`, `full_name`, `professional_network_url` (= URL LinkedIn), `headline`, `location_full`,
`location_country`, `connections_count`, `followers_count`, `company_name`,
`company_professional_network_url`, `company_website`, `company_industry`,
`active_experience_title`, `active_experience_department`, `active_experience_management_level`,
`company_hq_full_address`, `company_hq_country`, `_score`.

→ Suffisant pour une card candidat complète dans `SearchResultsPanel`, identité visible.
Limite : **5 pages × 20 = 100 résultats max** en preview ; au-delà → search (IDs) + collect.
Pas d'email/téléphone dans le preview.

### 3.3 Fiche complète (collect) — champs clés pour Konekt

- **Identité** : `full_name`, `headline`, `summary` (peut contenir du HTML), `picture_url`,
  `linkedin_url` + `linkedin_shorthand_names` + `historical_ids` (gestion changements d'URL),
  `location_*` (city/country/iso/regions), `languages[]`, `is_deleted` (à filtrer : `is_deleted:0`).
- **Expériences** : `experience[]` avec `position_title`, `department`, `management_level`,
  `description`, `date_from_year/month` (utiliser ceux-là, pas les dates texte), `duration_months`
  + firmographics employeur embarquées (taille, industrie, funding, revenue, `company_is_b2b`).
  Racine : `active_experience_*`, `is_working`, `total_experience_duration_months` (+ breakdowns).
- **Éducation** : `education[]` (degree, institution, années, activities) + `education_degrees[]`.
- **Skills** : `inferred_skills[]` (inférés par modèle — pas de skills déclarés bruts) + `historical_skills[]`.
- **📧 Email pro** : `primary_professional_email` + statut (`verified`/`matched_email`/`matched_pattern`/
  `guessed_common_pattern`) + `professional_emails_collection[]`. **Aucun téléphone, aucun email perso**
  (positionnement RGPD) → la cascade BetterContact reste le canal coordonnées.
- **💰 Salaire projeté** : `projected_base/total_salary_p25/median/p75` + devise/période.
  ⚠️ Couverture FR faible constatée (null sur le profil testé) → ne rien construire dessus,
  juste logger le taux de remplissage.
- **Signaux (différenciateur)** : `experience_recently_started[]/closed[]` (+ `identification_date`),
  `experience_change_last_identified_at` (requêtable en ES !), `profile_*_field_changes_summary[]`.
- **Scoring bonus (nouveaux champs juillet 2026)** : `tenure_stats` (avg/median/current/longest tenure),
  `internal_promotion_rate` (promotion_count, avg_months_per_promotion, recently_promoted),
  `months_in_management`, `institution_ranking_score` (ranking QS — carburant Pedigree),
  `influence_score` (0-100), `post_frequency_yearly`, `posting_recency`, `engagement_per_post`.
- **Qualité** : `profile_score` (0-1, triable — proxy de complétude/activité du profil).

### 3.4 Pagination search

Réponse = tableau d'IDs (1000/page, réductible `?items_per_page=`). Headers `x-total-results`,
`x-total-pages`, `x-next-page-after`. Page suivante : même POST + `?after={x-next-page-after}`.
⚠️ Le **format de `x-next-page-after` varie selon le tri** (date+id / id seul / score+date+id)
→ parser les 3 variantes.

---

## 4. Recherche en langage naturel : Agentic Search API

| | `POST /v2/agentic_search/fast` | `POST /v2/agentic_search/reasoning` |
|---|---|---|
| Accès | ouvert (trial inclus) | sur demande |
| Rate limit | 1 req/s **par compte** | 10 req/heure |
| Coût | 2 cr (query mode ou ≤20 résultats) → 10 cr à 100 | 10 → 18 cr |
| Params | `prompt`, `return_data` (déf. false), `limit` (1-100), `entity` | + `session_id`, `allow_clarification` |

- **Mode recommandé pour Konekt : `return_data:false`** (2 crédits) → renvoie la requête ES DSL
  générée, qu'on affiche en **filtres éditables** (philosophie SearchFiltersPanel) puis qu'on exécute
  nous-mêmes sur le search multi-source. Expansion sémantique des titres incluse.
- `/reasoning` : inutilisable en temps réel multi-tenant (10 req/h) — réserver à des usages batch internes.
- Le rate limit global 1 req/s du `/fast` impose une file d'attente côté edge function.

---

## 5. Webhooks — le « vivier vivant »

- **Souscription** par liste d'IDs ou requête ES DSL, callback URL, validité **91 jours**
  (renouvelable via `POST /v2/subscriptions/{id}/renew`, max 1 an → cron de renouvellement obligatoire).
- **Employee webhooks** : payload `{member_id, status, changed_fields[]}` — filtrable par
  `tracked_fields` (~100 champs dont `experience`, `primary_professional_email`). Fréquence hebdo (multi-source).
- **Experience webhooks** (prise de poste / promotion / départ) : payload minimal `{member_id, status}`
  → re-collecter le profil pour le détail.
- Simulation : `POST /v2/subscriptions/simulate` pour tester notre récepteur.
- ⚠️ **Réservé aux plans hauts (Premium, via account manager)** — pas testable sur le trial.
- ⚠️ **Pas de signature HMAC documentée** → URL de callback non devinable + validation applicative
  (member_id connus) obligatoires.
- Usage Konekt : abonner les profils du vivier + les shortlistés → alerte « a changé de poste »
  (vrai Likely-to-Switch), relance nurturing au bon moment, suivi des placements en période d'essai.

---

## 6. Real-time Employee API (rafraîchir un profil à la demande)

- `POST /rtapi/v2/employee/scrape` avec `{"url": "<profil>", "max_age": <heures>}` —
  cache si assez frais, sinon scrape live **< 30 s**. 50 URLs/min.
- Codes spécifiques : 408 timeout (non débité, retry), 453 blacklisté, 454 supprimé/privé (non débité).
- ⚠️ **Pool de crédits séparé** (négocié à part) et **schéma Base Employee** (pas multi-source).
- Usage Konekt potentiel : vérifier un profil avant envoi de shortlist client. À traiter en phase 3,
  flux distinct. Note : Unipile `get_profile` couvre déjà ce besoin via le compte LinkedIn de l'user —
  le real-time n'a d'intérêt que sans compte LinkedIn connecté.

---

## 7. APIs secondaires utiles

### 7.1 Multi-source Company API (2 cr/req)
- `GET /v2/company_multi_source/enrich?website={URL}` (par domaine uniquement — pas par nom),
  collect par ID/slug LinkedIn, search ES DSL, preview (2 cr, pas gratuit).
- Champs différenciants : `employees_count_change` (MoM/QoQ/YoY + %), `employee_attrition_rate`,
  `key_executive_arrivals/departures[]`, `active_job_postings_count(_change)`,
  `last_funding_round` (struct depuis avril 2026), reviews employeur détaillées
  (`work_life_balance`, `compensation_benefits`… + tendances), `base_salary[]/total_salary[]`
  **par titre dans l'entreprise** (p25/median/p75), `top_previous_companies`/`top_next_companies`
  (flux de talents entre boîtes).
- Usage Konekt : upgrade d'`enrich-company` (aujourd'hui Apollo+Firecrawl+Perplexity),
  talent mapping par entreprise, signaux « boîte qui gèle/licencie » = candidats ouverts,
  `generate-client-competitors` enrichi.

### 7.2 Jobs API (1 cr/req)
- **Multi-source Jobs** (LinkedIn+Indeed+Glassdoor) : salaire **structuré et filtrable**
  (`salary[].min/max/currency/type`), `accepts_remote`, `recruiter` (nom + URL profil !),
  `status` actif/expiré. Requête type « offres actives pour tel titre dans telle ville avec
  salaire » : ✅ faisable en ES DSL.
- **Base Jobs** : filtres simples (title, location, company, `application_active`…), offres
  re-visitées < 24 h, mais salaire = chaîne d'affichage non filtrable.
- Usage Konekt : benchmark salaire réel par titre/ville pour le brief (mieux que le salaire projeté),
  carte de la concurrence de la mission (qui recrute le même profil), sourcing inversé.

### 7.3 Employee Posts API (1 cr/req)
- Search par `author_profile_url`/`article_body`/dates → collect du post complet
  (texte, hashtags, réactions, **commentateurs avec leur profile_url**).
- Usage Konekt : personnalisation d'outreach (`generate-outreach-message` peut citer un post récent),
  signaux d'activité, commentateurs = source de leads.

### 7.4 Historical Headcount API
- 1 cr/req, série mensuelle complète par entreprise. Gated sales, et le duo
  `employees_count_change` + `_by_month` du Company API couvre déjà le besoin → **skip**.

---

## 8. Architecture d'intégration Konekt

### 8.1 Vue d'ensemble

```
[Brief / phrase libre]
   → generate-search-filters (existant)  OU  Agentic Search fast return_data:false (2 cr)
   → filtres éditables (SearchFiltersPanel, existant)
   → edge function coresignal-search
        action: "preview"  → 20 cards identité visible (2 cr/page, max 100)
        action: "search"   → IDs + x-total-results (2 cr/page de 1000)   [estimation volume]
        action: "collect"  → fiche complète → mapping LinkedInProfile (2 cr)
   → score-profile-job (existant, fonctionne tel quel : summary+exp+skills présents)
   → enrich-candidate-contact (existant) : email pro Coresignal en 1er de cascade, BetterContact pour mobile
   → séquences / pipeline (existants, inchangés)
   [Phase 3] coresignal-webhook ← subscriptions vivier/shortlist → nurturing-analyzer
```

### 8.2 Composants à créer / modifier

| Composant | Type | Détail |
|---|---|---|
| `supabase/functions/coresignal-search/index.ts` | **CRÉER** | Calquée sur `unipile-search` (conventions CLAUDE.md : requireAuth, fetchWithTimeout, rate-limit `check_rate_limit`). Actions : `preview`, `search`, `collect`, `agentic_query`. Gestion 402 → message crédits, 429 → retry-after |
| `supabase/functions/_shared/coresignal-mapping.ts` | **CRÉER** | `mapFiltersToEsDsl(LinkedInFiltersState)` (garde 15k chars/1024 clauses, toujours `is_deleted:0`, `match_phrase` pour les titres — le `match` simple tokenise, vérifié en test) + `coresignalToLinkedInProfile()` (parsing défensif : types instables, HTML dans summary, `date_from_year/month`) |
| `_shared/resolve-org-credentials.ts` | **MODIFIER** | + `resolveCoresignalCredentials()` (pattern identique à `resolveApolloCredentials`, colonne `organization_integrations.coresignal_api_key`, fallback env `CORESIGNAL_API_KEY`) |
| Migration SQL | **CRÉER** | `coresignal_api_key` sur `organization_integrations` + table cache `coresignal_profile_cache` (pattern `pdl_profile_cache` : éviter les double-collects, TTL, support RGPD purge) |
| `useLinkedInSearchActions.ts:803` | **MODIFIER** | Point de débranchement documenté — réintroduire la source `database` → `coresignal-search` |
| `MissionSourcing` / `SearchResultsPanel` | **MODIFIER** | Toggle « LinkedIn / Base Konekt » (l'UI `DatabaseFiltersSection`, `filterApiSupport.ts` existent encore) ; bouton « Voir la fiche complète » = collect |
| `ACTION_COSTS` (settle-usage) | **MODIFIER** | Nouveaux coûts crédits Konekt : preview page, collect profil (marge sur ~2 cr Coresignal), en cohérence avec email 1 cr / phone 10 cr existants |
| Feature flag | **MODIFIER** | `featureGates.ts` ou flag org — rollout contrôlé |

### 8.3 UX recommandée (coût maîtrisé)

1. Recherche → **preview automatique page 1** (20 profils, identité complète) = 2 crédits Coresignal.
2. `x-total-results` affiché (« 1 338 profils correspondent ») — l'estimation de volume gratuite.
3. Fiche complète au clic ou **auto-collect des N profils sélectionnés** pour scoring (2 cr/profil).
4. Le bouton « Enrichir » existant récupère l'email pro (déjà dans la fiche) et le mobile (BetterContact).

Coût type d'une mission : 5 pages preview (10 cr) + 40 collects (80 cr) ≈ **90 crédits ≈ 4-18 $**
selon le plan. Trivialement couvert par notre grille de crédits Konekt.

---

## 9. Pricing Coresignal & modèle économique

- **Trial** : 400 cr Search + 200 cr Collect, 7 jours, sans CB, **un seul par domaine email**.
- **Plans self-service** : dès **$49/mois** (~$0,13-0,20/record), ~$800/mois à volume
  ($0,05-0,08/record). Annuel = -20 %, crédits valables 12 mois ; mensuel = pas de report.
  Grille exacte par tier sur le dashboard (pas dans la doc) — à relever avant de dimensionner.
- **Premium** (via account manager) : crédits moins chers + **webhooks** + Historical Headcount.
- Pas d'overage : on « renew » le plan en cours de cycle ou on upgrade.
- **Multi-tenant** : la doc ne décrit ni sous-comptes clients ni conditions de reselling →
  démarrer en **clé unique Konekt** (data provider classique, comme BetterContact) mais **faire
  valider contractuellement l'usage SaaS multi-tenant** avant la GA. Alternative BYO-key par org
  déjà supportée par notre archi (`resolve-org-credentials`).

## 10. RGPD

- Collecte de données **publiques et business uniquement** (revendiqué) : pas de téléphone,
  pas d'email perso, pas d'adresse personnelle. Membre fondateur EWDCI (auto-régulation, pas une
  certification officielle). Base légale art. 6 non explicitée dans la doc, pas de DPA en ligne →
  **demander le DPA + SCC avant contrat**.
- **Pas d'endpoint d'opt-out/suppression** : canal unique privacy@coresignal.com →
  intégrer au workflow `rgpd-erase-contact` existant : purge de notre cache local + email
  automatisé vers leur canal privacy.
- Mettre à jour la liste des sous-traitants sur `/privacy` (exception branding légale autorisée).

## 11. Plan d'implémentation

| Phase | Contenu | Estimation |
|---|---|---|
| **0 — Validation** ✅ | Tests API réels (couverture FR, preview, collect, coûts) | fait (08/07) |
| **1 — MVP browsing** | `coresignal-search` + mapping + migration + toggle UI + crédits Konekt + flag org | **3-5 j** |
| **2 — Recherche augmentée** | Barre langage naturel (Agentic fast, query mode) + auto-collect sélection + cache + bulk collect shortlists + scoring branché | **2-3 j** |
| **3 — Signaux** | Webhooks vivier (nécessite plan Premium), Jobs API benchmark salaire brief, signaux company dans `enrich-company` | **3-4 j** |

## 12. Top gotchas (consolidé — à relire avant d'implémenter)

1. Multi-source = **2 crédits par requête**, preview compris (pas d'autocomplete « gratuit ») ; chaque page re-débite.
2. **Preview plafonné à 100 résultats** (5×20) ; search = IDs only ; un 200 avec 0 résultat débite quand même.
3. `match` ES tokenise (583k faux positifs constatés) → **`match_phrase`** pour les intitulés ; toujours filtrer `is_deleted:0`.
4. `x-next-page-after` : 3 formats selon le tri ; dates d'expérience : utiliser `_year`/`_month`.
5. Parsing défensif : types instables (`company_facebook_url` string|array, counts en string), HTML dans `summary`.
6. Rate limits **par compte** (18 req/s search, 1 req/s Agentic fast) → file d'attente + `check_rate_limit` par user.
7. Webhooks : plan Premium, expiration 91 j (cron renew), pas de HMAC → sécuriser le récepteur.
8. Breaking changes récents (avril-juin 2026) : refonte funding company, exact-match sur `size`, `active_experience` re-trié → coder sur les schémas actuels, surveiller les release notes mensuelles.
9. Skills = **inférés** (pas déclarés) — à refléter dans les instructions de scoring.
10. `salary` projeté : couverture FR faible constatée → logger le fill-rate, ne rien vendre dessus.
11. ToS multi-tenant à confirmer par écrit ; DPA à obtenir.
12. Trial unique par domaine — le compte trial actuel est celui de konekt.fr.

---

## 13. Architecture hybride Coresignal × Unipile (blueprint retenu)

> Validé le 2026-07-08. Principe directeur : **« Coresignal pour lire, Unipile pour agir »**.
> Le risque de ban LinkedIn est proportionnel au volume d'actions non-humaines ; ~80 % de ce
> volume est de la lecture (recherches paginées, visites de profils pour scoring) → déporté
> sur Coresignal. Le budget confiance du compte LinkedIn est réservé à ce que lui seul sait faire.

### 13.1 Répartition des rôles

| Étape | Source | Empreinte LinkedIn |
|---|---|---|
| Recherche, itération filtres, estimation volume | Coresignal preview | zéro |
| Fiche complète pour scoring | Coresignal collect (2 cr) | zéro (avant : 1 visite/candidat scoré) |
| Signaux d'intention (open-to-work, degré, viewed-your-profile, ex-collègues) | Unipile — irremplaçable | faible, ciblé |
| Vérification finale avant contact | Unipile `get_profile` sur ~25 finalistes | ~25 visites/mission |
| Contact LinkedIn (invitations, messages, InMails) | Unipile exclusivement | seul poste assumé |
| Email/mobile en parallèle | Coresignal (email pro) + BetterContact | zéro — chaque email envoyé = un InMail économisé |
| Veille vivier / alertes changement de poste | Coresignal webhooks | zéro |

### 13.2 Routage par licence du compte connecté

- **Classic** : compte fragile (commercial use limit) → Coresignal moteur de recherche PRIMAIRE,
  le compte ne sert qu'aux invitations/messages. Ouvre le segment « recruteurs sans licence
  payante » (le marché de Kalent) avec le canal LinkedIn en plus.
- **Sales Navigator** : Coresignal pour le volume ; Sales Nav réservé aux recherches « signal »
  (changed_jobs, following_your_company, viewed_your_profile) croisées avec le pool Coresignal.
- **Recruiter** : recherche Recruiter conservée en source primaire au choix de l'user, mais le
  `get_profile` de masse du scoring est remplacé par le collect Coresignal (matching par URL) ;
  Recruiter utilisé en couche signal (ex. recherche spotlight open_to_work hebdo par mission,
  intersectée avec le pool) plutôt qu'en pagination profonde.

### 13.3 Mécanique anti-ban (renforcements sur l'existant)

Briques existantes : `useUnipileQuota`, `LinkedInSafetySettings`, proxy dédié, plafond ~100
invitations en attente, vérif crédits InMail fail-closed, pause auto sur `account_disconnected`.
À ajouter :

1. **Budget confiance par compte** : quotas journaliers par type d'action (visites / recherches /
   invitations / messages), calibrés par licence et ancienneté — maintenus bas car la lecture
   part chez Coresignal.
2. **Routage de canal à l'enrollment** : 1er degré → message direct ; email vérifié → email
   d'abord (coût LinkedIn nul) ; sinon invitation avec note ou InMail. Les séquences savent
   déjà auto-skip par canal ; il manque la règle « canal le moins cher en budget LinkedIn d'abord ».
3. **Fusion des sources par `linkedin_url`** (`linkedin_shorthand_names` + `historical_ids`
   côté Coresignal pour les URLs renommées). Règle héritée de l'époque Apollo : le live Unipile
   gagne sur le poste actuel, Coresignal gagne sur la richesse (email, signaux, firmographics),
   ne jamais écraser une donnée par du vide.
4. **Fraîcheur à deux niveaux** : browsing sur cache Coresignal (jours) → vérification live
   Unipile uniquement au moment de contacter.

### 13.4 Résultat attendu & limite connue

Par mission : de plusieurs centaines d'interactions LinkedIn à **~25-40** (vérifs finalistes +
contacts réels). Limite : le matching URL Coresignal↔Unipile ne sera pas parfait à 100 %
(profils très récents ou renommés) → fallback « chercher ce profil via LinkedIn » = une
recherche Unipile ciblée.

---

## Annexe — Tests réels du 2026-07-08 (compte trial Konekt)

| Test | Résultat |
|---|---|
| `search/es_dsl` TAM France (match tokenisé) | 200 — 583 546 résultats (faux positifs, leçon `match_phrase`) |
| `search/es_dsl` TAM France (`match_phrase`) | 200 — **1 338 profils** |
| `search/es_dsl` skills React + Paris | 200 — **13 857 profils** |
| `search/es_dsl/preview` TAM France | 200 — identité complète + URL LinkedIn (champs listés §3.2) |
| `collect/96748890` (TAM @ Edenred, Paris) | 200 — `checked_at` 2026-07-03 (5 jours), 9 exp (6 avec description), 71 skills, 3 formations, 2 langues, photo, profile_score 0.99 ; summary/email/salaire null sur ce profil |
| Consommation totale | ~10 cr search / 400, 1 cr collect / 200 |

Rate limit constaté : 18 req/s (headers `ratelimit-*`). Headers de pagination et `x-credits-remaining` confirmés.
