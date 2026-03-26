import React from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { hasFeature, type Feature } from '@/lib/featureGates';

interface FeatureGateProps {
  /** Feature to check access for */
  feature: Feature;
  /** Content shown when feature is available */
  children: React.ReactNode;
  /** Optional content shown when feature is NOT available */
  fallback?: React.ReactNode;
}

/** Conditionally renders children based on org_type feature access */
export const FeatureGate: React.FC<FeatureGateProps> = ({ feature, children, fallback = null }) => {
  const { orgType } = useOrganization();

  if (!hasFeature(orgType, feature)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};
