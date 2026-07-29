/**
 * E-Boses chart kit — hand-built SVG/CSS visualisations, no charting
 * dependency. Every piece shares the `--color-chart-*` palette so the whole
 * dashboard reads as one system.
 */
export { Sparkline, type SparklineProps } from "./sparkline"
export { BarSeries, type BarPoint, type BarSeriesProps } from "./bar-series"
export { DonutGauge, type DonutSegment, type DonutGaugeProps } from "./donut-gauge"
export { ActivityGrid, type ActivityCell, type ActivityGridProps } from "./activity-grid"
export { CategoryBars, type CategoryRow, type CategoryBarsProps } from "./category-bars"
export { HeatmapGrid, HeatmapLegend, type HeatmapRow, type HeatmapGridProps } from "./heatmap-grid"
export { RadialArcs, RadialArcsLegend, type RadialArc, type RadialArcsProps } from "./radial-arcs"
export { DotPlot, type DotPlotProps } from "./dot-plot"
export { GroupedBars, type GroupedBarPoint, type GroupedBarsProps } from "./grouped-bars"
export {
  SegmentedDonut,
  DonutLegend,
  type DonutSlice,
  type SegmentedDonutProps,
} from "./segmented-donut"
export { CHART_COLORS, CHART_TRACK, CHART_GRID, niceMax, ratio } from "./lib"
