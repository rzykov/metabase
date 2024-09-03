import type { ColumnDescriptor } from "metabase/visualizations/lib/graph/columns";
import type { RemappingHydratedDatasetColumn } from "metabase/visualizations/types";

export interface PieRow {
  key: string | number;
  name: string;
  originalName: string;
  color: string;
  defaultColor: boolean;
  enabled: boolean;
  hidden: boolean;
  isOther: boolean;
}

export interface PieColumnDescriptors {
  metricDesc: ColumnDescriptor;
  dimensionDesc: ColumnDescriptor;
  middleDimensionDesc?: ColumnDescriptor;
  outerDimensionDesc?: ColumnDescriptor;
}

export type SliceTreeNode = {
  // TODO just make key a string, raw value only need to create formatted name
  key: string | number; // dimension value, used to lookup slices
  name: string; // display name, already formatted
  value: number; // size of the slice used for rendering
  displayValue: number; // real metric value of the slice displayed in tooltip or total graphic
  normalizedPercentage: number;
  color: string;
  startAngle: number;
  endAngle: number;
  children: SliceTree;
  column?: RemappingHydratedDatasetColumn;
  rowIndex?: number;
  legendHoverIndex?: number;
  isOther?: boolean;
  noHover?: boolean;
  includeInLegend?: boolean;
};

export type SliceTree = Map<string, SliceTreeNode>;

export interface PieChartModel {
  sliceTree: SliceTree;
  total: number;
  colDescs: PieColumnDescriptors;
}
