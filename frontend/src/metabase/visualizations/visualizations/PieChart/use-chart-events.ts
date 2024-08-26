import type { EChartsType } from "echarts/core";
import { type MutableRefObject, useEffect, useMemo } from "react";
import { t } from "ttag";
import _ from "underscore";

import { formatPercent } from "metabase/static-viz/lib/numbers";
import type {
  EChartsTooltipModel,
  EChartsTooltipRow,
} from "metabase/visualizations/components/ChartTooltip/EChartsTooltip";
import {
  getPercent,
  getTotalValue,
} from "metabase/visualizations/components/ChartTooltip/StackedDataTooltip/utils";
import type { PieChartFormatters } from "metabase/visualizations/echarts/pie/format";
import type { PieChartModel } from "metabase/visualizations/echarts/pie/model/types";
import type { EChartsSunburstSeriesMouseEvent } from "metabase/visualizations/echarts/pie/types";
import {
  getMarkerColorClass,
  useClickedStateTooltipSync,
} from "metabase/visualizations/echarts/tooltip";
import { getFriendlyName } from "metabase/visualizations/lib/utils";
import type {
  ClickObject,
  VisualizationProps,
} from "metabase/visualizations/types";
import type { EChartsEventHandler } from "metabase/visualizations/types/echarts";

export const getTooltipModel = (
  dataIndex: number,
  chartModel: PieChartModel,
  formatters: PieChartFormatters,
): EChartsTooltipModel => {
  const hoveredIndex = dataIndexToHoveredIndex(dataIndex);
  const hoveredOther =
    chartModel.slices[hoveredIndex].data.isOther &&
    chartModel.otherSlices.length > 1;

  const rows = (hoveredOther ? chartModel.otherSlices : chartModel.slices).map(
    slice => ({
      name: slice.data.name,
      value: slice.data.displayValue,
      color: hoveredOther ? undefined : slice.data.color,
      formatter: formatters.formatMetric,
    }),
  );

  const rowsTotal = getTotalValue(rows);
  const isShowingTotalSensible = rows.length > 1;

  const formattedRows: EChartsTooltipRow[] = rows.map((row, index) => {
    const markerColorClass = row.color
      ? getMarkerColorClass(row.color)
      : undefined;
    return {
      isFocused: !hoveredOther && index === hoveredIndex,
      markerColorClass,
      name: row.name,
      values: [
        row.formatter(row.value),
        formatPercent(getPercent(chartModel.total, row.value) ?? 0),
      ],
    };
  });

  return {
    header: getFriendlyName(chartModel.colDescs.dimensionDesc.column),
    rows: formattedRows,
    footer: isShowingTotalSensible
      ? {
          name: t`Total`,
          values: [
            formatters.formatMetric(rowsTotal),
            formatPercent(getPercent(chartModel.total, rowsTotal) ?? 0),
          ],
        }
      : undefined,
  };
};

const dataIndexToHoveredIndex = (index: number) => index - 1;

function getHoverData(
  event: EChartsSunburstSeriesMouseEvent,
  chartModel: PieChartModel,
) {
  if (event.dataIndex == null) {
    return null;
  }

  const pieSliceKeyPath = event.treePathInfo.slice(1).map(info => info.name);

  const dimensionNode = chartModel.sliceTree.get(pieSliceKeyPath[0]);
  if (dimensionNode == null) {
    throw Error(`Could not find dimensionNode for key ${pieSliceKeyPath[0]}`);
  }

  return {
    index: dimensionNode.index,
    event: event.event.event,
    pieSliceKeyPath,
  };
}

function handleClick(
  event: EChartsSunburstSeriesMouseEvent,
  dataProp: VisualizationProps["data"],
  settings: VisualizationProps["settings"],
  visualizationIsClickable: VisualizationProps["visualizationIsClickable"],
  onVisualizationClick: VisualizationProps["onVisualizationClick"],
  chartModel: PieChartModel,
) {
  if (!event.dataIndex) {
    return;
  }
  const slice = chartModel.slices[dataIndexToHoveredIndex(event.dataIndex)];
  const data =
    slice.data.rowIndex != null
      ? dataProp.rows[slice.data.rowIndex].map((value, index) => ({
          value,
          col: dataProp.cols[index],
        }))
      : undefined;

  const clickObject: ClickObject = {
    value: slice.data.value,
    column: chartModel.colDescs.metricDesc.column,
    data,
    dimensions: [
      {
        value: slice.data.key,
        column: chartModel.colDescs.dimensionDesc.column,
      },
    ],
    settings,
    event: event.event.event,
  };

  if (visualizationIsClickable(clickObject) && !slice.data.isOther) {
    onVisualizationClick(clickObject);
  }
}

export function useChartEvents(
  props: VisualizationProps,
  chartRef: MutableRefObject<EChartsType | undefined>,
  chartModel: PieChartModel,
) {
  const {
    onHoverChange,
    data,
    settings,
    visualizationIsClickable,
    onVisualizationClick,
  } = props;
  const hoveredIndex = props.hovered?.index;
  const chart = chartRef?.current;

  useEffect(
    function higlightChartOnLegendHover() {
      if (chart == null || hoveredIndex == null) {
        return;
      }

      const name = String(chartModel.slices[hoveredIndex].data.key);

      chart.dispatchAction({
        type: "highlight",
        name,
        seriesIndex: 0,
      });

      return () => {
        chart.dispatchAction({
          type: "downplay",
          name,
          seriesIndex: 0,
        });
      };
    },
    [chart, chartModel, hoveredIndex],
  );

  useClickedStateTooltipSync(chartRef.current, props.clicked);

  const eventHandlers: EChartsEventHandler[] = useMemo(
    () => [
      {
        eventName: "mouseout",
        query: "series",
        handler: () => {
          onHoverChange?.(null);
        },
      },
      {
        eventName: "mousemove",
        query: "series",
        handler: (event: EChartsSunburstSeriesMouseEvent) => {
          onHoverChange?.(getHoverData(event, chartModel));
        },
      },
      {
        eventName: "click",
        query: "series",
        handler: (event: EChartsSunburstSeriesMouseEvent) => {
          handleClick(
            event,
            data,
            settings,
            visualizationIsClickable,
            onVisualizationClick,
            chartModel,
          );
        },
      },
    ],
    [
      onHoverChange,
      data,
      settings,
      visualizationIsClickable,
      onVisualizationClick,
      chartModel,
    ],
  );

  return eventHandlers;
}
