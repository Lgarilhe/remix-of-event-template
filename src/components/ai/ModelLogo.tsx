import { cn } from '@/lib/utils';

interface ModelLogoProps {
  modelId: string;
  className?: string;
  size?: number;
}

/**
 * Official provider logos for AI models.
 * Anthropic Claude: the canonical "A\" mark.
 * Google Gemini: the 4-pointed star with gradient.
 */
export const ModelLogo = ({ modelId, className, size = 16 }: ModelLogoProps) => {
  const isGemini = modelId.startsWith('gemini');
  const isClaude = modelId.startsWith('claude');

  // Use unique gradient IDs to avoid SVG conflicts when multiple instances render
  const gradientId = `gemini_grad_${size}`;

  if (isGemini) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={cn("shrink-0", className)}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Google Gemini"
      >
        <path
          d="M12 0C12 6.627 7.97 12.21 2.4 13.68L0 14.4v-4.8l2.4-.72C5.97 7.41 8.4 3.97 8.4 0h3.6Zm0 0c0 6.627 4.03 12.21 9.6 13.68L24 14.4v-4.8l-2.4-.72C17.03 7.41 15.6 3.97 15.6 0H12Zm0 24c0-6.627-4.03-12.21-9.6-13.68L0 9.6v4.8l2.4.72C6.97 16.59 8.4 20.03 8.4 24H12Zm0 0c0-6.627 4.03-12.21 9.6-13.68L24 9.6v4.8l-2.4.72C17.03 16.59 15.6 20.03 15.6 24H12Z"
          fill={`url(#${gradientId})`}
        />
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
            <stop stopColor="#1A73E8" />
            <stop offset="0.33" stopColor="#6C47B8" />
            <stop offset="0.66" stopColor="#D63384" />
            <stop offset="1" stopColor="#E8710A" />
          </linearGradient>
        </defs>
      </svg>
    );
  }

  if (isClaude) {
    // Official Anthropic Claude wordmark "A\" — coral brand color
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
        <path
          d="M16.98 3.41h-3.27l6.57 17.18h3.27L16.98 3.41Z"
          fill="#D97757"
        />
        <path
          d="M6.35 3.41.45 20.59h3.4l1.38-3.97h7.15l1.38 3.97h3.4L11.26 3.41H6.35Zm-.36 10.75L8.57 7.7l2.58 6.46H5.99Z"
          fill="#D97757"
        />
      </svg>
    );
  }

  // Fallback
  return (
    <div
      className={cn("shrink-0 bg-muted-foreground/20", className)}
      style={{ width: size, height: size }}
    />
  );
};

/** Small provider label */
export const ProviderLabel = ({ modelId }: { modelId: string }) => {
  if (modelId.startsWith('gemini'))
    return <span className="text-[9px] font-semibold text-[#1A73E8] uppercase tracking-wider">Google</span>;
  if (modelId.startsWith('claude'))
    return <span className="text-[9px] font-semibold text-[#D97757] uppercase tracking-wider">Anthropic</span>;
  return null;
};
