/**
 * E-Boses chart kit — hand-built SVG/CSS visualisations, no charting
 * dependency. Every piece shares the `--color-chart-*` palette so the whole
 * dashboard reads as one system.
 */
export { Sparkline, type SparklineProps } from "./sparkline"
export { ActivityGrid, type ActivityCell, type ActivityGridProps } from "./activity-grid"
export { ColumnChart, type ColumnPoint, type ColumnChartProps } from "./column-chart"
export { ArcGauge, type ArcGaugeProps } from "./arc-gauge"
export { ShareBar, type ShareSegment, type ShareBarProps } from "./share-bar"
export { CHART_COLORS, CHART_TRACK, CHART_GRID, niceMax, ratio } from "./lib"
