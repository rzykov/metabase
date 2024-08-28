import { pie } from "d3";
import _ from "underscore";

import { findWithIndex } from "metabase/lib/arrays";
import { checkNotNull } from "metabase/lib/types";
import { getNumberOr } from "metabase/visualizations/lib/settings/row-values";
import { pieNegativesWarning } from "metabase/visualizations/lib/warnings";
import {
  getAggregatedRows,
  getKeyFromDimensionValue,
} from "metabase/visualizations/shared/settings/pie";
import type {
  ComputedVisualizationSettings,
  RenderingContext,
} from "metabase/visualizations/types";
import type { RawSeries } from "metabase-types/api";

import type { ShowWarning } from "../../types";
import { OTHER_SLICE_KEY, OTHER_SLICE_MIN_PERCENTAGE } from "../constants";

import type {
  PieChartModel,
  PieColumnDescriptors,
  PieSlice,
  PieSliceData,
  SliceTree,
} from "./types";

function getColDescs(
  rawSeries: RawSeries,
  settings: ComputedVisualizationSettings,
): PieColumnDescriptors {
  const [
    {
      data: { cols },
    },
  ] = rawSeries;

  const dimension = findWithIndex(
    cols,
    c => c.name === settings["pie.dimension"],
  );
  const metric = findWithIndex(cols, c => c.name === settings["pie.metric"]);

  if (!dimension.item || !metric.item) {
    throw new Error(
      `Could not find columns based on "pie.dimension" (${settings["pie.dimension"]}) and "pie.metric" (${settings["pie.metric"]}) settings.`,
    );
  }

  const colDescs: PieColumnDescriptors = {
    dimensionDesc: {
      index: dimension.index,
      column: dimension.item,
    },
    metricDesc: {
      index: metric.index,
      column: metric.item,
    },
  };

  if (settings["pie.middle_dimension"] != null) {
    const middleDimension = findWithIndex(
      cols,
      c => c.name === settings["pie.middle_dimension"],
    );
    if (!middleDimension.item) {
      throw new Error(
        `Could not find column based on "pie.middle_dimension" (${settings["pie.middle_dimension"]})`,
      );
    }

    colDescs.middleDimensionDesc = {
      index: middleDimension.index,
      column: middleDimension.item,
    };
  }

  if (
    settings["pie.middle_dimension"] != null &&
    settings["pie.outer_dimension"] != null
  ) {
    const outerDimension = findWithIndex(
      cols,
      c => c.name === settings["pie.outer_dimension"],
    );
    if (!outerDimension.item) {
      throw new Error(
        `Could not find column based on "pie.outer_dimension" (${settings["pie.outer_dimension"]})`,
      );
    }

    colDescs.outerDimensionDesc = {
      index: outerDimension.index,
      column: outerDimension.item,
    };
  }

  return colDescs;
}

