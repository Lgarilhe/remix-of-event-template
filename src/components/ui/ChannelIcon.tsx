import React from 'react';
import { cn } from '@/lib/utils';
import whatsappLogo from '@/assets/whatsapp-logo.svg';
import { Linkedin } from 'lucide-react';

export type ChannelType = 'linkedin' | 'whatsapp';

interface ChannelIconProps {
  channel: ChannelType;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  showLabel?: boolean;
}

const SIZES = {
  xs: 'w-3 h-3',
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-6 h-6',
};

export const ChannelIcon: React.FC<ChannelIconProps> = ({
  channel,
  size = 'sm',
  className,
  showLabel = false,
}) => {
  const sizeClass = SIZES[size];

  if (channel === 'whatsapp') {
    return (
      <span className={cn('inline-flex items-center gap-1', className)}>
        <img src={whatsappLogo} alt="WhatsApp" className={sizeClass} />
        {showLabel && <span className="text-xs font-medium text-[#25D366]">WhatsApp</span>}
      </span>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <Linkedin className={cn(sizeClass, 'text-[#0A66C2]')} />
      {showLabel && <span className="text-xs font-medium text-[#0A66C2]">LinkedIn</span>}
    </span>
  );
};

/**
 * Detect channel from Unipile account_type or provider string.
 */
export function detectChannel(accountType?: string): ChannelType {
  if (!accountType) return 'linkedin';
  const lower = accountType.toLowerCase();
  if (lower.includes('whatsapp') || lower === 'wa' || lower === 'whatsapp') return 'whatsapp';
  return 'linkedin';
}
