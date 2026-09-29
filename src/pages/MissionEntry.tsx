// Refonte mission, lots 1 et 2 : entrée de la route des missions (/missions/:id et ses écrans).
//
// Interrupteur éteint (défaut) : l'ancienne page MissionWorkspace, intacte.
// Allumé : la nouvelle page (MissionWorkspaceV3).
//
// ?nouvelle-mission=1 allume, ?nouvelle-mission=0 éteint, puis le paramètre
// quitte l'adresse. Les adresses de l'autre page sont converties par
// remplacement, dans un effet, à chaque changement d'adresse : jamais de
// composant de redirection rendu à la place de la page, qui démonterait l'écran affiché (et
// le cache du Sourcing). Les composants réutilisés qui écrivent encore ?tab=
// arrivent ainsi au bon écran sans être modifiés.
//
// La page affichée pour une mission est figée : un changement de
// l'interrupteur dans un autre onglet ne la remplace pas en pleine saisie. Elle
// suit seulement ?nouvelle-mission= et « Revenir à l'ancienne page » dans cet
// onglet, et relit l'interrupteur à chaque changement de mission.
//
// L'ancienne page est importée avec l'entrée (un seul fichier à charger quand
// l'interrupteur est éteint) ; la nouvelle reste chargée à la demande.
import { lazy, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMissionBeta } from '@/hooks/useMissionBeta';
import {
  getMissionBeta,
  legacyToV3Target,
  missionBetaParam,
  parseMissionPath,
  setMissionBeta,
  subscribeMissionBetaLocal,
  v3ToLegacyTarget,
  withoutMissionBetaParam,
} from '@/lib/missionBeta';
import MissionWorkspace from './MissionWorkspace';

const MissionWorkspaceV3 = lazy(() => import('@/components/missions/v3/MissionWorkspaceV3'));

export default function MissionEntry() {
  const { id } = useParams<{ id: string }>();
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const storedBeta = useMissionBeta();

  // Valeur figée pour la mission affichée : lue au montage et à chaque
  // changement de mission, puis changée seulement par cet onglet.
  const [pinned, setPinned] = useState(() => ({ id, beta: storedBeta }));
  if (pinned.id !== id) setPinned({ id, beta: storedBeta });
  const pinnedBeta = pinned.id === id ? pinned.beta : storedBeta;
  useEffect(() => subscribeMissionBetaLocal(() => setPinned({ id, beta: getMissionBeta() })), [id]);

  // Valeur demandée par l'adresse, appliquée dès ce rendu (pas d'aller-retour
  // par l'autre page le temps que l'effet écrive l'interrupteur).
  const requested = missionBetaParam(search);
  const beta = requested ?? pinnedBeta;

  // 1. ?nouvelle-mission= : écrit l'interrupteur, puis retire le paramètre.
  useEffect(() => {
    if (requested === null) return;
    setMissionBeta(requested);
    navigate(`${pathname}${withoutMissionBetaParam(search)}${hash}`, { replace: true });
  }, [requested, pathname, search, hash, navigate]);

  // 2. Adresse de l'autre page : convertie par remplacement. Sous-chemin de
  // plus d'un segment (/missions/:id/a/b, adresse mal formée) : ramené à la
  // mission, comme un sous-chemin inconnu.
  useEffect(() => {
    if (requested !== null) return;
    if (id && parseMissionPath(pathname) === null) {
      navigate(`/missions/${encodeURIComponent(id)}${search}${hash}`, { replace: true });
      return;
    }
    const target = beta ? legacyToV3Target(pathname, search) : v3ToLegacyTarget(pathname, search);
    if (target !== null) navigate(`${target}${hash}`, { replace: true });
  }, [id, requested, beta, pathname, search, hash, navigate]);

  if (!id) return null;
  if (beta) return <MissionWorkspaceV3 projectId={id} />;
  return <MissionWorkspace />;
}
