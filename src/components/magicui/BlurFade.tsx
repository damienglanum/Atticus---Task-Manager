import type { ReactNode } from "react";
import { motion, useReducedMotion, type Variants } from "motion/react";

interface BlurFadeProps {
  children: ReactNode;
  className?: string;
  duration?: number;
  delay?: number;
  offset?: number;
  direction?: "up" | "down" | "left" | "right";
  inView?: boolean;
}

/** Adapted from Magic UI's Blur Fade registry component for Atticus. */
export function BlurFade({
  children,
  className,
  duration = 0.2,
  delay = 0,
  offset = 3,
  direction = "down",
}: BlurFadeProps) {
  const reduceMotion = useReducedMotion();
  const axis = direction === "left" || direction === "right" ? "x" : "y";
  const distance = direction === "right" || direction === "down" ? -offset : offset;

  const variants: Variants = reduceMotion
    ? { hidden: { opacity: 1 }, visible: { opacity: 1 } }
    : {
        hidden: { [axis]: distance, opacity: 0, filter: "blur(4px)" },
        visible: { [axis]: 0, opacity: 1, filter: "blur(0px)" },
      };

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={variants}
      transition={{
        delay: reduceMotion ? 0 : delay,
        duration: reduceMotion ? 0 : duration,
        ease: [0.22, 1, 0.36, 1],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
