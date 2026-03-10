

## Plan : Enrichissement contacts clients via Apollo + Génération messages via Claude Sonnet

### Données actuelles
- **1171 contacts** au total
- **776** ont une URL LinkedIn → enrichissement Apollo via `linkedin_url`
- **395** sans URL LinkedIn mais ont `full_name` + `company_name` (via join companies) → enrichissement Apollo via `first_name` + `last_name` + `domain`
- **731** ont un mobile → SMS possible
- Champs utiles dans `raw_data` : `Prénom`, `Nom`, `Mobile`, `Ligne direct`, `URL linkedin`, `Tutoiement`, `Titre du poste`

### Architecture

#### 1. Table `vivier_enrichments`
Stocke le résultat Apollo + verdict AI + message généré par contact.

| Colonne | Description |
|---|---|
| `contact_airtable_id` (text, unique) | Lien vers airtable_contacts |
| `linkedin_url` | URL LinkedIn (directe ou trouvée par Apollo) |
| `match_type` | `'linkedin'` ou `'fuzzy'` |
| `current_job_title` | Poste actuel Apollo |
| `current_company` | Société actuelle |
| `headline` | Headline |
| `location` | Localisation |
| `apollo_data` | JSONB complet Apollo |
| `is_relevant` | Verdict AI |
| `relevance_reason` | Explication |
| `generated_message` | SMS ou message généré |
| `message_type` | `'sms'` / `'linkedin'` |
| `message_status` | `'draft'` / `'sent'` / `'skipped'` |
| `enriched_at` | Timestamp |
| `organization_id` | Multi-tenant |

RLS org-based.

#### 2. Edge function `enrich-vivier-contacts`

**Enrichissement Apollo** (batch de 10 via `/api/v1/people/bulk_match`) :
- Contacts avec LinkedIn URL → paramètre `linkedin_url`
- Contacts sans LinkedIn URL → paramètres `first_name` + `last_name` + `domain` (domaine du site web de la société Airtable, ou nom société)
- Apollo retourne le profil actuel : poste, société, localisation, email, téléphone, parcours

**Qualification + Message via Claude Sonnet** (Anthropic, `ANTHROPIC_API_KEY` déjà configuré) :
- Un appel par contact enrichi avec tout le contexte :
  - Profil Apollo actuel (poste, société, parcours)
  - Historique Airtable (shortlists avec noms de postes/candidats, notes, placements)
  - Type de contact (Référent RH, Décisionnaire, etc.)
  - Préférence tutoiement depuis `raw_data->>'Tutoiement'`
  - Mobile dispo → SMS court (~160 chars) ; sinon → message LinkedIn
- L'AI qualifie (pertinent ou non) et génère le message en un seul appel

#### 3. UI dans VivierList

- **Bouton "Enrichir & qualifier"** dans la barre de filtres
- **Progress bar** : traitement par batch de 10, délai entre appels
- **Colonnes enrichies** : poste actuel (vs ancien), badge Pertinent/Non pertinent
- **Sheet contact enrichi** : profil actuel + SMS/message preview + bouton copier
- **Filtres** : "Pertinents uniquement", "Avec message prêt", "Avec mobile"

#### 4. Flux

```text
Contacts avec LinkedIn → Apollo bulk_match(linkedin_url) → enrichi
Contacts sans LinkedIn → Apollo bulk_match(first_name + last_name + domain) → enrichi
Tous enrichis → Claude Sonnet (qualification + message)
  → Liste avec badges pertinence + messages prêts
  → Clic contact → Sheet avec profil actuel + SMS → Copier
```

### Fichiers à créer/modifier
- **Migration** : table `vivier_enrichments` + RLS
- **Edge function** : `supabase/functions/enrich-vivier-contacts/index.ts`
- **Config** : `supabase/config.toml` (verify_jwt = false)
- **Hook** : `src/hooks/useVivierEnrichment.ts` (batch, progression)
- **UI** : `src/components/prospection/VivierList.tsx` (bouton, colonnes, sheet enrichi)
- **Hook existant** : `src/hooks/useVivierCandidates.ts` (join enrichments)

### Secrets
Tout est déjà configuré : `APOLLO_API_KEY`, `ANTHROPIC_API_KEY`.