export function getPieChartModel(
  rawSeries: RawSeries,
  settings: ComputedVisualizationSettings,
  renderingContext: RenderingContext,
  showWarning?: ShowWarning,
): PieChartModel {
  const [
    {
      data: { rows: dataRows },
    },
  ] = rawSeries;
  const colDescs = getColDescs(rawSeries, settings);

  const rowIndiciesByKey = new Map<string | number, number>();
  dataRows.forEach((row, index) => {
    const key = getKeyFromDimensionValue(row[colDescs.dimensionDesc.index]);

    if (rowIndiciesByKey.has(key)) {
      return;
    }
    rowIndiciesByKey.set(key, index);
  });

  const aggregatedRows = getAggregatedRows(
    dataRows,
    colDescs.dimensionDesc.index,
    colDescs.metricDesc.index,
    showWarning,
    colDescs.dimensionDesc.column,
  );

  const rowValuesByKey = new Map<string | number, number>();
  aggregatedRows.map(row =>
    rowValuesByKey.set(
      getKeyFromDimensionValue(row[colDescs.dimensionDesc.index]),
      getNumberOr(row[colDescs.metricDesc.index], 0),
    ),
  );

  const pieRows = settings["pie.rows"];
  if (pieRows == null) {
    throw Error("missing `pie.rows` setting");
  }

  const visiblePieRows = pieRows.filter(row => row.enabled && !row.hidden);

  const pieRowsWithValues = visiblePieRows.map(pieRow => {
    const value = rowValuesByKey.get(pieRow.key);
    if (value === undefined) {
      throw Error(`No row values found for key ${pieRow.key}`);
    }

    return {
      ...pieRow,
      value,
    };
  });

  // We allow negative values if every single metric value is negative or 0
  // (`isNonPositive` = true). If the values are mixed between positives and
  // negatives, we'll simply ignore the negatives in all calculations.
  // TODO update this to account for middle and outer rings
  const isNonPositive =
    pieRowsWithValues.every(row => row.value <= 0) &&
    !pieRowsWithValues.every(row => row.value === 0);

  const total = pieRowsWithValues.reduce((currTotal, { value }) => {
    if (!isNonPositive && value < 0) {
      showWarning?.(pieNegativesWarning().text);
      return currTotal;
    }

    return currTotal + value;
  }, 0);

  const [slices, others] = _.chain(pieRowsWithValues)
    .map(({ value, color, key, name, isOther }): PieSliceData => {
      return {
        key,
        name,
        value: isNonPositive ? -1 * value : value,
        displayValue: value,
        normalizedPercentage: value / total, // slice percentage values are normalized to 0-1 scale
        rowIndex: rowIndiciesByKey.get(key),
        color,
        isOther,
        noHover: false,
        includeInLegend: true,
        children: [],
      };
    })
    .filter(slice => isNonPositive || slice.value > 0)
    .partition(slice => slice != null && !slice.isOther)
    .value();

  // We don't show the grey other slice if there isn't more than one slice to
  // group into it
  if (others.length === 1) {
    const singleOtherSlice = others.pop();
    slices.push(checkNotNull(singleOtherSlice));
  }

  // We need d3 slices for the label formatter, to determine if we should the
  // percent label on the chart for a specific slice
  const d3Pie = pie<PieSliceData>()
    .sort(null)
    // 1 degree in radians
    .padAngle((Math.PI / 180) * 1)
    .value(s => s.value);

  // Add child slices for middle and outer rings
  // Step 1. Build a tree using maps to represent slice parent child relationships.

  // To start we fill out the first layer, the innermost slices based on
  // "pie.dimension"
  const sliceTree: SliceTree = new Map();
  pieRowsWithValues.forEach((pieRow, index) => {
    // Map key needs to be string, because we use it for lookup with values from
    // echarts, and echarts casts numbers to strings
    sliceTree.set(String(pieRow.key), {
      key: pieRow.key,
      name: pieRow.name,
      value: pieRow.value,
      color: pieRow.color,
      children: new Map(),
      column: colDescs.dimensionDesc.column,
      rowIndex: checkNotNull(rowIndiciesByKey.get(pieRow.key)),
      legendHoverIndex: index,
    });
  });

  // Iterate through non-aggregated rows from query result to build layers for
  // the middle and outer ring slices.
  if (colDescs.middleDimensionDesc != null) {
    dataRows.forEach((row, index) => {
      // Needed to tell typescript it's defined
      if (colDescs.middleDimensionDesc == null) {
        throw new Error(`Missing middleDimensionDesc`);
      }

      const dimensionKey = getKeyFromDimensionValue(
        row[colDescs.dimensionDesc.index],
      );
      const dimensionNode = sliceTree.get(String(dimensionKey));
      if (dimensionNode == null) {
        throw new Error(`Could not find dimensionNode for key ${dimensionKey}`);
      }
      const metricValue = getNumberOr(row[colDescs.metricDesc.index], 0);

      // Create or update node for middle dimension
      const middleDimensionKey = getKeyFromDimensionValue(
        row[colDescs.middleDimensionDesc.index],
      );
      let middleDimensionNode = dimensionNode.children.get(
        String(middleDimensionKey),
      );

      if (middleDimensionNode == null) {
        // If there is no node for this middle dimension value in the tree
        // create it.
        middleDimensionNode = {
          key: middleDimensionKey,
          name: String(row[colDescs.middleDimensionDesc.index]), // TODO formatting
          value: metricValue,
          color: "", // TODO use correct color for tooltip
          column: colDescs.middleDimensionDesc.column,
          rowIndex: index,
          children: new Map(),
        };
        dimensionNode.children.set(
          String(middleDimensionKey),
          middleDimensionNode,
        );
      } else {
        // If the node already exists, add the metric value from the current row
        // to it.
        middleDimensionNode.value += metricValue;
      }

      if (colDescs.outerDimensionDesc == null) {
        return;
      }
      // Create or update node for outer dimension
      const outerDimensionKey = getKeyFromDimensionValue(
        row[colDescs.outerDimensionDesc.index],
      );

      let outerDimensionNode = middleDimensionNode.children.get(
        String(outerDimensionKey),
      );

      if (outerDimensionNode == null) {
        outerDimensionNode = {
          key: outerDimensionKey,
          name: String(row[colDescs.outerDimensionDesc.index]), // TODO formatting
          value: metricValue,
          color: "",
          column: colDescs.outerDimensionDesc.column,
          rowIndex: index,
          children: new Map(),
        };
        middleDimensionNode.children.set(
          String(outerDimensionKey),
          outerDimensionNode,
        );
      } else {
        outerDimensionNode.value += metricValue;
      }
    });

    // Step 2. Add slices from tree nodes to chartModel.slices array
    slices.forEach(slice => {
      const sliceTreeNode = sliceTree.get(String(slice.key));
      if (sliceTreeNode == null) {
        throw Error(`No sliceTreeNode found for key ${slice.key}`);
      }
      function getSlicesFromChildren(children: SliceTree): PieSlice[] {
        const childrenArray = Array(...children.values());
        if (childrenArray.length === 0) {
          return [];
        }

        return d3Pie(
          childrenArray.map(({ key, value, children }) => ({
            key,
            name: String(key), // TODO formatting
            value: isNonPositive ? -1 * value : value,
            displayValue: value,
            normalizedPercentage: value / total, // slice percentage values are normalized to 0-1 scale
            rowIndex: 0, // TODO need this for creating new tooltip
            color: slice.color, // TODO update this
            isOther: false,
            noHover: false,
            includeInLegend: false,
            children: getSlicesFromChildren(children),
          })),
        );
      }

      slice.children = getSlicesFromChildren(sliceTreeNode.children);
    });
  }

  // Only add "other" slice if there are slices below threshold with non-zero total
  const otherTotal = others.reduce((currTotal, o) => currTotal + o.value, 0);
  if (otherTotal > 0) {
    sliceTree.set(OTHER_SLICE_KEY, {
      key: OTHER_SLICE_KEY,
      name: OTHER_SLICE_KEY,
      value: otherTotal,
      color: renderingContext.getColor("text-light"),
      children: new Map(),
      legendHoverIndex: slices.length,
      isOther: true,
    });

    slices.push({
      key: OTHER_SLICE_KEY,
      name: OTHER_SLICE_KEY,
      value: otherTotal,
      displayValue: otherTotal,
      normalizedPercentage: otherTotal / total,
      color: renderingContext.getColor("text-light"),
      isOther: true,
      noHover: false,
      includeInLegend: true,
      children: [],
    });
  }

  // We increase the size of small slices, otherwise they will not be visible
  // in echarts due to the border rendering over the tiny slice
  function resizeSmallSlices(slices: PieSliceData[]) {
    slices.forEach(slice => {
      if (slice.normalizedPercentage < OTHER_SLICE_MIN_PERCENTAGE) {
        slice.value = total * OTHER_SLICE_MIN_PERCENTAGE;
      }
      resizeSmallSlices(slice.children.map(slice => slice.data));
    });
  }
  resizeSmallSlices(slices);

  // If there are no non-zero slices, we'll display a single "other" slice
  if (slices.length === 0) {
    sliceTree.set(OTHER_SLICE_KEY, {
      key: OTHER_SLICE_KEY,
      name: OTHER_SLICE_KEY,
      value: otherTotal,
      color: renderingContext.getColor("text-light"),
      children: new Map(),
      legendHoverIndex: slices.length,
      isOther: true,
    });

    slices.push({
      key: OTHER_SLICE_KEY,
      name: OTHER_SLICE_KEY,
      value: 1,
      displayValue: 0,
      normalizedPercentage: 0,
      color: renderingContext.getColor("text-light"),
      isOther: true,
      noHover: true,
      includeInLegend: false,
      children: [],
    });
  }

  return {
    slices: d3Pie(slices), // TODO replace with just sliceTree, get the d3 data in there somehow
    otherSlices: d3Pie(others),
    sliceTree,
    total,
    colDescs,
  };
}
