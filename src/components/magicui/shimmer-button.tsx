import React from "react";
import { cn } from "@/lib/utils";

interface ShimmerButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  shimmerColor?: string;
  shimmerSize?: string;
  borderRadius?: string;
  shimmerDuration?: string;
  background?: string;
  children?: React.ReactNode;
}

/**
 * A button with a shimmering light traveling around its border.
 * Adapted from Magic UI (MIT) — https://magicui.design/docs/components/shimmer-button
 */
export const ShimmerButton = React.forwardRef<HTMLButtonElement, ShimmerButtonProps>(
  (
    {
      shimmerColor = "hsl(var(--brutal-accent))",
      shimmerSize = "0.1em",
      shimmerDuration = "2.5s",
      borderRadius = "0px",
      background = "hsl(var(--foreground))",
      className,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        className={cn(
          "group relative inline-flex items-center justify-center overflow-hidden whitespace-nowrap px-6 py-3 font-bold uppercase tracking-wider text-background transition-all",
          "hover:shadow-[0_0_20px_rgba(0,0,0,0.15)]",
          "disabled:pointer-events-none disabled:opacity-50",
          className
        )}
        style={{
          borderRadius,
          ["--shimmer-color" as string]: shimmerColor,
          ["--shimmer-size" as string]: shimmerSize,
          ["--speed" as string]: shimmerDuration,
          ["--bg" as string]: background,
        }}
        {...props}
      >
        {/* Shimmer effect */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ borderRadius }}
        >
          <div
            className="absolute inset-[-100%] animate-[shimmer-spin_var(--speed)_linear_infinite]"
            style={{
              background: `conic-gradient(from 0deg, transparent 0 340deg, var(--shimmer-color) 360deg)`,
            }}
          />
        </div>

        {/* Background */}
        <div
          className="absolute inset-[var(--shimmer-size)]"
          style={{
            borderRadius,
            background: "var(--bg)",
          }}
        />

        {/* Content */}
        <span className="relative z-10 flex items-center gap-2">{children}</span>
      </button>
    );
  }
);

ShimmerButton.displayName = "ShimmerButton";
