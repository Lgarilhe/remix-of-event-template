# AUDIT DÉLIVRABILITÉ EMAIL — PROJET SKALR

**Date** : 16 avril 2026  
**Scope** : SaaS recrutement avec séquences d'outreach (email + LinkedIn)  
**Codebase** : `/home/user/remix-of-event-template`

---

## 1. INFRASTRUCTURE D'ENVOI

### ESP & Configuration
- **ESP Principal** : **Lovable Cloud (`@lovable.dev/email-js`)**
- **Méthode Fallback** : **Unipile API** (intégration emails + LinkedIn) + **Microsoft Graph API**
- **Domaine Sender** : `notify.konekt.fr` (transactionnel)
- **From Domain** : `konekt.fr` (domaine public)
- **Provider Lovable** : `sendLovableEmail` (process-email-queue l.1) via LOVABLE_API_KEY
- **Unipile** : Connexions comptes (Gmail, Outlook, IMAP) — utilisé pour séquences outreach (sequence-send-email)

### SPF / DKIM / DMARC
- **STATUT** : ⚠️ **NON DOCUMENTÉ** dans le codebase
- **Domaine `notify.konekt.fr`** : Nécessite SPF/DKIM pour Lovable (résolution manuelle requise)
- **Domaine `konekt.fr`** : From address utilise ce domaine — doit avoir SPF/DKIM configuré chez registrar
- **DMARC** : Aucune trace de configuration → risque de spoofing
- **Risque** : Sans SPF/DKIM aligné, Gmail/Outlook vont marquer comme spam, phishing

### IP Dédiée vs Partagée
- **Infrastructure Lovable** : IPs partagées (cloud service)
- **Unipile** : IPs déléguées (comptes connectés personnels)
- **Risque Modéré** : La réputation collective des IPs Lovable impacte la délivrabilité

---

## 2. HYGIÈNE DE LISTE & CONSENTEMENT

### Sources d'Adresses
- ✅ **Validation Explicite** : Enroll via Apollo, PDL, LinkedIn (données tiers)
- ⚠️ **Sourcing Non Cleared** : Pas de vérification si données proviennent de spam trap, honeypot
- **Apollo/PDL Risk** : Ces providers ont des antécédents de qualité liste médiocre (5-15% invalid)

### Validation Avant Envoi
- ❌ **Pas de vérification email** : Pas d'intégration NeverBounce, ZeroBounce, Hunter Verify API
- ❌ **Pas de regex validation** : Les adresses enroulent directement en DB sans contrôle format
- **Risque CRITIQUE** : Bounce rate élevé (>5%) = reputation damage, blacklist

### Déduplication
- ✅ Unicité sur `suppressed_emails.email` (UNIQUE INDEX)
- ✅ Unicité sur `email_unsubscribe_tokens.email` (UNIQUE INDEX)
- ✅ Suppression globale avant envoi (send-transactional-email l.147-152)

### Opt-in Explicite
- ❌ **Pas d'enregistrement explicite d'opt-in** dans les tables
- ❌ **Pas de timestamps consent** pour trace légale (RGPD art.7)
- **Risque Légal** : CAN-SPAM US, RGPD EU exigent preuve consentement

---

## 3. BOUNCE & COMPLAINT HANDLING

### Handle-Email-Suppression
**Fonction** : `supabase/functions/handle-email-suppression/index.ts`
- ✅ **Webhook Lovable** : Réceptionne bounce, complaint, unsubscribe en POST
- ✅ **Signature HMAC** : Vérification avec LOVABLE_API_KEY (sécurisé)
- ✅ **Upsert Idempotent** : Déjà supprimé? Pas de doublon (l.89-95)
- ✅ **Audit Log** : Enregistre dans `email_send_log` (l.109-118)
- **Mapping Raisons** : bounce → 'bounced', complaint → 'complained', unsubscribe → 'suppressed'

