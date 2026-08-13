"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useChartTheme } from "@/lib/chart-theme";

export function DashboardInterviewActivity({
  completed,
  inProgress,
}: {
  completed: number;
  inProgress: number;
}) {
  const chart = useChartTheme();
  const data = [{ name: "Interviews", completed, inProgress }];
  const total = completed + inProgress;

  if (total === 0) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center px-4 text-center">
        <p className="text-sm font-medium text-foreground">No interview activity yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Completed interviews will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="h-[260px] w-full pt-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barGap={10} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid
            vertical={false}
            stroke={chart.grid}
            strokeDasharray="3 6"
          />
          <XAxis
            dataKey="name"
            tickLine={false}
            axisLine={false}
            tick={{ fill: chart.axis, fontSize: 12 }}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            width={28}
            tick={{ fill: chart.axis, fontSize: 11 }}
          />
          <Tooltip
            cursor={{ fill: chart.cursor }}
            contentStyle={{
              borderRadius: 12,
              border: `1px solid ${chart.tooltipBorder}`,
              background: chart.tooltipBg,
              color: chart.tooltipText,
              fontSize: 12,
              boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            }}
          />
          <Bar
            dataKey="completed"
            name="Completed"
            fill={chart.series}
            radius={[8, 8, 0, 0]}
            maxBarSize={48}
          />
          <Bar
            dataKey="inProgress"
            name="In progress"
            fill={chart.seriesSecondary}
            radius={[8, 8, 0, 0]}
            maxBarSize={48}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
