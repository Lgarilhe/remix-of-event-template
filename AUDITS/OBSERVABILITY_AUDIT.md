# OBSERVABILITY_AUDIT.md

## Audit Observabilité — Skalr

**Date :** 2026-04-16
**Branche :** `claude/app-audit-jHxht`

---

## 1. Error monitoring côté front

- **Sentry init** — `src/main.tsx:41` conditionnel sur `VITE_SENTRY_DSN`. `tracesSampleRate: 0.1`, `replaysOnErrorSampleRate: 0.5`, `replaysSessionSampleRate: 0`.
- **🔴 PII LEAK** — `src/main.tsx:46` : `maskAllText: false` dans Replay config. Les enregistrements session capturent nom candidat, email, numéros. Risque RGPD critique.
- **User context** — ❌ pas de `Sentry.setUser({ id, org_id, role })`. Impossible de corréler un incident à une org / un user.
- **Source maps** — ❌ `vite.config.ts` sans `build.sourcemap: true`. Stack traces Sentry illisibles en prod.
- **Release tracking** — ❌ aucun `release: APP_VERSION` passé à Sentry. Pas de regression tracking par déploiement.
- **`captureException`** — utilisé dans ~12 fichiers uniquement. `SectionErrorBoundary.tsx:25` n'envoie pas à Sentry (juste `console.error`) → erreurs par onglet mission invisibles.
- **Breadcrumbs** — défaut Sentry uniquement (console, fetch, navigation). Pas de breadcrumbs métier (mission ouverte, search lancée).
- **Erreurs ignorées** — pas de `ignoreErrors` configuré → AbortController, 401 attendus pollueraient le feed si envoyés.

---

## 2. Logging côté edge functions

- **217 `console.log`** dans 80 fichiers edge. Format libre, pas de niveau (`debug/info/warn/error`).
- **Pas de logger structuré** (JSON avec `timestamp, level, fn_name, request_id, user_id, org_id`).
- **`request_id` non propagé** — chaque fonction logge en silo. Impossible de reconstruire une trace front → edge → DB → Anthropic.
- **PII dans les logs** — quelques `console.log(candidate)` repérés (dumpe email + phone). À scanner + nettoyer.
- ✅ `drop: ["console"]` en prod front (`vite.config.ts`) → OK côté client.
- ❌ Edge functions n'ont pas d'équivalent — logs visibles dans Supabase dashboard avec PII.

---

## 3. Alerting

- ❌ **Aucun système d'alerting automatisé** détecté.
- Pas de seuil sur quotas (AI credits, Unipile rate limit, Apollo credits).
- Pas de seuil sur erreurs 5xx edge functions.
- Pas d'alerte bounces email > 5 %.
- Pas de canal Slack / PagerDuty / email d'astreinte.
- Conséquence : un incident (quota Anthropic épuisé, Unipile down) est découvert par le support via ticket user.

---

## 4. Dashboards & métriques

| Métrique | Tracké ? | Où ? |
|---|---|---|
| MAU, missions créées, messages envoyés | ❌ | Nulle part |
| p99 latency edge functions | 🟡 | Supabase dashboard (brut) |
| Error rate | 🟡 | Supabase dashboard |
| Cache hit rate (RAG, embedding) | ❌ | — |
| Crédits IA consommés / org | 🟡 | Table `ai_credit_transactions`, pas de dashboard |
| Coût Anthropic / jour | ❌ | — |

- Pas de Grafana / Metabase / Looker Studio custom.
- Supabase dashboard offre les basics mais pas de vue produit.

---

## 5. Tracing

- ❌ **Aucun distributed tracing** (OpenTelemetry, Datadog APM, Sentry Performance).
- `request_id` non propagé entre front → edge → Supabase RPC → Anthropic.
- Conséquence : debug d'une lenteur chat impossible (quelle étape a pris 8 s ?).

---

## 6. Health checks & uptime

- ❌ Pas d'endpoint `/health` ou `/status` côté edge.
- ❌ Pas de status page publique (statuspage.io, Better Stack).
- ❌ Pas d'uptime monitoring externe (UptimeRobot, Pingdom).
- Conséquence : downtime Unipile / Anthropic = users le signalent avant nous.

