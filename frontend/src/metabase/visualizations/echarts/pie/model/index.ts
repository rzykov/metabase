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
import { getDimensionFormatter } from "../format";

import type {
  PieChartModel,
  PieColumnDescriptors,
  SliceTree,
  SliceTreeNode,
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

  // Create sliceTree, fill out first layer, the innermost slices based on
  // "pie.dimension"
  const sliceTree: SliceTree = new Map();
  const [sliceTreeNodes, others] = _.chain(pieRowsWithValues)
    .map(({ value, color, key, name, isOther }, index) => ({
      key,
      name,
      value,
      displayValue: value,
      normalizedPercentage: value / total, // slice percentage values are normalized to 0-1 scale
      color,
      children: new Map(),
      column: colDescs.dimensionDesc.column,
      rowIndex: checkNotNull(rowIndiciesByKey.get(key)),
      legendHoverIndex: index,
      isOther,
      startAngle: 0, // placeholders
      endAngle: 0,
    }))
    .filter(slice => isNonPositive || slice.value > 0)
    .partition(slice => slice != null && !slice.isOther)
    .value();
  //

  // We don't show the grey other slice if there isn't more than one slice to
  // group into it
  if (others.length === 1) {
    const singleOtherSlice = others.pop();
    sliceTreeNodes.push(checkNotNull(singleOtherSlice));
  }

  sliceTreeNodes.forEach(node => {
    // Map key needs to be string, because we use it for lookup with values from
    // echarts, and echarts casts numbers to strings
    sliceTree.set(String(node.key), node);
  });

  // Iterate through non-aggregated rows from query result to build layers for
  // the middle and outer ring slices.
  if (colDescs.middleDimensionDesc != null) {
    const formatMiddleDimensionValue = getDimensionFormatter(
      settings,
      colDescs.middleDimensionDesc.column,
      renderingContext.formatValue,
    );

    const formatOuterDimensionValue =
      colDescs.outerDimensionDesc?.column != null
        ? getDimensionFormatter(
            settings,
            colDescs.outerDimensionDesc.column,
            renderingContext.formatValue,
          )
        : undefined;

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
          name: formatMiddleDimensionValue(
            row[colDescs.middleDimensionDesc.index],
          ),
          value: metricValue,
          displayValue: metricValue,
          normalizedPercentage: metricValue / total,
          color: dimensionNode.color, // TODO use light/dark color
          column: colDescs.middleDimensionDesc.column,
          rowIndex: index,
          children: new Map(),
          startAngle: 0,
          endAngle: 0,
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
          name:
            formatOuterDimensionValue?.(
              row[colDescs.outerDimensionDesc.index],
            ) ?? "",
          value: metricValue,
          displayValue: metricValue,
          normalizedPercentage: metricValue / total,
          color: dimensionNode.color, // TODO use light/dark color
          column: colDescs.outerDimensionDesc.column,
          rowIndex: index,
          children: new Map(),
          startAngle: 0,
          endAngle: 0,
        };
        middleDimensionNode.children.set(
          String(outerDimensionKey),
          outerDimensionNode,
        );
      } else {
        outerDimensionNode.value += metricValue;
      }
    });
  }

  // Only add "other" slice if there are slices below threshold with non-zero total
  const otherTotal = others.reduce((currTotal, o) => currTotal + o.value, 0);
  if (otherTotal > 0) {
    const children: SliceTree = new Map();
    others.forEach(node => {
      children.set(String(node.key), node);
    });

    sliceTree.set(OTHER_SLICE_KEY, {
      key: OTHER_SLICE_KEY,
      name: OTHER_SLICE_KEY,
      value: otherTotal,
      displayValue: otherTotal,
      normalizedPercentage: otherTotal / total,
      color: renderingContext.getColor("text-light"),
      children,
      legendHoverIndex: sliceTree.size,
      isOther: true,
      startAngle: 0,
      endAngle: 0,
    });
  }

  // We need start and end angles for the label formatter, to determine if we
  // should the percent label on the chart for a specific slice. To get these we
  // need to use d3.
  // TODO recursively apply this to other rings
  const d3Pie = pie<SliceTreeNode>()
    .sort(null)
    // 1 degree in radians
    .padAngle((Math.PI / 180) * 1)
    .value(s => s.value);

  const d3Slices = d3Pie(Array(...sliceTreeNodes.values()));
  d3Slices.forEach((d3Slice, index) => {
    sliceTreeNodes[index].startAngle = d3Slice.startAngle;
    sliceTreeNodes[index].endAngle = d3Slice.endAngle;
  });

  // We increase the size of small slices, otherwise they will not be visible
  // in echarts due to the border rendering over the tiny slice
  function resizeSmallSlices(slices: SliceTreeNode[]) {
    slices.forEach(slice => {
      if (slice.normalizedPercentage < OTHER_SLICE_MIN_PERCENTAGE) {
        slice.value = total * OTHER_SLICE_MIN_PERCENTAGE;
      }
      resizeSmallSlices(Array(...slice.children.values()));
    });
  }
  resizeSmallSlices(Array(...sliceTree.values()));

  // If there are no non-zero slices, we'll display a single "other" slice
  if (sliceTree.size === 0) {
    sliceTree.set(OTHER_SLICE_KEY, {
      key: OTHER_SLICE_KEY,
      name: OTHER_SLICE_KEY,
      value: 1,
      displayValue: 0,
      normalizedPercentage: 0,
      color: renderingContext.getColor("text-light"),
      children: new Map(),
      legendHoverIndex: 0,
      isOther: true,
      noHover: true,
      includeInLegend: false,
      startAngle: 0,
      endAngle: 1,
    });
  }

  return {
    sliceTree,
    total,
    colDescs,
  };
}
