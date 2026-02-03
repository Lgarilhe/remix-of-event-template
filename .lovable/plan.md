
# Plan : Enrichir les données de scoring IA

## Objectif
Ajouter le "À propos" (summary) et les descriptions détaillées des expériences pour améliorer la qualité du matching profil/poste.

---

## Données actuellement envoyées vs disponibles

| Donnée | Disponible dans l'API | Envoyée à l'IA |
|--------|----------------------|----------------|
| Nom | ✅ | ✅ |
| Headline | ✅ | ✅ |
| Poste actuel + Entreprise | ✅ | ✅ |
| Localisation | ✅ | ✅ |
| Skills (liste) | ✅ | ✅ (max 15) |
| Années d'XP | ✅ (calculé) | ✅ |
| **Summary / À propos** | ✅ | ❌ **Manquant** |
| **Description des postes** | ✅ | ❌ **Manquant** |
| **Skills par poste** | ✅ | ❌ **Manquant** |
| **Description entreprise** | ✅ | ❌ **Manquant** |
| Education | ✅ | ✅ (format simple) |

---

## Modifications prévues

### 1. Frontend - `LinkedInSearch.tsx` (fonction `buildProfileData`)

Enrichir les données du profil envoyées :

```text
Avant :
{
  name, headline, currentRole, currentCompany, location,
  skills: [...15 premiers],
  pastPositions: ["Role chez Company", ...],
  education: ["Diplôme - École", ...],
  yearsOfExperience
}

Après :
{
  name, headline, currentRole, currentCompany, location,
  skills: [...15 premiers],
  summary: "Le contenu du À propos LinkedIn...",  // NOUVEAU
  workExperience: [                                // NOUVEAU - enrichi
    {
      role: "Staff Engineer",
      company: "Datadog",
      duration: "2 ans",
      description: "Développement de la plateforme...",
      skills: ["Go", "K8s"],
    },
    // ... 2 autres postes
  ],
  education: ["Master Informatique - Polytechnique (2015)", ...],
  yearsOfExperience
}
```

### 2. Backend - Edge Function `score-profile-job`

**Mettre à jour l'interface TypeScript :**
```typescript
interface ProfileData {
  name: string;
  headline?: string;
  currentRole?: string;
  currentCompany?: string;
  location?: string;
  skills?: string[];
  summary?: string;           // NOUVEAU
  workExperience?: Array<{    // NOUVEAU (remplace pastPositions)
    role: string;
    company: string;
    duration?: string;
    description?: string;
    skills?: string[];
  }>;
  pastPositions?: string[];   // Garder pour rétrocompatibilité
  education?: string[];
  yearsOfExperience?: number;
}
```

**Adapter le prompt :**
```text
PROFIL:
- Nom: Thomas Dupont
- Titre: Lead Backend Engineer | Ex-Doctolib
- Poste: Staff Engineer @ Datadog
- Loc: Paris
- XP: ~8 ans

📝 À PROPOS:
"Passionné par le Domain-Driven Design et les architectures distribuées.
J'ai quitté Doctolib pour rejoindre une scale-up avec plus d'ownership..."

💼 EXPÉRIENCES RÉCENTES:
1. Staff Engineer @ Datadog (2 ans)
   → Refonte architecture event-driven, migration K8s
   → Skills: Go, Kubernetes, Kafka

2. Senior Backend @ Doctolib (3 ans)
   → Développement de l'API de prise de RDV
   → Skills: Python, PostgreSQL, Redis

3. Backend Developer @ Criteo (2 ans)
   → Système de recommandation temps réel
   → Skills: Java, Spark

🎓 Formation: Master Informatique - Polytechnique (2015)
🔧 Skills: Go, Python, Kubernetes, Kafka, PostgreSQL, Redis
```

---

## Impact sur le scoring

### Avec les nouvelles données, l'IA pourra :

1. **Détecter les motivations** depuis le "À propos"
   - Ex: "ownership", "scale-up" → match avec startup
   - Ex: "impact sociétal" → match avec healthtech

2. **Évaluer la profondeur technique** depuis les descriptions
   - Ex: "refonte architecture" → expérience design system
   - Ex: "migration K8s" → hands-on infra

3. **Identifier les skills implicites**
   - Description mentionne "event-driven" → Kafka probable
   - Description mentionne "temps réel" → streaming data

4. **Mieux juger la séniorité**
   - Descriptions longues avec impact = senior
   - Descriptions courtes/vagues = junior ou exécutant

---

## Gestion des tokens

| Scénario | Tokens estimés |
|----------|---------------|
| Avant (données minimales) | ~400-500 tokens |
| Après (données enrichies) | ~600-800 tokens |
| **Surcoût** | ~+50% par profil |

**Optimisation prévue :**
- Limiter le summary à 300 caractères
- Limiter chaque description de poste à 200 caractères
- Maximum 3 expériences envoyées
- Skills par poste : max 5

---

## Fichiers à modifier

| Fichier | Modification |
|---------|-------------|
| `src/components/outreach/LinkedInSearch.tsx` | Enrichir `buildProfileData()` avec summary + descriptions |
| `supabase/functions/score-profile-job/index.ts` | Mettre à jour interface + prompt |

---

## Résultat attendu

**Avant (score parfois approximatif) :**
```json
{
  "match_score": 70,
  "summary": "Profil senior backend, skills compatibles",
  "recommendation": "maybe"
}
```

**Après (score plus précis et justifié) :**
```json
{
  "match_score": 85,
  "summary": "Profil DDD/archi distribuée, XP Datadog pertinente pour le contexte scale",
  "recommendation": "go",
  "reasoning": "Le À propos mentionne 'ownership' qui matche avec la culture startup recherchée"
}
```