---

## 7. Analytics produit

- ❌ **Aucun PostHog / Amplitude / Mixpanel / Segment**.
- Pas d'events tracked : `signup`, `mission_created`, `search_launched`, `outreach_sent`, `candidate_shortlisted`, `offer_signed`.
- Pas de funnel onboarding → première mission → premier résultat.
- Pas de cohortes de rétention.
- Décisions produit à l'aveugle : impossible de savoir si un CTA convertit ou si un onglet est ignoré.

---

## 8. User session recording

- 🟡 **Sentry Replay** activé mais `replaysSessionSampleRate: 0` → uniquement sur erreur.
- 🔴 **Masking PII désactivé** (`maskAllText: false`) — enregistre texte sensible.
- Pas de FullStory / Hotjar.
- **Action urgente** : passer à `maskAllText: true` + `blockAllMedia: true` + opt-in explicite.

---

## 9. Cost monitoring

- ✅ `ai_credit_transactions` track le coût par appel (tokens + model).
- ❌ Pas de dashboard de coût IA par org / user / jour.
- ❌ Pas d'alerte "user X dépasse Y $ en 24 h" (détection abus / runaway loop).
- ❌ Pas de suivi coût Unipile / Apollo (facturé au profil enrichi).
- Risque : un bug de retry peut exploser la facture avant détection.

---

## Top 12 actions priorisées

| # | Action | Effort | Gain |
|---|--------|--------|------|
| 🔴 **1** | `maskAllText: true` + `blockAllMedia: true` dans Sentry Replay (`src/main.tsx:46`) | 5 min | RGPD critical |
| 🔴 **2** | `Sentry.setUser({ id, org_id, role })` post-login | 30 min | Corrélation incidents |
| 🔴 **3** | `build.sourcemap: true` + upload auto via `@sentry/vite-plugin` | 1 h | Stack traces lisibles |
| 🔴 **4** | `SectionErrorBoundary.tsx:25` : `Sentry.captureException(error)` | 15 min | Erreurs mission visibles |
| 🟠 **5** | Logger structuré JSON dans `_shared/logger.ts` + `request_id` propagé | 4 h | Debug 10× plus rapide |
| 🟠 **6** | Scanner + purger PII des `console.log` edge (grep candidate/email/phone) | 2 h | RGPD |
| 🟠 **7** | Intégrer PostHog (signup, mission_created, search, outreach_sent, hire) | 1 jour | Décisions produit data-driven |
| 🟠 **8** | Dashboard coût IA par org (vue Metabase ou page Settings interne) | 1 jour | Prévention runaway + facturation |
| 🟡 **9** | Alertes Slack : quotas Anthropic 80 %, error rate > 2 %, bounces > 5 % | 1 jour | Résolution incident -70 % |
| 🟡 **10** | Uptime monitoring (Better Stack gratuit) + status page publique | 2 h | Trust + détection auto |
| 🟡 **11** | Release tracking Sentry (`release: APP_VERSION` via CI) | 30 min | Regression tracking |
| 🟡 **12** | Distributed tracing Sentry Performance sur routes critiques (chat, search) | 2 jours | Root cause lenteurs |

---

## Fichiers clés

- `src/main.tsx:41-55` — init Sentry, config Replay
- `src/components/ErrorBoundary.tsx` — root boundary
- `src/components/SectionErrorBoundary.tsx:25` — ne log que console
- `supabase/functions/_shared/require-auth.ts` — bon endroit pour injecter logger
- `vite.config.ts` — ajouter `sourcemap: true` + plugin Sentry
- `supabase/functions/*/index.ts` — 78 fonctions à migrer vers logger structuré

---

## Conclusion

**État : 3 / 10.** Infra Sentry présente mais mal configurée (PII leak + pas de user context + pas de source maps). Zéro analytics produit, zéro alerting, zéro uptime monitoring, zéro tracing distribué. Les 4 actions P0 (maskAllText, setUser, source maps, captureException dans SectionErrorBoundary) = **2 h de travail** pour un gain énorme en sécurité + debuggabilité.
