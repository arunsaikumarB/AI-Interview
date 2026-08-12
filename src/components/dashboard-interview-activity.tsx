"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function DashboardInterviewActivity({
  completed,
  inProgress,
}: {
  completed: number;
  inProgress: number;
}) {
  const data = [
    { name: "Completed", count: completed },
    { name: "In progress", count: inProgress },
  ];
  const total = completed + inProgress;

  if (total === 0) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center px-4 text-center">
        <p className="text-sm font-medium text-slate-800">No interview activity yet</p>
        <p className="mt-1 text-sm text-slate-500">
          Completed interviews will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="h-[220px] w-full pt-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="name"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#64748b", fontSize: 12 }}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            width={28}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
          />
          <Tooltip
            cursor={{ fill: "rgba(15, 23, 42, 0.04)" }}
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              fontSize: 12,
            }}
          />
          <Bar dataKey="count" fill="#1e293b" radius={[6, 6, 0, 0]} maxBarSize={56} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
