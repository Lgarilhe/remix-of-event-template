# Paysage concurrentiel — Skalr

Date : 2026-04-16

## Tableau récap (13 concurrents)

| Outil | Positionnement | Forces | Failles | Concurrent direct ? |
|---|---|---|---|---|
| **Juicebox (PeopleGPT)** | YC S22, leader US sourcing IA | 800 M profils, 30+ sources, agents autonomes 24/7 à 300 $/mo, export CSV contact, 41 ATS + 21 CRM intégrés, Talent Insights 15 charts | Focalisé sourcing, ATS/pipeline moins poussé | 🔴 OUI (le + proche) |
| **Kalent** | Fr, cabinet + in-house | 200 M profils EU+US, 900 M LinkedIn, Lookalike Discovery, multi-canal (LinkedIn + email + WhatsApp), 30 %+ reply rate | Peu d'ATS/pipeline, pas de live coach | 🔴 OUI (marché FR identique) |
| **Gem** | All-in-one US | ATS + CRM + sourcing + scheduling + analytics, AI Rediscovery (ressort silver medalists), AI Talent Insights, 5× productivité, 800 M+ profils | Prix élevé, moins de focus LinkedIn recruiter | 🔴 OUI (pour ambition ATS complet) |
| **Fetcher** | Sourcing-as-a-service | AI + human-in-the-loop, 40 % reply rate, email sequences automatisées | Pas vraiment self-serve, humain dans la boucle | 🟠 |
| **Hireflow** | AI sourcing simple | Email Finder, LinkedIn extension, Talent CRM, reporting | Moins différenciant | 🟠 |
| **Leonar** | LinkedIn-focused mid-market | 3-source search, multi-channel sequences | Focus LinkedIn uniquement | 🟠 (FR aussi) |
| **SeekOut** | Agentic + diversité | 330 M profils sous-représentés, diversité best-in-class, market intelligence | Cher, US-only, UX datée | 🟡 (diff use-case) |
| **Findem** | Talent Data Cloud | 1.6 T data points de 100k sources, attribute-based filtering, "people intelligence" | Setup lourd, enterprise-only | 🟡 |
| **hireEZ** | Outbound + market research | Diversité, insights marché underrepresented | UX datée | 🟡 |
| **Paradox (Olivia)** | Conversational IA | 90 % du screening/scheduling auto via SMS/WhatsApp/chat, 100+ langues, 24/7 | Pas de sourcing, high-volume only | 🟡 (complément, pas concurrent) |
| **Metaview** | Interview IA | Écoute Zoom/Meet/phone, notes structurées, scorecard auto-remplie, mapping evidence→competencies | Pas de sourcing | 🟡 (complément) |
| **Mercor** | AI interviewer | Interview 20 min IA (voix + vidéo), transcript, ranking auto, talent pool persistant | Remplace le recruteur au screening | 🟢 (use-case différent) |
| **Eightfold AI** | Talent intelligence | Skills adjacencies, growth potential, mobilité interne, workforce planning | Enterprise lourd | 🟢 (pas sourcing agency) |
| **Ashby** | ATS moderne | Analytics-first 4.7/5 G2, workflows flexibles, pricing agences | AI récente, moins IA | 🟡 (ATS concurrent mais pas core IA) |

Légende : 🔴 concurrent direct · 🟠 partiel · 🟡 adjacent · 🟢 complémentaire

---

## Ce que les concurrents ont et que Skalr n'a PAS

### 🔴 Features qui font mal en démo

1. **Agents autonomes 24/7** (Juicebox, Gem, Findem, Paradox)
   - Juicebox : agent qui source pendant la nuit, apprend du feedback recruteur, livre les profils le matin. 300 $/mo add-on qui cartonne.
   - Skalr : `run-agent-search` est un worker backend limité, pas un vrai agent autonome avec feedback loop.

2. **AI Rediscovery** (Gem)
   - Re-surface les past applicants et silver medalists de l'ATS/CRM quand une mission correspond.
   - Skalr : le Vivier existe, mais pas de re-surfaçage auto des candidats déjà vus sur une nouvelle mission.

3. **Talent Insights / Market Intelligence** (Juicebox, SeekOut, Findem, Gem)
   - 15+ graphiques temps réel : salary bands, talent supply, diversité, concurrence, localisation. Avant même de lancer la recherche.
   - Skalr : **0**. `MissionInsights` = analytics post-sourcing uniquement.

4. **Interview IA + scorecard auto** (Metaview, Mercor, HireVue)
   - Metaview écoute Zoom/Meet, génère notes structurées, remplit la scorecard, map evidence → compétences, push dans l'ATS.
   - Skalr : `live-coach` = stub (Gemini Flash génère une intro statique, Deepgram pas branché).

