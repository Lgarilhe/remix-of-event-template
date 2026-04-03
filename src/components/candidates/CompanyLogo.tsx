import React, { useState } from 'react';
import { Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CompanyLogoProps {
  company: string;
  logoUrl?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const CompanyLogo: React.FC<CompanyLogoProps> = ({ company, logoUrl, size = 'md', className }) => {
  const [fallbackIndex, setFallbackIndex] = useState(0);

  const domainSlug = company
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();

  const sources = [
    logoUrl,
    domainSlug ? `https://logo.clearbit.com/${domainSlug}.com` : null,
    domainSlug ? `https://www.google.com/s2/favicons?domain=${domainSlug}.com&sz=128` : null,
  ].filter(Boolean) as string[];

  const sizeClasses = {
    sm: 'w-5 h-5',
    md: 'w-7 h-7',
    lg: 'w-9 h-9',
  };

  if (!sources[fallbackIndex]) {
    return (
      <div className={cn(
        "flex items-center justify-center bg-muted border border-border rounded",
        sizeClasses[size],
        className,
      )}>
        <Building2 className={cn(size === 'sm' ? 'w-3 h-3' : size === 'md' ? 'w-4 h-4' : 'w-5 h-5', 'text-muted-foreground')} />
      </div>
    );
  }

  return (
    <img
      src={sources[fallbackIndex]}
      alt={`${company} logo`}
      className={cn(
        "rounded border border-border object-contain bg-white",
        sizeClasses[size],
        className,
      )}
      onError={() => setFallbackIndex(i => i + 1)}
    />
  );
};
