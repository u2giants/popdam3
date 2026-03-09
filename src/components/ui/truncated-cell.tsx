import React, { useRef, useState, useEffect, useCallback } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface TruncatedCellProps {
  children: React.ReactNode;
  className?: string;
  tooltipClassName?: string;
  side?: "top" | "bottom" | "left" | "right";
  /** If provided, this text is shown in the tooltip instead of children */
  tooltipText?: string;
}

/**
 * A cell wrapper that shows a tooltip ONLY when the text content is actually
 * truncated (i.e., scrollWidth > clientWidth). This should be used everywhere
 * text might overflow.
 */
export function TruncatedCell({
  children,
  className = "",
  tooltipClassName = "max-w-md text-xs whitespace-normal break-words",
  side = "top",
  tooltipText,
}: TruncatedCellProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  const check = useCallback(() => {
    const el = ref.current;
    if (el) {
      setIsTruncated(el.scrollWidth > el.clientWidth + 1);
    }
  }, []);

  useEffect(() => {
    check();
    // Re-check on window resize
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [check, children]);

  if (!isTruncated) {
    return (
      <span
        ref={ref}
        className={`truncate block ${className}`}
        onMouseEnter={check}
      >
        {children}
      </span>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          ref={ref}
          className={`truncate block cursor-help ${className}`}
          onMouseEnter={check}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side={side} className={tooltipClassName}>
        {tooltipText ?? children}
      </TooltipContent>
    </Tooltip>
  );
}
