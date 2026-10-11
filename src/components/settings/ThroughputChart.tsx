import { AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid } from "recharts";

// Split out of SettingsPage so recharts loads only when the chart renders (#193).
export default function ThroughputChart({ chartData }: { chartData: Record<string, unknown>[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 22%)" />
        <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(220 10% 55%)" }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 10, fill: "hsl(220 10% 55%)" }} tickLine={false} axisLine={false} allowDecimals={false} />
        <RechartsTooltip
          contentStyle={{
            backgroundColor: "hsl(220 16% 15%)",
            border: "1px solid hsl(220 14% 22%)",
            borderRadius: "6px",
            fontSize: 12,
            color: "hsl(220 13% 91%)",
          }}
        />
        <Area type="monotone" dataKey="ingested" name="Ingested" stroke="hsl(38 92% 55%)" fill="hsl(38 92% 55% / 0.2)" strokeWidth={2} />
        <Area type="monotone" dataKey="updated" name="Updated" stroke="hsl(217 91% 60%)" fill="hsl(217 91% 60% / 0.1)" strokeWidth={1.5} />
        <Area type="monotone" dataKey="moved" name="Moved" stroke="hsl(142 71% 45%)" fill="hsl(142 71% 45% / 0.1)" strokeWidth={1.5} />
        <Area type="monotone" dataKey="errors" name="Errors" stroke="hsl(0 72% 51%)" fill="hsl(0 72% 51% / 0.1)" strokeWidth={1.5} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
