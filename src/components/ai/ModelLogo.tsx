import { cn } from '@/lib/utils';

interface ModelLogoProps {
  modelId: string;
  className?: string;
  size?: number;
}

/**
 * Inline SVG logos for AI model providers.
 * Anthropic (Claude) = sparkle/star mark
 * Google (Gemini) = 4-point star
 */
export const ModelLogo = ({ modelId, className, size = 16 }: ModelLogoProps) => {
  const isGemini = modelId.startsWith('gemini');
  const isClaude = modelId.startsWith('claude');

  if (isGemini) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={cn("shrink-0", className)}
        fill="none"
      >
        {/* Gemini 4-point star */}
        <path
          d="M12 2C12 2 14.5 9.5 14.5 12C14.5 14.5 12 22 12 22C12 22 9.5 14.5 9.5 12C9.5 9.5 12 2 12 2Z"
          fill="#4285F4"
        />
        <path
          d="M2 12C2 12 9.5 9.5 12 9.5C14.5 9.5 22 12 22 12C22 12 14.5 14.5 12 14.5C9.5 14.5 2 12 2 12Z"
          fill="#4285F4"
        />
      </svg>
    );
  }

  if (isClaude) {
    // Determine color based on model tier
    const color = modelId.includes('opus')
      ? '#D97706' // amber for opus
      : modelId.includes('haiku')
        ? '#10B981' // green for haiku
        : '#D4783C'; // coral/orange for sonnet (Anthropic brand)

    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={cn("shrink-0", className)}
        fill="none"
      >
        {/* Anthropic/Claude sparkle mark */}
        <path
          d="M12 2L14.4 8.8L21.2 6.4L16.8 12L21.2 17.6L14.4 15.2L12 22L9.6 15.2L2.8 17.6L7.2 12L2.8 6.4L9.6 8.8L12 2Z"
          fill={color}
        />
      </svg>
    );
  }

  // Fallback: generic AI icon
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={cn("shrink-0 text-muted-foreground", className)}
      fill="currentColor"
    >
      <circle cx="12" cy="12" r="8" opacity="0.3" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
};

/** Small provider label text */
export const ProviderLabel = ({ modelId }: { modelId: string }) => {
  if (modelId.startsWith('gemini')) return <span className="text-[9px] text-[#4285F4] font-medium">Google</span>;
  if (modelId.startsWith('claude')) return <span className="text-[9px] text-[#D4783C] font-medium">Anthropic</span>;
  return null;
};
