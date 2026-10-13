-- Déconnexion voulue d'un compte WhatsApp (suite de 20261007222159_member_whatsapp_accounts).
--
-- « Déconnecter » (unipile-accounts, disconnect_whatsapp) supprime le compte chez le prestataire puis garde la
-- liaison en DELETED : une pierre tombale, que la lecture des messages WhatsApp du membre (policy
-- candidate_action_messages_whatsapp_owner_read) et le refus de reprendre un ancien identifiant (claimWhatsApp)
-- lisent encore. Le webhook account.remove et la lecture « list_whatsapp » posent le même DELETED pour un compte
-- qui a disparu chez le prestataire sans que le membre l'ait voulu. L'écran doit pouvoir les distinguer : la
-- première se masque, la seconde reste « À reconnecter ».
--
-- `removed_by_member_at` est posée par « Déconnecter » seulement. list_whatsapp rend `removed_by_member` (vrai
-- quand la ligne est en DELETED et que cette date existe). Colonne nullable, aucun droit nouveau : la table garde
-- son SELECT par le membre (policy self_read) et son écriture par la clé de service. Aucune fonction.
--
-- Reprise : jusqu'ici l'écran masquait toute ligne DELETED. Les lignes déjà en DELETED prennent leur date de mise
-- à jour comme date de retrait, pour que rien ne réapparaisse « À reconnecter » à la mise en ligne ; un compte qui
-- disparaît ensuite chez le prestataire reste à NULL.
--
-- Rejouable, sur base neuve (la table est créée par 20261007222159) comme en production.

ALTER TABLE public.member_whatsapp_accounts
  ADD COLUMN IF NOT EXISTS removed_by_member_at timestamptz;

UPDATE public.member_whatsapp_accounts
   SET removed_by_member_at = updated_at
 WHERE account_status = 'DELETED'
   AND removed_by_member_at IS NULL;

COMMENT ON COLUMN public.member_whatsapp_accounts.removed_by_member_at IS
  'Date de la déconnexion voulue par le membre (disconnect_whatsapp). NULL : compte vivant, ou compte disparu chez le prestataire.';
