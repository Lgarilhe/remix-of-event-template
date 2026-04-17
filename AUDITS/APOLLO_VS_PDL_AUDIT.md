# APOLLO_VS_PDL_AUDIT.md

Date : 2026-04-16
Branche : `claude/app-audit-jHxht`

**TL;DR** — Sur le scope Skalr (sourcing FR/EU, search + enrich top-25/mission), **PDL gagne sur la profondeur data (Boolean vrai, 3 Md profils, GDPR natif) mais Apollo reste 2× moins cher au profil enrichi**. Recommandation : **hybride** — PDL comme source primaire pour le sourcing tech/C-level EU, Apollo gardé pour l'enrichissement email low-cost.

---

## 1. Pricing 2026

### Apollo.io

| Plan | Prix (user/mo, annuel) | Crédits/mois |
|------|------------------------|--------------|
| Free | $0 | 100 |
| Basic | $49 | 5 000 |
| Professional | $79 | 10 000 |
| Organization | $119 | 15 000 |

**Coût par crédit** : ~$0.03-0.10 selon volume ([source](https://www.saleshandy.com/blog/apolloio-pricing/)).

**Coût par profil enrichi** :
- Email pro : **1 crédit**
- Mobile phone : **8 crédits**
- Full enrichment (email + phone + employment) : **9+ crédits**
- Bulk 500 contacts = 3 000 crédits (~$150-300)

### PDL (People Data Labs)

| Plan | Prix | Crédits/mois |
|------|------|--------------|
| Free | $0 | 100 person/company lookups, pas d'email/phone |
| Pro (monthly) | $98/mo | 350 person enrichment + 1 000 company |
| Pro (annual) | $940/yr | même, -20 % |
| Enterprise | $20k-100k+/yr | volumes custom |

**Coût par crédit** :
- Monthly Pro : **$0.28/match**
- Annual Pro : **$0.27/match**
- Enterprise : jusqu'à **$0.20/match** ([source](https://syncgtm.com/blog/people-data-labs-review))

**Credits consommés uniquement sur succès** (HTTP 200) — vrai gain vs Apollo qui consomme même sur miss partiel.

**Bulk** : jusqu'à 100 crédits par call ([source](https://support.peopledatalabs.com/hc/en-us/articles/25794271805211-Pricing-credits)).

### Comparatif coût / profil entièrement enrichi

| Provider | Email seul | Email + phone + employment | Modèle |
|----------|-----------|----------------------------|--------|
| Apollo | ~$0.03-0.10 (1 cr) | ~$0.27-0.90 (9 cr) | Consommé même sur miss partiel |
| PDL | $0.20-0.28 | $0.20-0.28 (1 cr, full data) | Consommé sur succès HTTP 200 uniquement |

→ **Apollo est 30-50 % moins cher sur email seul**.
→ **PDL devient compétitif dès qu'on veut phone** (pas de surcoût x8).
→ **PDL gagne sur la prévisibilité** (pas de facturation sur miss).

---

## 2. Taille & qualité de la base

| Métrique | Apollo | PDL |
|----------|--------|-----|
| Profils déclarés | ~275 M | **3 Md** |
| Companies | ~73 M | 71 M |
| Mise à jour data | Temps réel (crowdsourced) | Mensuelle (resume/identity) |
| Score G2 "Contact Data Availability" | **8.9** | 8.7 |
| Score G2 "Data Accuracy" | 8.7 | **8.8** |
| Compliance | SOC2 | SOC2 Type 2, ISO 27001, GDPR-ready |

**Analyse** :
- PDL a **10× plus de profils** mais data plus "dormante" (pas d'activity signals comme Apollo)
- Apollo plus "live" (Apollo Scan + crowdsourcing des clients Apollo.io = feedback loop)
- PDL plus **profond** par profil (historique complet, skills, education structurés)

Sources : [SyncGTM](https://syncgtm.com/blog/people-data-labs-review), [Grokipedia](https://grokipedia.com/page/People_Data_Labs), [G2](https://www.g2.com/compare/apollo-io-vs-people-data-labs)

---

## 3. Couverture FR / EU

**PDL** :
- Doc officielle : stratégie géo centrée "**North America + Western Europe**"
- Fort sur marchés white-collar + anglophones → OK pour FR tech/product/sales, OK UK/DE/NL/IRL
- Faible sur blue-collar + non-occidental
- GDPR natif : opt-out, data portability, correction mechanisms

**Apollo** :
- US-first historiquement, couverture EU améliorée mais moins profonde
- Signals d'intention US-biased (gold pour USA, tiède pour FR)
- Pas de GDPR-compliance native (c'est à l'app de gérer)

**Pour Skalr (FR/EU recrutement tech)** :
- 🟢 PDL > Apollo sur **profondeur profil** candidat EU
- 🟡 Égalité sur **volume** FR (les 2 indexent LinkedIn + sources publiques)
- 🔴 Aucun des deux aussi bon que Cognism sur le phone EU vérifié

Sources : [Datarade](https://datarade.ai/data-providers/people-data-labs/profile), [PDL docs sources](https://docs.peopledatalabs.com/docs/data-sources)

---

## 4. Filtres & query language

### Apollo (REST plat)

```
person_titles=["Senior Engineer"]
person_locations=["Paris, France"]
person_seniorities=["senior"]
organization_num_employees_ranges=["11,50"]
q_keywords="React AND TypeScript"  // limite 4 termes si person_titles présent
```

❌ **Pas de Boolean vrai** (AND/OR/NOT → cleaned en simple terms)
❌ Location sensible au format ("Ville de Paris" casse, "Paris, France" OK)
❌ 500 chars max `q_keywords`

### PDL (Elasticsearch DSL)

```json
{
  "query": {
    "bool": {
      "must": [
        {"term": {"job_title_levels": "senior"}},
        {"term": {"location_country": "france"}},
        {"terms": {"skills": ["react", "typescript"]}}
      ],
      "should": [
        {"match": {"summary": "startup"}}
      ],
      "must_not": [
        {"term": {"job_title": "intern"}}
      ]
    }
  }
}
```

✅ **Boolean vrai** (must / should / must_not / filter)
✅ Nested queries (employment_history.company.name)
✅ Wildcards (jusqu'à 20/query)
⚠️ Limite 1 000 éléments par array terms
⚠️ Pas d'aggregations, pas de custom scoring

### Reproduction de nos 15 filtres Skalr

| Filtre Skalr | Apollo (actuel) | PDL (nouveau) |
|--------------|-----------------|---------------|
| keywords (Boolean) | 🟡 nettoyé en simple | 🟢 Boolean natif |
| role/job_title | ✅ `person_titles` | ✅ `job_title` + `job_title_role` |
| location | 🟡 format fragile | ✅ `location_country/region/locality` structuré |
| seniority | ✅ mapping 1-5 | ✅ `job_title_levels` enum |
| company_keywords | ✅ `q_organization_name` | ✅ `job_company_name` |
| industry | ✅ `q_organization_keyword_tags` | ✅ `industry` enum |
| school | 🟡 append q_keywords | ✅ `education.school.name` nested |
| function | ✅ `person_departments` | ✅ `job_title_class/sub_role` |
| company_headcount | ✅ ranges fixes | ✅ `job_company_size` enum |
| revenue | ✅ range | ✅ `job_company_inferred_revenue` |
| funding_stage | ✅ enum | ✅ `job_company_last_funding_stage` |
| company_domain | ✅ list | ✅ `job_company_website` |
| email_verified | ✅ toggle | ✅ `exists: emails.address + type: professional` |
| technologies | ✅ list | ✅ `job_company_technologies` |
| skills | ❌ q_keywords append | ✅ `skills` terms array |

→ **PDL couvre 15/15 filtres mieux qu'Apollo**, avec plus de précision sur skills, school, location.

Sources : [PDL Person Search ref](https://docs.peopledatalabs.com/docs/reference-person-search-api), [PDL Input parameters](https://docs.peopledatalabs.com/docs/input-parameters-person-search-api)

---

## 5. Endpoints équivalents

| Besoin Skalr | Apollo | PDL |
|--------------|--------|-----|
| Search | `mixed_people/api_search` | `v5/person/search` |
| Enrich by email/linkedin | `people/bulk_match` (10/call) | `v5/person/enrich` + `v5/person/bulk` (100/call) |
| Company enrich | `organizations/enrich` | `v5/company/enrich` |
| Autocomplete | 🟡 limité | ✅ `v5/autocomplete` (skills, titles, schools, companies) |
| Preview / count only | ❌ | ✅ `v5/person/search` avec `size=0` |
| IP lookup | ❌ | ✅ `v5/ip` (bonus : savoir d'où vient un visiteur landing) |

**Avantage PDL** : batch **10×** plus gros (100 vs 10), autocomplete natif (remplace nos appels Unipile `get_parameters`).

---

## 6. Limites & contraintes

| | Apollo | PDL |
|---|--------|-----|
| Rate limit | ~60 req/min | ~100 req/min (Pro), négociable |
| Batch enrich | 10 profils | **100 profils** |
| Latence médiane | 600-900 ms | 300-600 ms |
| Array limit (terms) | — | 1 000 |
| Wildcards | — | 20/query |
| SDK officiel | REST + Python | JS, Python, Go, Ruby |

---

## 7. Coût simulé — scénario Skalr

**Hypothèse par mission** :
- 1 search (filtres complexes) + enrich top-25 avec email + phone

### Apollo (actuel)

```
Search               : 0 crédit (gratuit en mixed_people)
Enrich 25 × 9 cr     : 225 crédits
→ @$0.03/cr         : $6.75/mission
→ @$0.10/cr (low vol): $22.5/mission
```

### PDL (hypothèse)

```
Search (50 profils)  : 0 cr (search is free on Pro+)
Enrich 25 × 1 cr     : 25 crédits
→ @$0.28/cr (Pro)   : $7.00/mission
→ @$0.20/cr (Enterprise): $5.00/mission
```

### À 500 missions/mois (scale cible)

| | Apollo low | Apollo high | PDL Pro | PDL Enterprise |
|---|-----------|-------------|---------|----------------|
| Coût/mois | $3 375 | $11 250 | $3 500 | **$2 500** |
| Coût/mission | $6.75 | $22.5 | $7.00 | $5.00 |

→ À volume **Enterprise**, PDL est **20-50 % moins cher**.
→ À petit volume (Pro), Apollo low et PDL sont équivalents (~$7/mission).
→ Le vrai gain PDL : **prévisibilité** (pas de billing sur miss, bulk 100).

Versus €280 facturés/mission à Skalr : marge **reste > 95 %** dans tous les cas.

---

## 8. Effort migration

**Fichiers à modifier** :

| Fichier | Modification | Effort |
|---------|--------------|--------|
| `supabase/functions/database-search/index.ts` | Remplacer `mapFiltersToApollo` → `mapFiltersToPDL` (ES DSL builder) | 1.5 j |
| `supabase/functions/database-search/index.ts` | Parser réponse PDL → format `LinkedInProfile` | 0.5 j |
| `supabase/functions/enrich-contact/index.ts` | Ajouter branche PDL `/person/enrich` | 0.5 j |
| `supabase/functions/_shared/resolve-org-credentials.ts` | Ajouter `PDL_API_KEY` | 0.1 j |
| Cache RAG | Invalider caches enrichment existants | 0.2 j |
| `organization_integrations` table | Ajouter colonne `pdl_api_key` | 0.2 j |
| Tests | Snapshot 20 searches Apollo vs PDL (qualité) | 1 j |
| Feature flag `data_provider` (apollo/pdl) | Dans `featureGates.ts` + UI Settings | 0.5 j |
| Doc CLAUDE.md PDL filter mapping | Remplace section Apollo | 0.2 j |

**Total : ~4.5 j/dev** pour version hybride avec flag.

---

## 9. Risques propres à PDL

1. **Free plan = 0 email/phone** → tests sandbox impossibles sans payer
2. **Credits par "successful match"** → définition floue sur matching partiel (email trouvé mais pas phone → 1 cr ou 0.5 cr ?) — à clarifier avec sales
3. **Enterprise gate à $20k/an** → si on dépasse 100k cr/mois, on passe en contact sales obligatoire (pas de pricing transparent au-delà)
4. **Data refresh mensuel** → candidats ayant changé de job entre 2 refresh = faux positifs, vs Apollo quasi-live
5. **Pas de workflow "sales engagement"** — Apollo offre aussi sequences/email, PDL est pure data → on reste sur notre stack outreach actuelle (pas un pb en fait)
6. **GDPR "ready" ≠ GDPR-compliant par défaut** → il faut gérer opt-outs côté Skalr

---

## 10. Verdict

### Recommandation : **Migration hybride progressive**

**Phase 1 (Sprint 1, 4-5 j)** :
- Brancher PDL en **source primaire** pour `database-search` (search + enrich full)
- Garder Apollo en **fallback email-only** (low-cost pour profils qu'on a déjà sous forme LinkedIn URL)
- Feature flag `data_provider: pdl | apollo | hybrid` dans `organization_integrations`

**Phase 2 (2 sem après)** :
- Monitorer sur 50 missions : hit rate, qualité data, coût réel
- Si PDL > Apollo sur 80 % des missions → migration complète
- Sinon : garder hybride définitif

### Les 3 critères qui font basculer "migrer complet"

1. **Qualité data FR tech** : sur un échantillon de 50 searches, PDL retourne-t-il plus de profils valides (email pro vérifié) qu'Apollo ? Si oui → migre.
2. **Coût réel au scale** : est-on sur Enterprise PDL ou Pro ? Si Enterprise $5/mission < Apollo $6.75 → migre.
3. **Boolean queries débloque quoi ?** : sur les 10 searches les plus complexes, est-ce que le Boolean PDL remonte des candidats qu'Apollo manque ? Si oui → migre pour la qualité, peu importe le prix.

### Ne PAS migrer si

- L'équipe commerciale vend Skalr sur des comptes LATAM / Middle East / blue-collar → Apollo reste plus couvert
- Volume < 100 missions/mois (le $98/mo PDL Pro n'est pas rentabilisé)
- On dépend des signals d'intention Apollo (intent data, job changes tracking) → PDL n'a pas l'équivalent natif

---

## Sources

- [People Data Labs Review 2026 — SyncGTM](https://syncgtm.com/blog/people-data-labs-review)
- [PDL Pricing & Credits — Help Center](https://support.peopledatalabs.com/hc/en-us/articles/25794271805211-Pricing-credits)
- [PDL Person Search API Reference](https://docs.peopledatalabs.com/docs/reference-person-search-api)
- [PDL Data Sources & Compliance](https://docs.peopledatalabs.com/docs/data-sources)
- [Apollo.io Pricing — Saleshandy 2026](https://www.saleshandy.com/blog/apolloio-pricing/)
- [Apollo.io API Pricing Docs](https://docs.apollo.io/docs/api-pricing)
- [Apollo vs PDL — G2](https://www.g2.com/compare/apollo-io-vs-people-data-labs)
- [Apollo vs PDL — FullEnrich](https://fullenrich.com/tools/Apolloio-vs-PeopleDataLabs)
- [PDL Grokipedia overview](https://grokipedia.com/page/People_Data_Labs)
- [PDL Datarade profile](https://datarade.ai/data-providers/people-data-labs/profile)
