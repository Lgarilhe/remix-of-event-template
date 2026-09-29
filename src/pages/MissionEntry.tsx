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
import { lazy, useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMissionBeta } from '@/hooks/useMissionBeta';
import {
  legacyToV3Target,
  missionBetaParam,
  setMissionBeta,
  v3ToLegacyTarget,
  withoutMissionBetaParam,
} from '@/lib/missionBeta';

const MissionWorkspace = lazy(() => import('./MissionWorkspace'));
const MissionWorkspaceV3 = lazy(() => import('@/components/missions/v3/MissionWorkspaceV3'));

export default function MissionEntry() {
  const { id } = useParams<{ id: string }>();
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const storedBeta = useMissionBeta();

  // Valeur demandée par l'adresse, appliquée dès ce rendu (pas d'aller-retour
  // par l'autre page le temps que l'effet écrive l'interrupteur).
  const requested = missionBetaParam(search);
  const beta = requested ?? storedBeta;

  // 1. ?nouvelle-mission= : écrit l'interrupteur, puis retire le paramètre.
  useEffect(() => {
    if (requested === null) return;
    setMissionBeta(requested);
    navigate(`${pathname}${withoutMissionBetaParam(search)}${hash}`, { replace: true });
  }, [requested, pathname, search, hash, navigate]);

  // 2. Adresse de l'autre page : convertie par remplacement.
  useEffect(() => {
    if (requested !== null) return;
    const target = beta ? legacyToV3Target(pathname, search) : v3ToLegacyTarget(pathname, search);
    if (target !== null) navigate(`${target}${hash}`, { replace: true });
  }, [requested, beta, pathname, search, hash, navigate]);

  if (!id) return null;
  if (beta) return <MissionWorkspaceV3 projectId={id} />;
  return <MissionWorkspace />;
}
