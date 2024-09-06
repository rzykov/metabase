import type { ComputedVisualizationSettings } from "metabase/visualizations/types";
import type { RawSeries } from "metabase-types/api";

export function DimensionsWidget({
  rawSeries,
  settings,
}: {
  rawSeries: RawSeries;
  settings: ComputedVisualizationSettings;
  onChangeSettings: (newSettings: ComputedVisualizationSettings) => void;
}) {
  return (
    <div>
      {JSON.stringify(rawSeries)}
      {JSON.stringify(settings)}
    </div>
  );
}
