import { cn } from '@/lib/utils';
import { useId } from 'react';

interface ModelLogoProps {
  modelId: string;
  className?: string;
  size?: number;
}

/**
 * Provider logos matching the Notion-style model picker.
 * - Gemini: 4-pointed diamond star with blue→pink→orange gradient
 * - Claude (Anthropic): starburst / sparkle icon in coral
 */
export const ModelLogo = ({ modelId, className, size = 16 }: ModelLogoProps) => {
  const isGemini = modelId.startsWith('gemini');
  const isClaude = modelId.startsWith('claude');
  const uid = useId();

  if (isGemini) {
    // Gemini 4-pointed diamond star — matches the official Google Gemini icon
    const gid = `gem${uid}`;
    return (
      <svg
        viewBox="0 0 28 28"
        width={size}
        height={size}
        className={cn("shrink-0", className)}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Google Gemini"
      >
        <path
          d="M14 0C14 7.732 8.627 14 2 14c6.627 0 12 6.268 12 14 0-7.732 5.373-14 12-14-6.627 0-12-6.268-12-14Z"
          fill={`url(#${gid})`}
        />
        <defs>
          <linearGradient id={gid} x1="2" y1="2" x2="26" y2="26" gradientUnits="userSpaceOnUse">
            <stop stopColor="#4285F4" />
            <stop offset="0.35" stopColor="#9B72CB" />
            <stop offset="0.65" stopColor="#D96570" />
            <stop offset="1" stopColor="#E8710A" />
          </linearGradient>
        </defs>
      </svg>
    );
  }

  if (isClaude) {
    // Anthropic Claude sparkle / starburst icon — coral brand color
    const color = '#E87040';
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={cn("shrink-0", className)}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Anthropic Claude"
      >
        {/* 8-ray starburst */}
        <path
          d="M12 1l1.3 4.5a2 2 0 001.2 1.2L19 8l-4.5 1.3a2 2 0 00-1.2 1.2L12 15l-1.3-4.5a2 2 0 00-1.2-1.2L5 8l4.5-1.3a2 2 0 001.2-1.2L12 1z"
          fill={color}
        />
        <path
          d="M18 14l.7 2.3a1 1 0 00.6.6L22 17.6l-2.7.7a1 1 0 00-.6.6L18 21.6l-.7-2.7a1 1 0 00-.6-.6L14 17.6l2.7-.7a1 1 0 00.6-.6L18 14z"
          fill={color}
          opacity="0.7"
        />
        <path
          d="M7 14.5l.45 1.55a.75.75 0 00.5.5L9.5 17l-1.55.45a.75.75 0 00-.5.5L7 19.5l-.45-1.55a.75.75 0 00-.5-.5L4.5 17l1.55-.45a.75.75 0 00.5-.5L7 14.5z"
          fill={color}
          opacity="0.5"
        />
      </svg>
    );
  }

  // Fallback
  return (
    <div
      className={cn("shrink-0 bg-muted-foreground/20 rounded-full", className)}
      style={{ width: size, height: size }}
    />
  );
};

/** Small provider label as a muted badge */
export const ProviderLabel = ({ modelId }: { modelId: string }) => {
  if (modelId.startsWith('gemini'))
    return <span className="text-[9px] font-semibold text-[#4285F4] uppercase tracking-wider">Google</span>;
  if (modelId.startsWith('claude'))
    return <span className="text-[9px] font-semibold text-[#E87040] uppercase tracking-wider">Anthropic</span>;
  return null;
};
