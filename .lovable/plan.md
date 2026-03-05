

# Analyse comparative Teamtailor vs Konekt ATS

## Features Teamtailor que Konekt possede deja
- Kanban / pipeline personnalisable
- Scoring / matching candidat-job (AI)
- Sourcing LinkedIn + extension
- Sequences d'outreach automatisees
- Notes et rappels sur candidats
- Dashboard analytics (funnel, activite, KPIs)
- Nurturing / relance candidats passifs
- Inbox messages
- Filtres avances et recherche
- Integration Notion / Airtable (equivalent des integrations tierces)

---

## Features manquantes interessantes a integrer

### 1. Scorecards d'evaluation structurees
Teamtailor permet de creer des grilles d'evaluation (scorecards) avec criteres ponderes pour noter les candidats en entretien. Konekt a un scoring AI automatique mais pas de grille manuelle collaborative.

**Implementation**: Ajouter un onglet "Evaluation" dans le CandidateDetailModal avec des criteres configurables par poste, notation 1-5 par critere, et calcul d'un score moyen. Stockage dans une table `candidate_evaluations`.

### 2. Comparaison de candidats cote a cote
Pouvoir selectionner 2-4 candidats et les comparer sur un meme ecran (scoring, experience, competences, notes).

**Implementation**: Bouton "Comparer" dans la vue Table/Kanban, ouvre un modal avec colonnes paralleles par candidat. Donnees deja disponibles via `useATSData`.

### 3. Guide times / Alertes de stagnation
Definir un temps max par etape du pipeline. Si un candidat depasse ce delai, alerte visuelle.

**Implementation**: Config par stage (ex: "Contacte" = 5 jours max). Dans le Kanban/Table, badge rouge si `daysSinceStageChange > guideTime`. La donnee `lastActivity` existe deja. Table `stage_guide_times` pour stocker les configs.

### 4. Smart Schedule (planification d'entretiens)
Integration calendrier pour proposer des creneaux aux candidats automatiquement. Teamtailor genere un lien avec les dispos du recruteur.

**Implementation**: Konekt a deja `calendly_link` sur les projets. Enrichir avec un bouton "Planifier entretien" dans le detail candidat qui genere un lien Calendly pre-rempli ou un mini-scheduler interne.

### 5. Partage de profil candidat (lien externe)
Generer un lien securise pour partager un profil candidat avec un client ou hiring manager externe, sans acces a l'ATS.

**Implementation**: Edge function qui genere un token unique, page publique `/shared/candidate/:token` avec les infos selectionnees (nom, headline, scoring, notes filtrees). Table `candidate_shares`.

### 6. Templates de messages
Bibliotheque de modeles de messages reutilisables (rejection, relance, offre) avec variables dynamiques.

**Implementation**: Table `message_templates` avec `name`, `category`, `subject_template`, `body_template`, `variables`. Selector dans le compose d'InMail et les sequences. Variables type `{{candidate_name}}`, `{{job_title}}`.

### 7. NPS / Surveys candidats
Envoyer un court sondage aux candidats apres le process pour mesurer leur experience.

**Implementation**: Plus complexe, necessite un formulaire public. Pourrait etre simplifie avec un lien Google Forms ou Typeform integre.

### 8. Pipeline reporting avance
Rapport de conversion par etape : combien passent de "Contacte" a "Repondu", de "Repondu" a "Pre-qualif", etc. Temps moyen par etape.

**Implementation**: Deja partiellement dans le Dashboard (funnel). Ajouter les taux de conversion inter-etapes et le temps moyen par etape. Calcul client-side depuis `candidates`.

### 9. Tags candidats
Systeme de tags libres sur les candidats pour filtrer/organiser (ex: "urgent", "top profil", "a recontacter").

**Implementation**: Table `candidate_tags` ou champ `tags text[]` sur `job_candidate_status`. Filtre dans ATSFilters. UI chips dans les cards.

---

## Priorites recommandees (impact vs effort)

```text
Feature                    | Impact | Effort | Priorite
---------------------------|--------|--------|----------
Tags candidats             | Haut   | Faible | 1
Guide times / stagnation   | Haut   | Faible | 2
Pipeline reporting avance  | Haut   | Moyen  | 3
Comparaison candidats      | Moyen  | Moyen  | 4
Scorecards d'evaluation    | Haut   | Moyen  | 5
Templates de messages      | Moyen  | Moyen  | 6
Partage profil externe     | Moyen  | Eleve  | 7
Smart Schedule enrichi     | Moyen  | Eleve  | 8
NPS Surveys                | Faible | Eleve  | 9
```

Les 3 premieres features (tags, guide times, pipeline reporting) sont realisables rapidement car elles s'appuient sur des donnees deja presentes dans l'app. Les scorecards et la comparaison apporteraient une vraie valeur collaborative.

