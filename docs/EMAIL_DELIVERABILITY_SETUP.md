# Email deliverability — configuration DNS & Resend

> **Audience** : admin technique Konekt / Laurent
> **Dernière MAJ** : 2026-04-22
> **Provider** : [Resend](https://resend.com) (remplace Lovable AI depuis 2026-04-21)

---

## 1. Domaines utilisés

| Rôle | Valeur | Détails |
|------|--------|---------|
| `SITE_NAME` | `Konekt` | Display name dans `From` |
| `FROM_DOMAIN` | `konekt.fr` | Domaine de l'adresse `From` → `noreply@konekt.fr` |
| `SENDER_DOMAIN` | `notify.konekt.fr` | Subdomain isolé pour la réputation (Resend doc) |

**Overridables via env** (edge function `send-transactional-email`) :
- `EMAIL_SITE_NAME`
- `EMAIL_FROM_DOMAIN`
- `EMAIL_SENDER_DOMAIN`

---

## 2. DNS à configurer chez ton registrar (OVH / Gandi / Cloudflare)

Resend affiche la liste exacte dans le dashboard → **Domains → Add domain** → `konekt.fr` (ou `notify.konekt.fr`). Voici le **pattern type** à vérifier :

### SPF (TXT record à la racine)
```
Type : TXT
Nom  : @ (ou konekt.fr)
Valeur : v=spf1 include:amazonses.com include:_spf.resend.com ~all
TTL    : 3600
```

**⚠️ Attention** : si un autre outil envoie déjà depuis ce domaine (ex : Gmail, Outlook Office365), MERGE les inclusions dans **UN SEUL record SPF**. Jamais deux records SPF séparés (= SPF cassé).

Exemple combiné (Google Workspace + Resend) :
```
v=spf1 include:_spf.google.com include:_spf.resend.com ~all
```

### DKIM (3 CNAME fournis par Resend)
Resend génère 3 enregistrements CNAME uniques (clé rotable). Exemple :
```
Type : CNAME
Nom  : resend._domainkey.konekt.fr
Valeur : resend._domainkey.{unique-id}.resend.com
```
Copier les 3 depuis le dashboard Resend. Propagation : 5-30 min.

### DMARC (TXT record)
```
Type : TXT
Nom  : _dmarc
Valeur : v=DMARC1; p=quarantine; rua=mailto:dmarc@konekt.fr; ruf=mailto:dmarc@konekt.fr; adkim=s; aspf=s; pct=100
TTL    : 3600
```

**Progression recommandée** :
1. **Semaine 1-2** : `p=none` (monitoring uniquement, pas de rejet)
2. **Semaine 3-4** : `p=quarantine; pct=25` (25% des non-conformes en spam)
3. **Mois 2+** : `p=quarantine; pct=100` → puis `p=reject`

Le `rua=` reçoit les rapports agrégés. Si tu n'as pas de boîte `dmarc@`, utilise [dmarcian](https://dmarcian.com) (free tier) ou [Postmark DMARC Weekly](https://dmarc.postmarkapp.com/).

### MX (optionnel, uniquement si tu veux recevoir sur `notify.konekt.fr`)
Pas obligatoire pour l'envoi. Ne configure MX que si tu réceptionnes des bounces directement (Resend gère déjà via ses IPs).

---

## 3. Vérification post-configuration

### Outils online (gratuits)

| Outil | URL | Ce qu'il check |
|-------|-----|----------------|
| MXToolbox SuperTool | https://mxtoolbox.com/SuperTool.aspx | SPF, DKIM, DMARC en un coup |
| mail-tester.com | https://www.mail-tester.com | Score sur 10 + diag spam assassin |
| dmarcian | https://dmarcian.com/dmarc-inspector/ | Lecture agrégée DMARC |
| GlockApps | https://glockapps.com | Delivery test multi-inbox (payant à partir du 2e test) |

### Test manuel

1. **Envoie un email de test** via l'app Konekt (ex : invitation à un collègue).
2. **Gmail → Ouvre l'email** → clique sur les 3 points → **"Afficher l'original"**.
3. Vérifie la section **"Authentification de l'expéditeur"** :
   - ✅ `SPF : PASS with IP ...`
   - ✅ `DKIM : PASS with domain konekt.fr`
   - ✅ `DMARC : PASS`

Si un des trois dit `FAIL` ou `NEUTRAL` → DNS à réconcilier.

---

## 4. Warm-up nouveau domaine

Resend IPs sont partagées mais ta **réputation domaine** est neuve. Plan recommandé pour les 30 premiers jours :

| Jour | Volume max / jour | Notes |
|------|-------------------|-------|
| 1-3 | 50 | Internal only (équipe, tests) |
| 4-7 | 200 | Premiers clients activés |
| 8-14 | 1 000 | Rampe par paliers |
| 15-21 | 5 000 | Passer en routine |
| 22-30 | 10 000+ | Plafond Resend standard |

**Signal d'alerte** : si bounce rate > 5% → **pause** toutes séquences, fix la liste avant de reprendre.

---

## 5. Monitoring en continu

### Webhook Resend (déjà configuré)

Edge function : `handle-email-suppression`
Secret : `RESEND_WEBHOOK_SECRET` (format `whsec_...`, config via Dashboard → Webhooks)

Events traités :
- `email.bounced` → marque `suppressed_emails` avec reason `bounced`
- `email.complained` → marque `suppressed_emails` avec reason `complained`
- `email.delivered` → log dans `email_send_log`
- `email.opened` / `email.clicked` → tracking (séquences)

### Dashboard Resend

À vérifier hebdomadairement (https://resend.com/emails) :
- **Delivered rate** : cible > 98%
- **Bounce rate** : cible < 2% (hard bounces)
- **Complaint rate** : cible < 0.1% (0.3% = alerte Resend, 0.5% = suspension compte)
- **Unsubscribe rate** : pas de seuil Resend mais surveille > 0.5% (liste froide)

### Alertes à activer

Dans Resend dashboard → Settings → Notifications :
- [ ] Bounce rate > 5% sur 24h
- [ ] Complaint rate > 0.1% sur 24h
- [ ] API errors > 50 sur 1h

---

## 6. Gotchas courants

### "Mon email arrive en spam chez Gmail"
1. Vérifier `DMARC` en PASS (pas juste SPF). Gmail exige DMARC strict depuis février 2024.
2. Vérifier que le From address match le DKIM d'origine (pas de spoofing intra-domaine).
3. Contenu : éviter les mots comme "GRATUIT", "CLIQUEZ ICI", majuscules excessives, ratio texte/image (minimum 60% texte).

### "Le DKIM n'est pas reconnu"
- Propagation DNS peut prendre jusqu'à 48h (TTL). Généralement 5-15 min.
- Vérifier que le CNAME n'a pas été raccourci (certains registrars truncate).
- Resend affiche le statut en temps réel dans le dashboard.

### "SPF record trop long"
La limite DNS TXT est 10 lookups. Si tu utilises beaucoup d'outils (Google + Resend + un CRM...), tu peux hit la limite. Solution : [spf-record-flattener](https://github.com/flatform/spf-flatten).

### "Le link unsubscribe n'apparaît pas chez Gmail"
Gmail affiche le bouton "Se désabonner" uniquement si :
- Header `List-Unsubscribe` présent ✅ (on l'a)
- Header `List-Unsubscribe-Post: List-Unsubscribe=One-Click` ✅ (on l'a)
- Volume > 5000 emails / jour chez cet expéditeur (sinon Gmail masque le bouton)

---

## 7. Pour aller plus loin (roadmap B10+)

Voir `AUDITS/EMAIL_DELIVERABILITY_AUDIT.md` pour la liste complète des 12 améliorations. Priorité par ordre :

1. **Email validation avant enrollment** (ZeroBounce / NeverBounce) → réduit bounce rate
2. **Org-scoped suppression** (scope `suppressed_emails` par organization_id)
3. **Bounce rate auto-pause séquence** (si bounce % > 5% sur une séquence, pause auto)
4. **Legal footer CAN-SPAM/RGPD** (adresse physique + lien unsubscribe visible)
5. **Consent timestamp RGPD** (`consent_date`, `consent_source` à l'enrollment)

---

## 8. Checklist setup initial

À cocher quand Laurent configure :

- [ ] SPF record TXT configuré à la racine (merge avec Google Workspace si applicable)
- [ ] 3 CNAME DKIM Resend configurés
- [ ] DMARC record TXT configuré (`p=none` pour commencer, upgrade progressif)
- [ ] Domaine vérifié dans Resend dashboard (pastille verte)
- [ ] Test d'envoi + "Afficher l'original" dans Gmail : SPF/DKIM/DMARC en PASS
- [ ] Score > 8/10 sur mail-tester.com
- [ ] Webhook Resend → `handle-email-suppression` configuré avec `RESEND_WEBHOOK_SECRET`
- [ ] Monitoring Resend dashboard en favori, check hebdo

---

**Contact Resend support** : https://resend.com/contact (réponse < 24h, très réactif).
