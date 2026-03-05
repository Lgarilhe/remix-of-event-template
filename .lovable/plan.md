

## Plan — Coach Live Scorecard avec Transcription Deepgram

Ton spec est excellente et bien pensée. Voici mon analyse et le plan d'implémentation adapté au projet.

### Analyse de la spec

**Ce qui est solide :**
- Architecture WebSocket Deepgram directe (pas de chunks HTTP) -- approche optimale
- Clé temporaire via Edge Function -- bonne pratique sécurité
- Coach toutes les 15s ou fin d'utterance -- bon compromis coût/réactivité
- Génération CR en fin de call -- workflow naturel
- Table `call_coaching_sessions` pour persister l'historique

**Ajustements nécessaires pour le projet :**
- Les Edge Functions doivent utiliser les CORS headers du projet et `verify_jwt = false` dans config.toml
- L'API Deepgram pour clés temporaires nécessite le `PROJECT_ID` Deepgram comme secret supplémentaire
- La table ne doit PAS utiliser de CHECK constraint (utiliser un trigger de validation ou laisser le champ libre)
- Le coach utilise déjà `ANTHROPIC_API_KEY` (déjà configuré comme secret)
- Il faut un secret `DEEPGRAM_API_KEY` (pas encore configuré)

---

### Implémentation en 5 étapes

#### 1. Secret Deepgram + Migration DB

- Demander le secret `DEEPGRAM_API_KEY` via l'outil add_secret
- Créer la table `call_coaching_sessions` (sans CHECK constraint, statut libre) avec RLS policies pour l'utilisateur authentifié
- Index sur `candidate_id, created_at desc`

#### 2. Edge Function `deepgram-temp-key`

- Approche MVP simplifiée : retourne directement la clé API (pas de clé temporaire pour commencer, car l'API de clés temporaires Deepgram nécessite aussi le PROJECT_ID)
- CORS headers standards, `verify_jwt = false`

#### 3. Edge Function `live-coach`

- Reçoit `session_id`, `full_transcript`, `latest_chunk`, `criteria`, `job_context`, `elapsed_seconds`
- Appelle Claude via Anthropic API (clé déjà configurée)
- Retourne `{ alerts, suggestions, criteria_updates }`
- Sauvegarde transcript + coach_feed dans `call_coaching_sessions`

#### 4. Edge Function `generate-call-report`

- Reçoit transcript complet, critères avec scores, contexte poste, alertes
- Claude génère : summary, évaluation par critère avec verbatims, forces, red flags, questions ouvertes, recommandation GO/NO_GO/A_CREUSER, message de suivi
- Sauvegarde le rapport dans la session

#### 5. UI Coaching Live dans ScorecardTab

- Bouton "COACHING LIVE" en haut de la scorecard active
- Au clic : zone coach slide-down avec :
  - **Transcription live** (texte défilant avec interim en gris)
  - **Feed coach** (alertes danger/warning/info + suggestions de questions)
  - **Critères auto-détectés** (badges verts sur les critères couverts avec verbatim)
- Bouton "ARRÊTER" ferme le WebSocket et le micro
- Bouton "GÉNÉRER LE CR" appelle `generate-call-report` et affiche le rapport avec boutons copier/sauvegarder
- Les auto-scores du coach pré-remplissent les ratings de la scorecard

---

### Fichiers créés/modifiés

| Fichier | Action |
|---|---|
| `supabase/functions/deepgram-temp-key/index.ts` | Nouveau |
| `supabase/functions/live-coach/index.ts` | Nouveau |
| `supabase/functions/generate-call-report/index.ts` | Nouveau |
| `src/components/ats/ScorecardTab.tsx` | Modifié (bouton + UI coach + logique WebSocket) |
| `supabase/config.toml` | Ajout 3 fonctions `verify_jwt = false` |
| Migration SQL | Table `call_coaching_sessions` + index + RLS |

