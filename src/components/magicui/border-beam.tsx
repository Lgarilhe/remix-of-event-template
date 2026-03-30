import { cn } from "@/lib/utils";

interface BorderBeamProps {
  className?: string;
  size?: number;
  duration?: number;
  delay?: number;
  colorFrom?: string;
  colorTo?: string;
  borderWidth?: number;
}

/**
 * Animated beam of light that travels along the border of a container.
 * Place inside a relative-positioned container.
 * Adapted from Magic UI (MIT) — https://magicui.design/docs/components/border-beam
 */
export function BorderBeam({
  className,
  size = 200,
  duration = 8,
  delay = 0,
  colorFrom = "hsl(var(--brutal-accent))",
  colorTo = "transparent",
  borderWidth = 1.5,
}: BorderBeamProps) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className
      )}
      style={{ borderRadius: "inherit" }}
    >
      <div
        className="absolute inset-0 animate-[border-beam_var(--duration)_linear_infinite]"
        style={{
          ["--duration" as string]: `${duration}s`,
          ["--delay" as string]: `${delay}s`,
          ["--size" as string]: `${size}px`,
          ["--color-from" as string]: colorFrom,
          ["--color-to" as string]: colorTo,
          animationDelay: `${delay}s`,
          background: `
            linear-gradient(to right, var(--color-from), var(--color-to)) top / var(--size) ${borderWidth}px no-repeat,
            linear-gradient(to right, var(--color-to), var(--color-from)) bottom / var(--size) ${borderWidth}px no-repeat,
            linear-gradient(to bottom, var(--color-from), var(--color-to)) left / ${borderWidth}px var(--size) no-repeat,
            linear-gradient(to bottom, var(--color-to), var(--color-from)) right / ${borderWidth}px var(--size) no-repeat
          `,
        }}
      />
    </div>
  );
}
