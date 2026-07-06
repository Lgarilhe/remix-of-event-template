# ADR 0001 — Auth des appels internes edge→edge : service role key + tenant résolu côté appelé

**Date** : 2026-07-06
**Statut** : Accepté
**Contexte de déclenchement** : finding C4 de l'audit messagerie (`docs/audit-messagerie-2026-07-06.md`) — pipeline `unipile-webhook → auto-analyze-message → {fetch-notion-jobs, analyze-response}` mort en prod (anon key → 401 silencieux).

## Contexte

- Toutes les edge functions ont `verify_jwt = false` (JWT ES256 non supporté par la gateway) : l'auth est gérée **dans le code** de chaque fonction, via `_shared/require-auth.ts` qui accepte (1) la service role key (`SB_SECRET_KEY ?? SUPABASE_SERVICE_ROLE_KEY`) en passthrough, (2) un JWT user validé par `auth.getUser(token)`.
- L'**anon key n'est ni l'un ni l'autre** : un appel interne avec `Bearer ${SUPABASE_ANON_KEY}` passe la gateway mais échoue à 401 dans la fonction appelée. Trois appels internes utilisaient ce pattern (C4). Le piège était connu (commentaire dans `generate-reply-suggestions/index.ts:22-27`) mais jamais érigé en règle.
- Les appels fire-and-forget (`.catch()` sans surfaçage) rendent l'échec invisible pendant des semaines.
- Passer en service role fait **bypasser RLS** dans la fonction appelée : sans règle de scoping, corriger le 401 élargirait la surface IDOR (finding C2 adjacent).

## Décision

Pour tout appel interne edge→edge (`fetch` vers `${SUPABASE_URL}/functions/v1/<fn>`) :

1. **Authorization** : `Bearer ${Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`. Jamais l'anon key. Jamais de secret ad hoc par fonction (cf. bug E7 sur `process-inmail-queue`).
2. **Le body porte toujours `organization_id`** — le scope tenant est explicite, il sert au settle des crédits et à la résolution de credentials per-org.
3. **La fonction appelée ne fait pas confiance au body pour ses écritures.** En mode service_role, elle résout le tenant côté serveur à partir d'un ancrage vérifiable en base (ex. `member_linkedin_accounts.linkedin_account_id = account_id` → `organization_id`, `user_id`), rejette en 403 si le `organization_id` du body ne correspond pas, et **borne toutes ses lectures/écritures service-role à ce tenant résolu**. Les IDs libres du body (`sender_id`, `candidate_id`…) ne sont jamais interpolés dans des filtres PostgREST `.or()`/`.like()` (utiliser `.eq()`/`.in()`).
4. **Settle des crédits** : toujours un `user_id` **uuid Konekt valide** (`ai_credit_transactions.user_id` est `uuid NOT NULL`). En mode service_role, c'est le propriétaire de la ressource (ex. owner du compte LinkedIn), jamais un ID vendor (LinkedIn provider id) ni `'system'`.
5. **Fire-and-forget** : borné par `fetchWithTimeout` et enregistré via `(globalThis as any).EdgeRuntime?.waitUntil?.(promise)` (précédent : `search-agent-chat/index.ts:1257`) pour survivre au recyclage de l'isolate après la réponse.

## Conséquences

- Le pipeline webhook → analyse fonctionne, et le contrat de scoping est le même pour tous les futurs appels internes.
- La responsabilité d'isolation multi-tenant se déplace de RLS vers le code des fonctions acceptant service_role : chaque fonction qui ajoute un chemin service_role doit documenter son ancrage de résolution tenant.
- Enforcement recommandé (à ajouter au process QA, pas seulement en doc) : grep bloquant avant merge sur `supabase/functions/**` pour `Bearer \$\{(supabaseAnonKey|SUPABASE_ANON_KEY)` — toute occurrence dans un appel `functions/v1` est un bug.

## Alternatives écartées

- **JWT machine dédié (service account signé)** : sur-conception pour un monolithe à 1 backend et une petite équipe ; la service role key est déjà le mécanisme supporté par `require-auth.ts`.
- **`verify_jwt = true` à la gateway** : cassé avec ES256 (`UNAUTHORIZED_UNSUPPORTED_TOKEN_ALGORITHM`), déjà écarté projet-wide (cf. `supabase/config.toml` en-tête).
- **Secret partagé par fonction (type `PROCESS_SEQUENCES_SECRET`)** : multiplication de secrets et de chemins d'auth divergents — c'est exactement la cause du cron InMail cassé (E7). Réservé aux appels cron externes, pas aux appels edge→edge.
- **Faire confiance au `organization_id` du body en mode service_role sans contre-vérification** : écarté — un seul appelant compromis ou bugué suffirait à écrire cross-tenant sous service role.
