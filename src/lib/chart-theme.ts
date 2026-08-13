"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

/** Theme-aware Recharts colors — reference blue / green / AI purple. */
export function useChartTheme() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const light = mounted && resolvedTheme === "light";

  return {
    grid: light ? "#E2E3E5" : "#292A2C",
    axis: light ? "#65686D" : "#A3A5A8",
    axisLine: light ? "#E2E3E5" : "#292A2C",
    tooltipBg: light ? "rgba(255,255,255,0.94)" : "rgba(12,15,22,0.92)",
    tooltipBorder: light ? "rgba(20,30,50,0.08)" : "rgba(255,255,255,0.08)",
    tooltipText: light ? "#161718" : "#F5F5F5",
    series: light ? "#4D86E8" : "#4F83FF",
    seriesSecondary: light ? "#159A68" : "#4ADE9A",
    seriesAi: light ? "#705DE8" : "#8B7CFF",
    cursor: light ? "rgba(77,134,232,0.06)" : "rgba(79,131,255,0.08)",
  };
}