5. **Scheduling conversationnel SMS/WhatsApp** (Paradox)
   - Olivia gère 90 % du scheduling/screening via SMS/WhatsApp 24/7 dans 100+ langues.
   - Skalr : `MyWhatsAppAccount` existe en Settings mais pas de flow d'automatisation.

6. **Email verification intégrée** (Juicebox, Fetcher)
   - Trouve l'email pro + vérifie le bounce avant l'envoi. Réduit le bounce rate à <2 %.
   - Skalr : pas de vérification intégrée (pas de ZeroBounce/NeverBounce/Hunter).

7. **Lookalike discovery** (Kalent)
   - "Trouve-moi 50 profils qui ressemblent à Paul Dupont qui a bien réussi chez mon client."
   - Skalr : embeddings présents dans `candidate_profiles`, mais pas de `find_similar()` UX-exposé.

### 🟠 Features qui conditionnent l'expansion

8. **Intégrations ATS natives** (Juicebox : 41, Gem : Greenhouse/Workday/Lever natif)
   - Push candidat + scorecard + CV dans l'ATS du client.
   - Skalr : Notion/Airtable/Aircall en API-key DIY. **0 ATS recruteur pro**.

9. **Interview scheduling natif** (Paradox, Gem, Ashby)
   - Sync calendar, propose slots, gère no-show, rappelle.
   - Skalr : `calendly-webhook` existe mais hors du flow. Pas de slot picker intégré.

10. **Export CSV avec contact info** (Juicebox)
    - Export immédiat pour push vers n'importe quel outil externe.
    - Skalr : export limité, à vérifier.

11. **Analytics cabinet / reporting client PDF** (Gem, Ashby)
    - Rapport auto "pour la mission X : 127 profils sourcés, 15 contactés, 4 en process, 1 embauché".
    - Skalr : `MissionInsights` existe mais pas de vue agency ni de PDF client.

### 🟡 Maturité enterprise

12. **SSO + SCIM + audit logs** (Gem, Ashby, Paradox, Eightfold)
    - Bloque les deals > 50 sièges.
    - Skalr : auth email/pwd Lovable uniquement.

13. **Diversité + OFCCP compliance** (SeekOut, Findem, hireEZ)
    - US-centric mais critique grands comptes.
    - Skalr : 0.

14. **Skills adjacencies / internal mobility** (Eightfold)
    - Match sur compétences adjacentes, pas sur mots-clés.
    - Skalr : scoring IA custom mais pas de graph compétences.

---

## Ce que Skalr fait **mieux** ou que les concurrents n'ont pas

- **Marché cabinet/freelance français** : le seul (avec Kalent) à vraiment comprendre le modèle agency. Invitations freelance, marketplace, agency settings, `ClientPortal`. Juicebox/Gem/Fetcher sont 100 % in-house US.
- **RAG unifié cross-entity** : `retrieve_context_multi` (candidat + jobs liés), 12 chunk types, dédup SHA-256, ingestion auto LinkedIn/Airtable/Aircall. Peu de concurrents ont ça niveau architecture.
- **Brief → filtres IA → scoring → message** en une chaîne unique. Juicebox et Kalent l'ont partiellement, mais `BriefWizard` + `generate-search-filters` + `score-profile-job` + `generate-outreach-message` est propre.
- **Triple source sourcing** : Unipile LinkedIn + Apollo + PDL. Dérisque le "no-LinkedIn". Juicebox = 30 sources mais opaque, Kalent = LinkedIn + PDL only.
- **Langage FR et ton** : c'est un avantage marché, pas tech, mais réel.
- **Extended thinking Claude Sonnet 4.6** avec 16k tokens de budget. La plupart des concurrents tournent sur GPT-4o mini ou Gemini Flash pour la latence. Skalr a une qualité de réponse supérieure sur l'agent.

---

## Benchmarks quantitatifs à viser

| Métrique | Concurrent leader | Skalr actuel (estimé) | Objectif |
|---|---|---|---|
| Profils accessibles | 900 M (Kalent LinkedIn) / 800 M (Juicebox, Gem) | ~500 M (Apollo + PDL + LinkedIn) | 900 M+ |
| Reply rate outreach | 40 % (Fetcher) / 30 %+ (Kalent) | inconnu (à instrumenter) | ≥30 % |
| Reduction sourcing time | 50 % (Kalent) / 5× productivité (Gem) | inconnu | -50 % |
| Integrations ATS | 41 (Juicebox) | 0 ATS pro | 5 (Greenhouse, Lever, Teamtailor, Workable, Recruitee) |
| Langues chat | 100+ (Paradox) | FR uniquement | 5 au minimum (FR, EN, ES, DE, IT) |
| Screening auto | 90 % (Paradox) | 0 % (manuel) | 50 % |
| Data points RAG | 1.6 T (Findem) | ~Md de chunks à moyen terme | 100 G+ |

