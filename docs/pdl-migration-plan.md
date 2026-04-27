# Migration Apollo → People Data Labs (PDL)

**Statut** : Réflexion / audit — pas démarré
**Owner** : Laurent
**Dernière maj** : 2026-04-27

---

## 1. Pourquoi ce chantier

Apollo aujourd'hui (Base Konekt) :
- **Le nom du candidat est masqué** dans la recherche "gratuite" (Apollo Locked Profile) → faut consommer un crédit `bulk_match` pour révéler.
- `linkedin_url`, `email`, `employment_history` complets : seulement après `bulk_match` (1 crédit / profil).
- Skills, education, summary, languages, certifications : **vides** dans la réponse Apollo (limites structurelles).
- Résultat UX : l'utilisateur voit une liste anonyme et incomplète, ne peut pas qualifier les candidats, paye à l'aveugle.

PDL :
- 1 crédit Person Search = **1 profil entièrement débloqué** (nom, linkedin_url, work history dates+titres, skills, education, langues, certifs, emails confidence-scored, phones).
- Pas de `reveal` séparé → le profil affiché = le profil exploitable pour le scoring IA et la table Notion.
- Querying flexible : SQL ou Elasticsearch DSL (filtre fin sur séniorité, school, skills…).

---

## 2. Audit codebase (état au 2026-04-27)

### PDL — déjà en place
- **Edge function `pdl-search`** : implémentée, fonctionnelle. Utilise SQL-style API (`SELECT * FROM person WHERE …`).
  - 25+ filtres mappés : job_title, role, levels, location (country/region/locality/metro), skills, education, languages, certifications, intent_signals, etc.
  - Auth JWT, rate-limit 20/min, sanitization SQL (`sanitizePdl()`).
  - **Output format custom `prospects[]`** — utilisé uniquement par la page `/prospection` (`ProspectSearch.tsx:409`), **pas** par le moteur de sourcing principal (`useLinkedInSearchActions`).
- **Secret `PDL_API_KEY`** : configuré dans Supabase.
- Pas de table cache `pdl_profile_cache`.
- Pas de helper `_shared/pdl-client.ts`.

### Apollo — à remplacer
- **5 edge functions Apollo** :
  1. `database-search` — la cible principale du chantier (470+ lignes, mappe LinkedInFiltersState → Apollo + retransforme en LinkedInProfile)
  2. `apollo-search` — appelée par `/prospection` en parallèle de `pdl-search`
  3. `enrich-company` — enrichit data société (industry, headcount, decision makers, job postings)
  4. `enrich-contact` — Apollo People Match API (`reveal_personal_emails=true`, `reveal_phone_number=true`)
  5. `enrich-vivier-contacts` — bulk enrichment Apollo pour Vivier
- **0 feature flag** Apollo dans le code → migration peut être progressive sans guard
- **Pas d'analytics persistées** sur les recherches Apollo (juste `console.log` côté edge)

### Mapping cible LinkedInProfile

Champs LinkedInProfile que **Apollo NE remplit pas** (vide) → que **PDL remplira** :

| Champ LinkedInProfile | Apollo | PDL | Note |
|-----------------------|:------:|:---:|------|
| `education[]` | ❌ | ✅ | school, degree, dates, majors |
| `skills[]` | ❌ | ✅ | string array (sans endorsements) |
| `summary` | ❌ | ✅ | bio LinkedIn brute |
| `languages[]` | ❌ | ✅ | name + proficiency |
| `certifications[]` | ❌ | ✅ | name + organization |
| `work_experience[]` complet | ⚠️ partiel | ✅ | PDL renvoie tout en une requête |
| `emails`, `phone_numbers` | ❌ (séparé) | ✅ | inclus dans Person Search |
| `linkedin_url` | ❌ (séparé) | ✅ | inclus |
| `inferred_years_experience` | ⚠️ calculé | ✅ | natif PDL |
| `intent_signals` | ❌ | ✅ | job_change, recently_funded |

Champs **manquants chez les deux** (gap structurel) :
- Logo société par expérience (`company_logo`)
- Logo école (`school_logo`)
- Description marketing société (`company_description`)
- Description école (`school_description`)
- Network distance LinkedIn

→ Ces champs ne pourront venir QUE de Unipile (LinkedIn Profile API) ou d'une source tierce (Brandfetch / Clearbit / scrape).

---

## 3. Pricing — comparaison

### PDL (octobre 2025)
- **Free** : 100 crédits person/mois (POC seulement)
- **Pro mensuel** : ~$98/mois → 350 crédits person enrichment + 1 000 company → **~$0,28 / crédit**
- **Annuel volume 12k** : $2 688 → **$0,224 / crédit**
- **Annuel volume 30k** : $6 000 → **$0,20 / crédit**
- **Person Search PAYS** : ~$0,04 par profil retourné → mais facturation **inclut les doublons** d'une même requête → cache impératif
- **Bulk Enrichment** : pas de remise volume automatique
- **Rate limit** : 10 req/min par défaut (négociable Enterprise)
- **Refresh data** : mensuel (vs Apollo crowdsourced en continu)