### Webhook Bounces Configuration
- ✅ **GO API Backend** : Lovable → Go API → Edge Function (via webhook signature)
- ✅ **Suppression Table** : Centralisée dans `suppressed_emails` (global par org?)
- ⚠️ **Scope** : Suppression est-elle **par organization** ou **globale**? (migration ne spécifie pas d'org_id)
- **Risque** : Si globale → un bounce dans Org A bloque Org B (faux positif)

### Feedback Loops (FBL)
- ❌ **Pas de FBL** configurés côté Lovable (complaint-only passif)
- **Improvable** : Lovable devrait supporter FBL pour Gmail, Yahoo, Hotmail

### Seuils Auto-Pause
- ❌ **Pas de seuil configurable** (5% bounce) visible dans le code
- ❌ **Pas de pause auto-séquence** si bounce élevé
- **Risque** : Séquence peut envoyer 100 emails à adresses invalides avant stop manual

---

## 4. UNSUBSCRIBE & COMPLIANCE

### Handle-Email-Unsubscribe
**Fonction** : `supabase/functions/handle-email-unsubscribe/index.ts`
- ✅ **Endpoint Public** : GET (validation token) + POST (unsubscribe)
- ✅ **RFC 8058** : Support one-click unsubscribe (List-Unsubscribe POST)
- ✅ **Token Upsert Safe** : Crée si existe pas, réutilise sinon
- ✅ **Atomic Check-and-Update** : Évite race conditions (l.94-99)
- ✅ **Suppression Table** : Marque email comme supprimé + raison 'unsubscribe'

### Lien Unsubscribe dans Emails
- ✅ **Séquences Email** : `include_unsubscribe` flag dans `sequence_steps` (l.464-467)
- ✅ **Transactionnel** : Généré via token (send-transactional-email l.190-192)
- ❌ **Templates Invitation** : Aucun lien unsubscribe (team-invitation.tsx, mission-invitation.tsx)
- **Risque** : Les emails transactionnels doivent avoir unsubscribe pour compliance

### Mentions Légales
- ❌ **Pas de footer légal** : Pas de mention CAN-SPAM (nom + adresse physique)
- ❌ **Pas de mention RGPD** : Pas de "vous recevez car..." ou lien politique confidentialité
- ❌ **Pas de lien imprint** : Pas de mentions légales en HTML
- **Risque CRITIQUE (Légal)** :
  - **CAN-SPAM US** : Exige nom identifiable + adresse physique valide
  - **RGPD EU** (art.21) : Opt-out facile + données perso déclarées
  - **Loi française** : Art. L34-5 (droit d'opposition), art. 13 (infos légales)

### Expéditeur Identifiable
- ⚠️ **Partiel** : Nom du sender vient de `sender_id` profile (first_name + last_name)
- ❌ **Pas d'adresse physique** : Aucune adresse en signature ou footer
- **Risque** : CAN-SPAM mandate nom + adresse → non-compliant

---

## 5. THROTTLING & WARM-UP

### Limites d'Envoi
- ✅ **Batch Size** : Configurable via `email_send_state.batch_size` (défaut 10)
- ✅ **Send Delay** : Configurable `send_delay_ms` (défaut 200ms entre emails)
- ✅ **Rate Limit Handling** : Détecte 429 → reschedule en 1 heure (sequence-send-email l.554-564)
- ⚠️ **Limit Par Domaine** : Lovable fixe à ???, non documenté
- ⚠️ **Limit Par Org** : Pas de limite d'envoi par organization visible

### Warm-up Progressif
- ❌ **Pas de warm-up** pour nouveaux domaines/IPs
- ❌ **Pas de ramp-up progressif** visible
- **Risque** : Envoyer 10k emails jour 1 → spam folder immédiat

### Process-Email-Queue
- ✅ **Batch Processing** : Lit batch (défaut 10), envoie séquentiellement avec délai
- ✅ **Retry Logic** : Jusqu'à 5 tentatives (MAX_RETRIES l.4), puis DLQ
- ✅ **Cooldown Rate-Limit** : Si 429, attend `Retry-After` (l.124-129)
- ✅ **DLQ** : Messages non-envoyables → `*_dlq` (dead-letter)

---

## 6. TRACKING

### Pixel Tracking (Ouvertures)
- ✅ **Implémenté** : 1x1 transparent GIF injecté (sequence-email-track l.12-20)
- ✅ **Discret** : Style `display:none; width:1px; height:1px`
- ✅ **Tracking ID** : UUID aléatoire (sequence-send-email l.40)
- **Considération** : Outlook/Gmail bloque images par défaut → opens invalides

### Redirect Links (Clics)
- ✅ **Implémenté** : Links réécrites vers `sequence-email-track?tid=X&url=Y`
- ⚠️ **Domaine** : Utilise Supabase URL directement (functions/v1/...)
- **Risque Modéré** : Si domaine fonction change → tous les liens broken

### Over-Tracking
- ⚠️ **Status Priority** : Ne downgrade jamais (l.23-31) → pas de spam penalty
- ⚠️ **Limite Events** : MAX_EVENTS_PER_TRACKING = 100 (l.33)
- **Bon** : N'enregistre pas chaque pixel refresh (smart dedup)

---

## 7. TEMPLATES & CONTENU

### HTML vs Plain Text
- ✅ **Both** : send-transactional-email génère HTML + plain text (l.320-326)
- ✅ **React Email** : Utilise @react-email/components (rendu + plainText mode)
- **Bon** : Fallback plain text = meilleur deliverability

### Image-Only Emails
- ✅ **Pas d'image-only** : Templates utilisent texte + boutons (bien)
- ✅ **Images Inline** : Pas trouvé de base64/CID, probablement CDN

### Mots-Clés Spammy
- ❌ **Pas de scan** : Pas de vérification contenu avant envoi
- ⚠️ **Risk** : "Free", "Act now", "Limited offer" → spam score
- **À faire** : Ajouter spam word checker (e.g., spam-scanner npm)

### Personnalisation
- ✅ **Variables** : `{{first_name}}`, `{{last_name}}`, `{{company}}`, etc. (l.31-36)
- ✅ **AI Snippet** : Génère contexte personnalisé via Claude Anthropic (l.78-186)
- ❌ **Pas de spintax** (X|Y) → OK, pas de red flag
- **Bon** : Personnalisation légitime, pas de mass-mail obviousness

---

## 8. TOP 12 PROBLÈMES & REMÉDIATION

| # | Problème | Risque | Remédiation |
|---|----------|--------|------------|
| 1 | **SPF/DKIM/DMARC non configurés** | Blacklist, spam folder | Configurer SPF/DKIM `konekt.fr` + `notify.konekt.fr` chez registrar; ajouter DMARC `p=quarantine` |
| 2 | **Pas de vérification email avant envoi** | 5-15% bounce → réputation damage | Intégrer ZeroBounce / NeverBounce API avant enroll |
| 3 | **Suppression globale non scopée par org** | Org B impact si Org A bounce | Ajouter `organization_id` à `suppressed_emails` + scope RLS |
| 4 | **Pas d'opt-in timestamp enregistré** | Illégal RGPD/CAN-SPAM | Ajouter `consent_date`, `consent_source` à enrollment |
| 5 | **Pas de footer légal (adresse)** | CAN-SPAM violation | Ajouter adresse physique sender + lien unsubscribe footer |
| 6 | **Unsubscribe manquant dans templates transactionnels** | Illegal CAN-SPAM | Ajouter unsubscribe link à team-invitation, mission-invitation |
| 7 | **Pas de seuil bounce auto-pause** | Séquence envoie à 100 invalides | Implémenter logic: si bounce% > 5%, pause + alerte owner |
| 8 | **Pas de warm-up progressif** | Nouveau domaine → spam jour 1 | Implémenter ramp-up: jour 1 (100), jour 2 (500), +50% par jour |
| 9 | **Pas de FBL (Feedback Loop)** | Complaint rate invisible | Configurer FBL Gmail, Yahoo, Hotmail via Lovable |
| 10 | **Pas de spam word scanner** | Contenu flaggé automatiquement | Ajouter scan avant enqueue (e.g., [spam-score](https://npm.org/package/spam-score)) |
| 11 | **Tracking link domain non stable** | Si Supabase URL change → liens broken | Créer custom domain pour tracking ou utiliser subdomain stable |
| 12 | **Rate limit cooldown non visible** | User ignore limite → frustrated | Dashboard: afficher `retry_after_until` + messages queued |

---

## 9. RECOMMANDATIONS IMMÉDIATES

### Critiques (30j)
1. **Configurer SPF/DKIM/DMARC** : Contactez registrar domaine, ajouter records
2. **Ajouter email validation** : Intégrer ZeroBounce API avant enroll (coût: ~$0.001/email)
3. **Scope suppression par org** : Migration: ajouter `organization_id` à `suppressed_emails`
4. **Ajouter footer légal** : HTML footer avec adresse + RGPD mention + lien unsubscribe

### Importants (90j)
5. Implémenter bounce-rate auto-pause (> 5% → pause + email owner)
6. Ajouter consent timestamp (RGPD proof)
7. Configurer FBL avec Lovable
8. Spam word scanner avant enqueue

### Nice-to-Have (6 mois)
9. Warm-up progressif pour nouveaux domaines
10. Dashboard rate-limit visibility
11. Custom tracking domain
12. Multi-language compliance (FR legal footer distinct)

---

## 10. NOTES FINALES

**État Général** : ⚠️ **MOYEN** — Infrastructure basique OK (queues, suppression, tracking), mais **compliance légale faible** et **hygiène liste risquée**.

**Blocage Production** :
- ❌ SPF/DKIM non configuré → inbox zero ou spam folder
- ❌ Pas de CAN-SPAM footer → risque légal (FTC fine)
- ❌ Pas de validation email → bounce explosion

**Prochaines Étapes**  
1. SPF/DKIM chez registrar (3 jours)
2. Email validation ZeroBounce (5 jours)
3. Legal footer + unsubscribe (3 jours)
4. Org-scoped suppression (7 jours)

**Baseline Deliverability** (post-fixes) : **75-85% inbox** (si réputation domaine clean).

