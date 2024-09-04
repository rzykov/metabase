import { aliases, colors } from "metabase/lib/colors";
import { checkNumber } from "metabase/lib/types";
import type {
  ComputedVisualizationSettings,
  RenderingContext,
} from "metabase/visualizations/types";

const ACCENT_KEY_PREFIX = "accent";
function getAccentNumberFromHex(hexColor: string) {
  const hexToAccentNumber = new Map<string, number>();

  for (const [key, hex] of Object.entries(colors)) {
    if (!key.startsWith(ACCENT_KEY_PREFIX)) {
      continue;
    }

    const accentNumber = checkNumber(
      Number(key.slice(ACCENT_KEY_PREFIX.length)),
    );

    hexToAccentNumber.set(hex, accentNumber);
  }

  for (const [key, hexGetter] of Object.entries(aliases)) {
    if (!key.startsWith(ACCENT_KEY_PREFIX)) {
      continue;
    }

    const accentNumber = checkNumber(
      Number(key.slice(ACCENT_KEY_PREFIX.length, ACCENT_KEY_PREFIX.length + 1)),
    );
    const hex = hexGetter(colors); // TODO make sure this works with white labeling

    hexToAccentNumber.set(hex, accentNumber);
  }

  return hexToAccentNumber.get(hexColor);
}

export function getColorForRing(
  hexColor: string,
  ring: "inner" | "middle" | "outer",
  settings: ComputedVisualizationSettings,
  renderingContext: RenderingContext,
) {
  if (settings["pie.middle_dimension"] == null) {
    return hexColor;
  }

  const accentNumber = getAccentNumberFromHex(hexColor);

  let suffix = "";
  if (ring === "inner") {
    suffix = "-dark";
  } else if (ring === "outer") {
    suffix = "-light";
  }

  return renderingContext.getColor(
    `${ACCENT_KEY_PREFIX}${accentNumber}${suffix}`,
  );
}
