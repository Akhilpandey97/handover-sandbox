import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import {
  AreaChart as AreaIcon,
  BarChart3,
  BarChartHorizontal,
  ChartColumnStacked,
  ChartPie,
  Donut,
  LineChart as LineIcon,
  Rows3,
  Table2,
  TrendingUp,
} from "lucide-react";

/**
 * One chart renderer for the whole product.
 *
 * Buddy's report card and the report builder draw the same forms from the same
 * validated palette, so a column chart means the same thing wherever it appears.
 * The slots are assigned in fixed order and never cycled; a ninth series would
 * need folding into "Other" rather than a generated hue.
 */

export type ChartType =
  | "column"
  | "bar"
  | "line"
  | "area"
  | "pie"
  | "donut"
  | "stacked"
  | "grouped"
  | "multiline"
  | "table";

export type ChartRow = Record<string, string | number | null>;

export interface ChartSpec {
  /** Row key holding the category each mark is drawn for. */
  x: string;
  series: { key: string; label: string }[];
  /** What one value means, for the tooltip and the y-axis. */
  valueLabel: string;
}

const PIE_SLICES = 6; // part-to-whole at a glance only: 5 groups + "Other"

/** Categorical slots in fixed order (validated palette, see styles.css). Never cycled. */
export const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);

export const CHART_META: Record<ChartType, { label: string; icon: typeof BarChart3 }> = {
  column: { label: "Column", icon: BarChart3 },
  bar: { label: "Bar", icon: BarChartHorizontal },
  line: { label: "Line", icon: LineIcon },
  area: { label: "Area", icon: AreaIcon },
  pie: { label: "Pie", icon: ChartPie },
  donut: { label: "Donut", icon: Donut },
  stacked: { label: "Stacked", icon: ChartColumnStacked },
  grouped: { label: "Grouped", icon: Rows3 },
  multiline: { label: "Lines", icon: TrendingUp },
  table: { label: "Table", icon: Table2 },
};

export const fmt = (v: unknown) =>
  typeof v === "number" ? v.toLocaleString("en-IN") : v === null || v === undefined ? "—" : String(v);


const axisTick = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };

const ChartTooltip = ({ active, payload, label, valueLabel }: TooltipProps<number, string> & { valueLabel: string }) => {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value !== undefined);
  return (
    <div className="min-w-36 rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 text-muted-foreground">{label ?? rows[0]?.name}</p>
      {rows.map((p) => (
        <div key={String(p.dataKey ?? p.name)} className="flex items-center gap-2">
          <span className="h-0.5 w-3 rounded-full" style={{ background: (p.payload?.fill as string) || p.color }} />
          <span className="font-semibold tabular-nums text-foreground">{fmt(p.value)}</span>
          <span className="truncate text-muted-foreground">{rows.length > 1 || p.name !== "value" ? p.name : valueLabel}</span>
        </div>
      ))}
    </div>
  );
};

