import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface GlowProps {
  /** Position of the glow */
  variant?: "top" | "bottom" | "center" | "top-right" | "top-left";
  /** Color — HSL CSS variable reference */
  color?: string;
  /** Glow intensity / size */
  size?: "sm" | "md" | "lg";
  /** Animate pulse */
  pulse?: boolean;
  className?: string;
}

const positionMap = {
  top: "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2",
  bottom: "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2",
  center: "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
  "top-right": "top-0 right-0 translate-x-1/4 -translate-y-1/4",
  "top-left": "top-0 left-0 -translate-x-1/4 -translate-y-1/4",
};

const sizeMap = {
  sm: "w-32 h-32",
  md: "w-64 h-64",
  lg: "w-96 h-96",
};

/**
 * Ambient glow effect component.
 * Place inside a relative + overflow-hidden container.
 * Inspired by 21st.dev Glow component.
 */
export const Glow: React.FC<GlowProps> = ({
  variant = "top",
  color = "hsl(var(--brutal-accent))",
  size = "md",
  pulse = false,
  className,
}) => {
  return (
    <motion.div
      className={cn(
        "pointer-events-none absolute rounded-full blur-3xl",
        positionMap[variant],
        sizeMap[size],
        className
      )}
      style={{ background: color, opacity: 0.25 }}
      animate={
        pulse
          ? { opacity: [0.15, 0.35, 0.15], scale: [0.95, 1.05, 0.95] }
          : undefined
      }
      transition={
        pulse
          ? { duration: 3, repeat: Infinity, ease: "easeInOut" }
          : undefined
      }
    />
  );
};