### Apollo
- **Seat-based** : $49–$99/user/mois + crédits enrichment supplémentaires
- **Bulk match** : 1 crédit / profil enrichi
- **Rate limit** : 30 req/min

### Modèle économique côté Konekt à arbitrer
- Aujourd'hui : crédit Apollo refacturé via plan Konekt (forfait crédits inclus + dépassement)
- Demain avec PDL : 1 profil cherché = 1 crédit. **Faut afficher clairement** au user combien chaque recherche coûte avant de la lancer.
- Quotas mensuels par plan Konekt : à recalculer (bench sur 3-4 recherches type pour estimer le coût moyen par recherche utile)

---

## 4. Architecture cible

```
LinkedInFiltersState (frontend)
   │
   ▼
useLinkedInSearchActions
   │   filters.api === 'database'
   ▼
database-search  ←──── REFACTORER pour switcher entre Apollo et PDL
   │
   ├── source === 'pdl' (nouveau, default à terme)
   │     │
   │     ├── pdl_profile_cache lookup (linkedin_url + filters_hash)
   │     │     ├── HIT → retourne profil cached, $0
   │     │     └── MISS ↓
   │     ├── mapFiltersToPdl() → SQL or ES DSL
   │     ├── POST PDL Person Search
   │     ├── pdlToLinkedInProfile() → format LinkedInProfile complet
   │     ├── INSERT pdl_profile_cache (TTL 30j)
   │     └── return profiles
   │
   └── source === 'apollo' (legacy, fallback opt-in)
         │ (code existant inchangé pendant la transition)
         └── ... (mapFiltersToApollo + bulk_match + apolloToLinkedInProfile)
```

### Nouvelle table : `pdl_profile_cache`
```sql
CREATE TABLE pdl_profile_cache (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pdl_id          text NOT NULL,                       -- p.id from PDL
  linkedin_url    text,                                -- canonical key
  profile_data    jsonb NOT NULL,                      -- LinkedInProfile complet
  filters_hash    text,                                -- SHA256(JSON.stringify(filters)) — debug
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '30 days'),

  UNIQUE (organization_id, pdl_id)
);
CREATE INDEX idx_pdl_cache_linkedin_url ON pdl_profile_cache (linkedin_url);
CREATE INDEX idx_pdl_cache_expires ON pdl_profile_cache (expires_at);
-- RLS : org membership only
ALTER TABLE pdl_profile_cache ENABLE ROW LEVEL SECURITY;
```

### Cache strategy
- **Lookup avant appel API** : si `linkedin_url` déjà présent en cache (même org, non expiré) → on retourne sans payer
- **TTL 30j** (data PDL refresh mensuel — plus court = inutile)
- **Cache global per-org** (pas par mission) : un profil enrichi pour une mission est dispo pour les autres missions de la même org → maximise le ROI des crédits
- **Bulk dedup pré-paiement** : avant l'appel PDL, dédupliquer la liste de `linkedin_url` candidats contre `outreach_profiles`, `vivier_contacts`, `pdl_profile_cache` → on n'envoie à PDL que les vraiment inconnus
- **Cron de purge** : nightly, supprime les entrées `expires_at < now()`

---

## 5. Roadmap proposée

### Phase 0 — Mesure (1 semaine, avant tout code)
- [ ] Activer un compte PDL Pro (ou trial) → `PDL_API_KEY` valide en prod
- [ ] Lancer 5–10 recherches type sur PDL via Postman avec différents critères (séniorité, location, skills, secteur)
- [ ] Mesurer : combien de profils utilisables par recherche, taux de doublons inter-recherches, temps de réponse, qualité emails (taux bounce)
- [ ] **Décision GO/NO-GO** : si le coût par profil utile est > 2× Apollo + l'écart de qualité ne le justifie pas, on n'y va pas.

