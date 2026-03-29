import { cn } from '@/lib/utils';

interface ModelLogoProps {
  modelId: string;
  className?: string;
  size?: number;
}

/**
 * Official provider logos for AI models.
 * Uses the real Anthropic and Google Gemini logos as inline SVGs.
 */
export const ModelLogo = ({ modelId, className, size = 16 }: ModelLogoProps) => {
  const isGemini = modelId.startsWith('gemini');
  const isClaude = modelId.startsWith('claude');

  if (isGemini) {
    // Official Google Gemini logo — the multi-colored star
    return (
      <svg
        viewBox="0 0 28 28"
        width={size}
        height={size}
        className={cn("shrink-0", className)}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M14 28C14 21.79 9.21 16.68 3.15 16.14C2.09 16.04 1.05 15.84 0 15.56C0 15.56 0 12.44 0 12.44C1.05 12.16 2.09 11.96 3.15 11.86C9.21 11.32 14 6.21 14 0C14 6.21 18.79 11.32 24.85 11.86C25.91 11.96 26.95 12.16 28 12.44V15.56C26.95 15.84 25.91 16.04 24.85 16.14C18.79 16.68 14 21.79 14 28Z"
          fill="url(#gemini_gradient)"
        />
        <defs>
          <linearGradient id="gemini_gradient" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
            <stop stopColor="#4285F4" />
            <stop offset="0.5" stopColor="#9B72CB" />
            <stop offset="1" stopColor="#D96570" />
          </linearGradient>
        </defs>
      </svg>
    );
  }

  if (isClaude) {
    // Official Anthropic/Claude logo — the stylized "A" / thinking symbol
    const color = modelId.includes('opus')
      ? '#CC785C'  // Anthropic warm (premium)
      : modelId.includes('haiku')
        ? '#CC785C' // Same brand color
        : '#CC785C'; // Anthropic brand coral

    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={cn("shrink-0", className)}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Anthropic Claude logo — the two-stroke A mark */}
        <path
          d="M17.308 3.147H14.05L20.47 20.853H23.728L17.308 3.147Z"
          fill={color}
        />
        <path
          d="M6.692 3.147L0.272 20.853H3.633L5.05 16.907H12.18L13.597 20.853H16.958L10.538 3.147H6.692ZM6.065 14.12L8.615 6.873L11.165 14.12H6.065Z"
          fill={color}
        />
      </svg>
    );
  }

  // Fallback
  return (
    <div
      className={cn("shrink-0 rounded-full bg-muted-foreground/20", className)}
      style={{ width: size, height: size }}
    />
  );
};

/** Small provider label */
export const ProviderLabel = ({ modelId }: { modelId: string }) => {
  if (modelId.startsWith('gemini')) return <span className="text-[9px] text-[#4285F4] font-medium">Google</span>;
  if (modelId.startsWith('claude')) return <span className="text-[9px] text-[#CC785C] font-medium">Anthropic</span>;
  return null;
};
