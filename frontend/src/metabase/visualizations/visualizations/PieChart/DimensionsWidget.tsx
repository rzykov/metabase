import { DndContext, PointerSensor, useSensor } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useState } from "react";
import { t } from "ttag";

import { Sortable } from "metabase/core/components/Sortable";
import { Button, Text } from "metabase/ui";
import ChartSettingFieldPicker from "metabase/visualizations/components/settings/ChartSettingFieldPicker";
import { getOptionFromColumn } from "metabase/visualizations/lib/settings/utils";
import type { ComputedVisualizationSettings } from "metabase/visualizations/types";
import { isDimension } from "metabase-lib/v1/types/utils/isa";
import type { RawSeries } from "metabase-types/api";

import Styles from "./DimensionsWidget.modules.css";
import { PieRowsPicker } from "./PieRowsPicker";

function DimensionPicker({
  value,
  options,
  onChange,
  onRemove,
  showDragHandle,
}: {
  value: string | undefined;
  options: { name: string; value: string }[];
  onChange: (value: string) => void;
  onRemove: (() => void) | undefined;
  showDragHandle: boolean;
}) {
  return (
    <ChartSettingFieldPicker
      value={value}
      options={options}
      columnHasSettings={() => false}
      onChange={onChange}
      onRemove={onRemove}
      showColorPicker={false}
      showColumnSetting={false}
      className={Styles.dimensionPicker}
      colors={undefined}
      series={undefined}
      columns={undefined}
      onShowWidget={() => {}}
      onChangeSeriesColor={() => {}}
      showDragHandle={showDragHandle}
    />
  );
}

const DIMENSION_SETTING_KEYS = [
  "pie.dimension",
  "pie.middle_dimension",
  "pie.outer_dimension",
];

const DIMENSION_SETTING_TITLES = [t`Inner Ring`, t`Middle Ring`, t`Outer Ring`];

export function DimensionsWidget({
  rawSeries,
  settings,
  onChangeSettings,
  onShowWidget,
}: {
  rawSeries: RawSeries;
  settings: ComputedVisualizationSettings;
  onChangeSettings: (newSettings: ComputedVisualizationSettings) => void;
  onShowWidget: (widget: any, ref: any) => void;
}) {
  // Dimension settings
  const [dimensions, setDimensions] = useState<(string | undefined)[]>(() =>
    DIMENSION_SETTING_KEYS.map(settingsKey => settings[settingsKey]).filter(
      value => value != null,
    ),
  );

  const updateDimensions = (newDimensions: (string | undefined)[]) => {
    setDimensions(newDimensions);

    const newSettings: Record<string, string | undefined> = {};

    DIMENSION_SETTING_KEYS.forEach(
      (settingsKey, index) =>
        (newSettings[settingsKey] =
          index < newDimensions.length ? newDimensions[index] : undefined),
    );
    onChangeSettings(newSettings);
  };

  const onChangeDimension = (index: number) => (newValue: string) => {
    const newDimensions = [...dimensions];
    newDimensions[index] = newValue;

    updateDimensions(newDimensions);
  };

  const onRemove = (index: number) => () => {
    const newDimensions = [...dimensions];
    newDimensions.splice(index, 1);

    updateDimensions(newDimensions);
  };

  // Dropdown options
  const dimensionOptions = rawSeries[0].data.cols
    .filter(isDimension)
    .map(getOptionFromColumn);

  const getOptionsFilter =
    (settingsKey: string) => (option: { name: string; value: string }) =>
      settings[settingsKey] == null || option.value !== settings[settingsKey];

  // Drag and drop
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 15 },
  });
  const [showPieRows, setShowPieRows] = useState(true);

  return (
    <>
      <DndContext
        onDragStart={() => setShowPieRows(false)}
        onDragEnd={() => setShowPieRows(true)} // TODO
        modifiers={[restrictToVerticalAxis]}
        sensors={[pointerSensor]}
      >
        <SortableContext
          items={dimensions.filter(d => d != null).map(d => ({ id: d }))}
          strategy={verticalListSortingStrategy}
        >
          {dimensions.map((dimension, index) => {
            const optionsFilters = DIMENSION_SETTING_KEYS.map(
              (settingsKey, settingsKeyIndex) =>
                settingsKeyIndex !== index
                  ? getOptionsFilter(settingsKey)
                  : null,
            ).filter(f => f != null);

            let options = dimensionOptions;
            optionsFilters.forEach(f => (options = options.filter(f)));

            return (
              <>
                <Text weight="bold" mb="sm">
                  {DIMENSION_SETTING_TITLES[index]}
                </Text>
                <Sortable
                  key={String(dimension)}
                  id={String(dimension)}
                  disabled={dimension == null}
                  draggingStyle={{ opacity: 0.5 }}
                >
                  <DimensionPicker
                    key={dimension}
                    value={dimension}
                    onChange={onChangeDimension(index)}
                    onRemove={
                      dimensions.length > 1 ? onRemove(index) : undefined
                    }
                    options={options}
                    showDragHandle={dimensions.length > 1 && dimension != null}
                  />
                </Sortable>

                {index === 0 && showPieRows && (
                  <PieRowsPicker
                    rawSeries={rawSeries}
                    settings={settings}
                    onChangeSettings={onChangeSettings}
                    onShowWidget={onShowWidget}
                  />
                )}
              </>
            );
          })}
        </SortableContext>
      </DndContext>
      {dimensions.length < 3 && dimensions[dimensions.length - 1] != null && (
        <Button
          variant="subtle"
          onClick={() => setDimensions([...dimensions, undefined])}
        >{t`Add Ring`}</Button>
      )}
    </>
  );
}