### Phase 1 — Fondations (2–3 jours)
- [ ] Migration SQL `pdl_profile_cache` (table + RLS + index + cron purge)
- [ ] Helper `_shared/pdl-client.ts` : `searchPersons(query)`, `enrichPerson(linkedinUrl)`, `bulkEnrichPersons(urls[])`, `lookupCache(orgId, urls)`, `writeCache(orgId, profiles)`
- [ ] Helper `_shared/pdl-mapping.ts` : `mapFiltersToPdl(filters: LinkedInFiltersState): { sql?, esDsl? }`, `pdlToLinkedInProfile(p): LinkedInProfile` (vrai mapping complet, pas juste les champs Prospection)
- [ ] Tests unitaires sur les mappers (sans hit l'API)

### Phase 2 — Refactor `database-search` (2 jours)
- [ ] Ajouter param `source: 'pdl' | 'apollo'` (default `'apollo'` au début)
- [ ] Brancher PDL path : cache lookup → search → cache write → return
- [ ] Front : ajouter toggle `searchProvider` dans `LinkedInFiltersState` (ou en feature-flag par-org dans `organization_settings.feature_flags`)
- [ ] Tester en parallèle Apollo vs PDL sur les mêmes critères → comparer qualité

### Phase 3 — Bascule progressive (2 semaines de dogfood)
- [ ] Activer PDL par default pour Konekt internal (notre org) → on dogfood
- [ ] Dashboard interne : nb recherches Apollo vs PDL, coût total, hit-rate cache, qualité ressentie
- [ ] Activer PDL par default pour 2-3 clients pilotes
- [ ] Itérer sur les mappings (corriger les filtres mal traduits)

### Phase 4 — Sunset Apollo (1 mois après phase 3 stable)
- [ ] Activer PDL par default pour tous les nouveaux comptes
- [ ] Pour les comptes existants : option de switch dans Settings
- [ ] Garder `apollo-search` actif tant qu'au moins 1 client l'utilise (soft-deprecate)
- [ ] À terme : retirer `database-search` Apollo path, supprimer `apolloToLinkedInProfile` et `mapFiltersToApollo`

### Phase 5 — Bonus : Apollo retiré de Prospection aussi
- [ ] Refactorer `ProspectSearch.tsx` pour n'appeler que `pdl-search`
- [ ] Supprimer `apollo-search` edge function

---

## 6. Risques & mitigations

| Risque | Probabilité | Impact | Mitigation |
|--------|------------|--------|------------|
| Coût PDL > Apollo en pratique | Moyenne | Haut | Phase 0 mesure stricte avant code. Cache agressif + dedup pré-paiement. |
| Données moins fraîches (refresh mensuel PDL) | Élevée | Moyen | Afficher `last_updated` au user. Pour les emails sortie de bounce, fallback enrich-contact via Hunter ou autre. |
| GDPR — un candidat exige effacement | Haute (long terme) | Moyen | Process opt-out dans Settings utilisateur public ; supprime de `pdl_profile_cache` + ne pas re-fetch. Doc CGU à mettre à jour. |
| Qualité email PDL FR moins bonne qu'attendu | Moyenne | Moyen | Validation email via Hunter/NeverBounce avant envoi. Toggle "skip non-vérifiés". |
| Filtres LinkedIn pas tous mappables sur PDL | Faible | Faible | Liste des filtres ignorés en UI (badge "non supporté en mode PDL"). |
| Rate limit 10/min default trop bas | Élevée | Moyen | Throttle frontend + queue. Demander upgrade rate-limit en discutant avec PDL sales. |
| Coût ré-enrichissement si on perd le cache | Faible | Haut | Backup quotidien de `pdl_profile_cache` dans un bucket S3 / via Supabase backups standard. |
| Refus de la migration côté clients | Faible | Faible | Pas de breaking change visible — juste plus de data dans la table Notion. Communication "on a doublé la richesse de vos profils". |

---

## 7. Checklist Phase 0 (à faire en premier)

- [ ] Vérifier que `PDL_API_KEY` est bien set en prod : `supabase secrets list --project-ref crckfywoyjxkawathdff | grep PDL`
- [ ] Lancer 5 recherches via Postman contre `https://api.peopledatalabs.com/v5/person/search` avec différents critères type Konekt :
  - "Senior data engineer Paris Python AWS, 5+ ans"
  - "CTO startup Series A Paris/Lyon"
  - "Product manager retail tech, anglais courant"
  - "Lead frontend React + Next.js, France entière"
  - "Designer produit B2B, 3-7 ans, Paris"
- [ ] Pour chaque : compter nb profils retournés, qualité visuelle des champs (skills, education, emails), temps de réponse
- [ ] Estimer le coût d'une recherche moyenne (nb profils × $0,04 ou $0,28 selon plan)
- [ ] Comparer au coût Apollo équivalent (séparer search free + bulk_match required)
- [ ] **Présenter les chiffres à Laurent** → décision GO/NO-GO et choix du plan PDL

---

## 8. Sources

- [PDL Person Schema](https://docs.peopledatalabs.com/docs/fields)
- [PDL Person Search API](https://docs.peopledatalabs.com/docs/reference-person-search-api)
- [PDL Pricing](https://www.peopledatalabs.com/pricing/person)
- [PDL Privacy Center](https://privacy.peopledatalabs.com/)
- Audit codebase interne (lecture `supabase/functions/pdl-search/index.ts`, `database-search/index.ts`, `src/components/outreach/types.ts`) — 2026-04-27