const Legend = ({ items, shape }: { items: { label: string; color: string; value?: string }[]; shape: "rect" | "line" }) => (
  <ul className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3 text-xs text-muted-foreground" aria-label="Legend">
    {items.map((it) => (
      <li key={it.label} className="inline-flex items-center gap-1.5">
        <span className={shape === "line" ? "h-0.5 w-3.5 rounded-full" : "h-2.5 w-2.5 rounded-[3px]"} style={{ background: it.color }} />
        <span className="text-foreground">{it.label}</span>
        {it.value && <span className="tabular-nums">{it.value}</span>}
      </li>
    ))}
  </ul>
);
export const ChartView = ({ rows, chart, type }: { rows: ChartRow[]; chart: ChartSpec; type: ChartType }) => {
  const series = chart.series;
  const multi = series.length > 1;
  const data = rows;
  const longestLabel = useMemo(() => Math.max(...data.map((r) => String(r[chart.x] ?? "").length), 4), [data, chart.x]);

  if (type === "pie" || type === "donut") {
    const key = series[0]!.key;
    const sorted = data.map((r) => ({ name: String(r[chart.x] ?? ""), value: Number(r[key]) || 0 })).filter((d) => d.value > 0);
    const slices = sorted.length > PIE_SLICES
      ? [...sorted.slice(0, PIE_SLICES - 1), { name: "Other", value: sorted.slice(PIE_SLICES - 1).reduce((a, d) => a + d.value, 0) }]
      : sorted;
    const total = slices.reduce((a, d) => a + d.value, 0) || 1;
    return (
      <div>
        <Legend shape="rect" items={slices.map((s, i) => ({ label: s.name, color: SERIES[i]!, value: `${fmt(s.value)} · ${Math.round((s.value / total) * 100)}%` }))} />
        <div className="h-64 px-2 py-2">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="name"
                innerRadius={type === "donut" ? "58%" : 0}
                outerRadius="85%"
                stroke="hsl(var(--card))"
                strokeWidth={2}
                isAnimationActive={false}
              >
                {slices.map((s, i) => (
                  <Cell key={s.name} fill={SERIES[i]} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip valueLabel={chart.valueLabel} />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  const grid = <CartesianGrid stroke="var(--chart-grid)" vertical={false} />;
  const xAxis = (
    <XAxis
      dataKey={chart.x}
      tick={axisTick}
      tickLine={false}
      axisLine={{ stroke: "var(--chart-axis)" }}
      interval="preserveStartEnd"
      height={32}
    />
  );
  const yAxis = <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} allowDecimals={chart.valueLabel !== "Projects"} tickFormatter={(v) => Number(v).toLocaleString("en-IN")} />;
  const tooltip = (cursor: object) => <Tooltip cursor={cursor} content={<ChartTooltip valueLabel={chart.valueLabel} />} />;
  const legendItems = series.map((s, i) => ({ label: s.label, color: SERIES[i]! }));

  if (type === "bar") {
    const height = Math.max(160, data.length * 30 + 40);
    return (
      <div className="px-2 py-3" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
            <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} allowDecimals={chart.valueLabel !== "Projects"} />
            <YAxis type="category" dataKey={chart.x} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--chart-axis)" }} width={Math.min(160, longestLabel * 7 + 12)} />
            {tooltip({ fill: "hsl(var(--muted))" })}
            <Bar dataKey={series[0]!.key} name={series[0]!.label} fill={SERIES[0]} barSize={18} radius={[0, 4, 4, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (type === "line" || type === "multiline") {
    return (
      <div>
        {multi && <Legend shape="line" items={legendItems} />}
        <div className="h-64 px-2 py-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 20, bottom: 0, left: 0 }}>
              {grid}
              {xAxis}
              {yAxis}
              {tooltip({ stroke: "var(--chart-axis)", strokeWidth: 1 })}
              {series.map((s, i) => (
                <Line
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  type="monotone"
                  stroke={SERIES[i]}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={{ r: 4, fill: SERIES[i], stroke: "hsl(var(--card))", strokeWidth: 2 }}
                  activeDot={{ r: 5, stroke: "hsl(var(--card))", strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  if (type === "area") {
    const key = series[0]!.key;
    return (
      <div className="h-64 px-2 py-3">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 20, bottom: 0, left: 0 }}>
            {grid}
            {xAxis}
            {yAxis}
            {tooltip({ stroke: "var(--chart-axis)", strokeWidth: 1 })}
            <Area
              dataKey={key}
              name={series[0]!.label}
              type="monotone"
              stroke={SERIES[0]}
              strokeWidth={2}
              fill={SERIES[0]}
              fillOpacity={0.1}
              dot={{ r: 4, fill: SERIES[0], stroke: "hsl(var(--card))", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // column, stacked, grouped
  const stacked = type === "stacked";
  const grouped = type === "grouped" && multi;
  return (
    <div>
      {multi && <Legend shape="rect" items={legendItems} />}
      <div className="h-64 px-2 py-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barGap={2}>
            {grid}
            {xAxis}
            {yAxis}
            {tooltip({ fill: "hsl(var(--muted))" })}
            {(multi ? series : series.slice(0, 1)).map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId={stacked ? "stack" : undefined}
                fill={SERIES[i]}
                maxBarSize={grouped ? 14 : 24}
                stroke={stacked ? "hsl(var(--card))" : undefined}
                strokeWidth={stacked ? 2 : 0}
                radius={stacked ? (i === series.length - 1 ? [4, 4, 0, 0] : 0) : [4, 4, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
