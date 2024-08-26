import type { PieArcDatum } from "d3";

import type { ColumnDescriptor } from "metabase/visualizations/lib/graph/columns";

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

export interface PieSliceData {
  key: string | number; // dimension value, used to lookup slices
  name: string; // display name, already formatted
  value: number; // size of the slice used for rendering
  displayValue: number; // real metric value of the slice displayed in tooltip or total graphic
  normalizedPercentage: number;
  color: string;
  isOther: boolean;
  noHover: boolean;
  includeInLegend: boolean;
  children: PieArcDatum<PieSliceData>[];
  rowIndex?: number;
}

export type PieSlice = PieArcDatum<PieSliceData>;

export type SliceTreeNode = {
  key: string | number; // dimension value
  name: string; // formatted name
  value: number;
  children: SliceTree;
  index?: number;
};

export type SliceTree = Map<string, SliceTreeNode>;

export interface PieChartModel {
  slices: PieSlice[];
  otherSlices: PieSlice[];
  sliceTree: SliceTree;
  total: number;
  colDescs: PieColumnDescriptors;
}
