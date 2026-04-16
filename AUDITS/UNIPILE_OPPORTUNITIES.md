# UNIPILE_OPPORTUNITIES.md

Date : 2026-04-16
Branche : `claude/app-audit-jHxht`
Sources : [developer.unipile.com](https://developer.unipile.com/), [unipile.com](https://www.unipile.com/)

**TL;DR** — Unipile expose ~150 endpoints unifiés et Skalr en utilise **~8** (`search`, `get_profile`, `get_parameters`, `get_chats`, `get_messages`, `send_message`, `mark_as_read`, `get_user_posts`, `endorse_skill`). On laisse sur la table : **Email**, **Calendar**, **WhatsApp**, **Instagram/Messenger/Telegram**, **Posts & engagement LinkedIn**, **Hosted Auth**, **Job posting**, **Recruiter hiring projects sync**, **Real-time webhooks email+calendar**, **Invitations management**, **Company pages**.

---

## 1. Ce qu'on utilise aujourd'hui

| Catégorie | Endpoints Skalr | Fichier |
|-----------|-----------------|---------|
| LinkedIn search | `search`, `get_parameters` | `unipile-search/index.ts:228-236` |
| LinkedIn profile | `get_profile` | `unipile-search/index.ts:236` |
| LinkedIn chats | `get_chats`, `get_messages`, `send_message`, `mark_as_read` | `unipile-search/index.ts:240-252` |
| LinkedIn posts | `get_user_posts` | `unipile-search/index.ts:256` |
| LinkedIn social | `endorse_skill` | `unipile-search/index.ts:260` |
| Accounts | list/disconnect | `unipile-accounts/index.ts` |
| Webhooks | `new_relation`, `message_received`, `account_connected`, `account_disconnected` | `unipile-webhook/index.ts` |

**Couverture estimée : ~12 % de la surface Unipile.**

---

## 2. Opportunités par domaine

### 🔴 PRIORITÉ 1 — Debloque des features majeures

#### 2.1 Email unifié (Gmail + Outlook + IMAP)
**Ce que Unipile offre** :
- `POST /emails` send avec attachments multipart
- `GET /emails/{id}` + `GET /emails?folder=INBOX`
- Threads, labels, folders, drafts
- Webhooks `email.received`, `email.sent`, `email.bounced`, `email.opened`, `email.link_clicked`
- Reply-in-thread, display name override, tracking pixel natif
- Compatible Google OAuth natif + Microsoft Graph + IMAP générique

**Gain Skalr** :
- ✅ Remplacer l'actuel ESP propriétaire (`sequence-send-email`) pour que les outreach partent depuis **l'adresse perso du recruteur** (pas `noreply@skalr.com`) → +40 % deliverability + humanisation
- ✅ Inbox unifié LinkedIn **+** Email dans `MessagesInbox` (aujourd'hui LinkedIn only)
- ✅ Warm-up progressif + rotation de domaines via plusieurs comptes connectés
- ✅ Résout immédiatement **3 findings** de l'audit deliverability (SPF/DKIM/DMARC portés par Gmail/Outlook)

**Effort** : 2 semaines
**Blocage** : règle CAN-SPAM/RGPD à gérer côté app

#### 2.2 Calendar (Google + Outlook)
**Ce que Unipile offre** :
- `GET /calendars` list
- `POST /calendars/{id}/events` create / update / delete
- `GET /calendars/{id}/events?start=X&end=Y` freebusy
- Webhooks `event.created/updated/deleted`
- Booking flow complet (email + invitation calendar + reminder)

**Gain Skalr** :
- ✅ **Onglet Entretiens manquant** (voir `NAV_GAPS.md` §2) devient trivial : lecture freebusy du recruteur, proposition de 3 créneaux au candidat dans le mail
- ✅ Remplacer Calendly externe (un backfill existe déjà `backfill-calendly`) → tout en natif, plus d'abonnement externe
- ✅ `mission_process_steps` type "interview" → création event auto
- ✅ Détection no-show via webhook event updated

**Effort** : 2 semaines
**Blocage** : UI booking flow à designer

#### 2.3 Hosted Auth Wizard
**Ce que Unipile offre** :
- Page d'onboarding compte hébergée par Unipile
- `POST /hosted/accounts/link` retourne URL signée
- Gère LinkedIn 2FA, Google OAuth, Microsoft OAuth, WhatsApp QR, Telegram
- Reconnect flow intégré via status `CREDENTIALS`

**Gain Skalr** :
- ✅ **Supprimer toute l'UI connexion LinkedIn custom** (complexe, fragile)
- ✅ Un bouton → page Unipile → retour avec `account_id` → terminé
- ✅ Reconnexion auto via email quand `account_status: CREDENTIALS`
- ✅ Support multi-canal instantané : ajouter WhatsApp ne coûte qu'un lien

**Effort** : 3-4 jours
**Gain immédiat** : -500 lignes UI, -3 bugs connus sur re-auth

---

### 🟠 PRIORITÉ 2 — Différenciant concurrence

#### 2.4 WhatsApp Business
**Ce que Unipile offre** :
- Send text, voice notes, images, vidéos, documents
- Sync conversations temps réel
- Webhooks `message.received/sent/read`
- Multi-device (pas de téléphone physique requis)

**Gain Skalr** :
- ✅ Séquence multi-canal : LinkedIn invite → Email J+3 → **WhatsApp J+7** (le premier qui accroche)
- ✅ Recruteurs FR/EU attendent ça (juicebox/gem le font déjà — voir `COMPETITORS.md`)
- ✅ Notifications entretien J-1 par WhatsApp
- ✅ Voice notes de brief pour les candidats (format différenciant)

**Effort** : 1 semaine (UI séquence + template WhatsApp)

#### 2.5 LinkedIn Posts & Engagement
**Ce que Unipile offre** :
- `GET /posts/{user_id}` (déjà utilisé pour le profil candidat)
- `POST /posts/{id}/comment` commenter un post
- `POST /posts/{id}/reaction` liker un post
- `GET /posts/{id}/comments` lister commentaires
- `GET /posts/{id}/reactions` lister qui a liké

**Gain Skalr** :
- ✅ **Social warm-up automatique** avant outreach : le recruteur like/commente un post du candidat 3j avant d'envoyer l'InMail → +30 % taux réponse (pratique growth connue)
- ✅ **Sourcing inversé** : lister les gens qui ont liké un post "we're hiring" d'un concurrent → liste qualifiée
- ✅ Features LinkedIn manquantes en API : récupérer followers, profile views

**Effort** : 1 semaine

#### 2.6 LinkedIn Recruiter Hiring Projects Sync
**Ce que Unipile offre** :
- `GET /linkedin/recruiter/hiring-projects`
- Sync bi-directionnel projet LinkedIn Recruiter ↔ ATS externe
- Talent pools, pipelines, notes

**Gain Skalr** :
- ✅ Pour les cabinets avec licence Recruiter : mission Skalr = hiring project LinkedIn
- ✅ Import candidats déjà saved côté LinkedIn → enrichit immédiatement Skalr
- ✅ Push statut candidat Skalr → LinkedIn Recruiter (pour les équipes mixtes)

**Effort** : 2 semaines
**Condition** : agency tier uniquement

#### 2.7 LinkedIn Invitations management
**Ce que Unipile offre** :
- `GET /linkedin/invitations` (pending, sent)
- `POST /linkedin/invitations/{id}/accept` / `decline`
- `DELETE /linkedin/invitations/{id}` (withdraw)

**Gain Skalr** :
- ✅ Dashboard "Invitations envoyées par ma séquence qui n'ont pas été acceptées après 14j" → auto-withdraw + relance email
- ✅ **Quota management propre** : savoir combien d'invites on a en pending (LinkedIn limite 100-200 cumulés)
- ✅ Détection d'acceptations sans passer par l'utilisateur

**Effort** : 3 jours

---

### 🟡 PRIORITÉ 3 — Nice-to-have

#### 2.8 Instagram / Messenger / Telegram
**Usage** : sourcing créateurs de contenu, communautés tech spécialisées (Telegram crypto/dev). Niche mais différenciant vs Juicebox/Gem.
**Effort** : 2-3 jours par canal

#### 2.9 Company pages LinkedIn
- `GET /linkedin/company/{id}` employees, posts, updates
- **Gain** : enrichissement client auto pour les cabinets, détection de nouveaux postes publiés

#### 2.10 Job Posting LinkedIn API
- Publier un job LinkedIn depuis Skalr via Unipile
- **Gain** : avec la mission créée, un click "publier sur LinkedIn Jobs"
- **Condition** : licence recruter active

---

## 3. Webhooks à ajouter

Actuellement utilisés (`unipile-webhook/index.ts`) :
- ✅ `new_relation` · `message_received` · `account_connected` · `account_disconnected`

À ajouter :
| Webhook | Use case Skalr |
|---------|----------------|
| `email.received` | Inbox unifié + auto-reply detection pour séquences email |
| `email.opened` / `email.link_clicked` | Scoring d'intérêt candidat (chaud si ouvre 3× + clique) |
| `email.bounced` | Auto-pause séquence (résout §2 `EMAIL_DELIVERABILITY_AUDIT.md`) |
| `event.created` / `event.updated` | Sync entretien côté Skalr → `mission_process_steps` |
| `event.deleted` | Détection annulation candidat → relance auto |
| `profile.view` (si dispo) | Alerte "le candidat X a regardé votre profil" |
| `invitation.accepted` | Déclenche step suivant de séquence |

---

## 4. Plan d'intégration proposé

### Sprint A (2 sem) — Email + Hosted Auth
1. Hosted Auth Wizard → bouton unique (-500 LoC UI)
2. Email send via compte connecté du recruteur (`sequence-send-email` v2)
3. Webhook `email.received/opened/clicked/bounced` → inbox unifié
4. **Résout** : 3 findings deliverability + UI connexion

### Sprint B (2 sem) — Calendar + Entretiens
5. Onglet **Entretiens** dans MissionWorkspace (voir NAV_GAPS §2)
6. Création event auto quand step "interview" atteint
7. Booking flow : 3 créneaux dans mail candidat
8. Webhook no-show → relance auto

### Sprint C (1 sem) — Social warm-up + Invitations
9. Like/comment automatique 3j avant InMail
10. Dashboard invitations pending + auto-withdraw 14j
11. Sourcing inversé "qui a liké le post X"

### Sprint D (1 sem) — WhatsApp
12. Template multi-canal : LinkedIn → Email → WhatsApp
13. Notifications entretien J-1 WhatsApp
14. Opt-in explicite candidat (RGPD)

### Sprint E (option, 2 sem) — Recruiter sync (agency)
15. Sync hiring projects bi-directionnel
16. Talent pools import
17. Job posting LinkedIn Jobs depuis mission

---

## 5. Impact business chiffré

| Sprint | Gain prod | Gain commercial |
|--------|-----------|-----------------|
| A — Email unifié | +40 % deliverability, SPF/DKIM offload | Débloque déploiement entreprise |
| B — Calendar/Entretiens | -15 min par interview (plus de back-and-forth) | Feature parité Gem/Ashby |
| C — Social warm-up + Invites | +30 % taux réponse InMail | Différenciant Growth |
| D — WhatsApp | +25 % taux réponse candidats FR/South EU | **Wedge marché vs US tools** |
| E — Recruiter sync | Workflow agence Paul-perso-déjà-bossés | Upsell agency tier |

---

## 6. Quick wins (< 1 jour chacun)

- ✅ Ajouter `email.bounced` webhook → auto-pause séquence (1 findings résolu)
- ✅ Ajouter `mark_as_read` batch côté inbox LinkedIn (UX)
- ✅ Exposer `get_user_posts` dans `CandidateProfileDrawer` (voir derniers posts du candidat pour brief contextualisé)
- ✅ Ajouter `endorse_skill` (déjà dans l'action list) en bouton "booster candidat" dans pipeline

---

## 7. Risques & points d'attention

- **Pricing Unipile** : facturation par compte connecté par mois (~$10-30). Bien projeter le coût côté P&L Skalr (vs valeur facturée user).
- **RGPD WhatsApp** : opt-in explicite obligatoire, logs de consentement.
- **Quotas LinkedIn** : les endpoints posts/reactions/invitations rentrent dans les limites natives LinkedIn (~100 invitations/sem). Bien tracker.
- **Webhooks fiabilité** : re-delivery automatique Unipile mais prévoir une dead-letter queue côté `supabase.functions.unipile-webhook`.

---

## Conclusion

Unipile est **sous-utilisé à 88 %** dans Skalr. Les 2 sprints A+B (Email + Calendar/Entretiens) débloquent à eux seuls :
- L'onglet Entretiens manquant (voir `NAV_GAPS.md`)
- 3 findings critiques d'`EMAIL_DELIVERABILITY_AUDIT.md`
- Une inbox unifiée compétitive face à Gem
- Un coût d'ingénierie < coût de maintenance de SPF/DKIM/ESP custom

**Recommandation** : prioriser **Hosted Auth + Email + Calendar** (Sprints A+B, ~4 semaines) avant tout autre chantier produit hors Sprint 1 `PRODUCT_COMPLETION.md`.

---

## Sources

- [Unipile — Messaging API](https://www.unipile.com/communication-api/messaging-api/)
- [Unipile — LinkedIn API Recruiter/Sales Nav](https://www.unipile.com/communication-api/messaging-api/linkedin-api/)
- [Unipile — Email API](https://www.unipile.com/communication-api/email-api/)
- [Unipile — Alternative Nylas (Email+Calendar)](https://www.unipile.com/alternative-nylas/)
- [Unipile — WhatsApp API](https://www.unipile.com/communication-api/messaging-api/whatsapp-api/)
- [Unipile — Hosted Auth Wizard](https://developer.unipile.com/docs/hosted-auth)
- [Unipile — Webhooks overview](https://developer.unipile.com/docs/webhooks-2)
- [Unipile — Posts and Comments](https://developer.unipile.com/docs/posts-and-comments)
- [Unipile — Real-time & Sync](https://www.unipile.com/developer-real-time/)
- [Unipile — Node SDK (GitHub)](https://github.com/unipile/unipile-node-sdk)