---

## Positionnement stratégique recommandé

### Option A — "Le Juicebox français pour cabinets" (sweet spot)
- Accepter de ne pas battre Gem/Ashby en tant qu'ATS all-in-one.
- Viser explicitement : **cabinets de recrutement + agences freelance francophones**.
- Quick wins : Rediscovery du Vivier, Talent Insights (salaire/supply FR/UK/DE), Lookalike Discovery, agent autonome de nuit.
- Différentiation : RAG cross-mission, marketplace de freelances, client portal.

### Option B — "L'ATS IA-first européen" (ambition)
- Se poser en Gem européen.
- Push ATS (Greenhouse, Teamtailor prioritaire FR), scheduling natif, interview IA + scorecard auto.
- Demande 12-18 mois de dev supplémentaire.

### Option C — "La couche IA qui s'intègre partout"
- Renoncer à l'ATS, devenir un "Juicebox-like" qui se plug sur l'ATS existant du client.
- Plus rapide à déployer, moins de friction vente. Mais cannibalisé par Juicebox qui arrive en Europe.

**Recommandation** : Option A, avec briques A+B progressives. Le marché FR cabinet est mal couvert par Gem/Juicebox/Fetcher (US). Kalent est le vrai concurrent à battre.

---

## Roadmap "rattrapage concurrentiel" — 10 quick wins

1. **AI Rediscovery du Vivier** à chaque création de mission (1 sem, impact énorme).
2. **Lookalike Discovery** exposé en UI : "trouve 50 profils similaires à X" (1 sem, les embeddings existent déjà).
3. **Talent Insights** mission : salaire médian FR/UK, supply/demand par compétence, temps moyen to-hire observé (2 sem).
4. **Agent autonome de nuit** : re-run automatique de la mission, nouveaux matchs, digest matinal (2 sem, base `run-agent-search` prête).
5. **Email verification** intégrée via Hunter/NeverBounce avant l'envoi (3 jours).
6. **Interview transcription + scorecard auto** (Deepgram + Claude) — Metaview tier (3 sem, `live-coach` + `deepgram-temp-key` à brancher).
7. **Intégration Teamtailor** push candidat + scorecard (1 sem, ATS #1 FR).
8. **Scheduling natif** Google/Outlook OAuth + slot picker (2 sem).
9. **WhatsApp outreach** via Unipile (déjà supporté) + template SMS (1 sem).
10. **Reply rate analytics** par séquence, par template, par canal, par recruteur (1 sem).

Total : ~10 sprints (2,5 mois à 1 dev fulltime, 1 mois à 3 devs). Permet d'être au niveau des 3 concurrents directs (Juicebox, Kalent, Gem) sur les features vues en démo.

---

## Sources

- [Juicebox — PeopleGPT leading AI recruiting platform](https://juicebox.ai/)
- [Juicebox Agents — AI Recruiting Agents 24/7](https://juicebox.ai/agent)
- [Kalent — Your AI recruitment copilot](https://kalent.ai/)
- [Kalent Talent Search Engine](https://kalent.ai/features/talent-search-engine)
- [Gem — AI-first all-in-one recruiting platform](https://www.gem.com/)
- [Gem AI agents: Rediscovery + Talent Insights](https://www.gem.com/blog/updates-to-gems-ai-agents-ai-rediscovery-ai-talent-insights-and-more)
- [Fetcher — AI Recruiter](https://fetcher.ai/)
- [Hireflow — AI Sourcing and Recruiting Automation](https://www.hireflow.com/)
- [Leonar — LinkedIn sourcing platform](https://www.leonar.app/)
- [SeekOut — Agentic AI Recruiting Platform](https://www.seekout.com/)
- [Findem — People Intelligence + Talent Data Cloud](https://www.findem.ai/)
- [Paradox — Olivia conversational hiring](https://www.paradox.ai/)
- [Metaview — Interview transcription & notes](https://www.metaview.ai/)
- [Ashby — Modern ATS with AI](https://www.ashbyhq.com/)
- [Eightfold — Talent intelligence skills-first](https://eightfold.ai/)
- [HireVue — Video interviews & assessments](https://www.hirevue.com/)
- [Mercor — AI interviewer](https://www.mercor.com/)
- [Comparatif 2026 SeekOut vs Findem vs hireEZ](https://www.findem.ai/knowledge-center/hireez-vs-seekout-vs-findem)
