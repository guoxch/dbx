export interface TextLayoutResult {
  text: string;
  width: number;
  truncated: boolean;
}

/**
 * Measure text width using a canvas 2D context.
 * Handles DPI scaling internally via the context's current transform.
 */
export function measureTextWidth(ctx: CanvasRenderingContext2D, text: string): number {
  return ctx.measureText(text).width;
}

/**
 * Truncate text to fit within maxWidth, appending an ellipsis if truncated.
 * Uses binary search for efficiency.
 */
export function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): TextLayoutResult {
  const fullWidth = measureTextWidth(ctx, text);
  if (fullWidth <= maxWidth) {
    return { text, width: fullWidth, truncated: false };
  }
  if (maxWidth <= 0) {
    return { text: "", width: 0, truncated: true };
  }

  const ellipsis = "…";
  const ellipsisWidth = measureTextWidth(ctx, ellipsis);
  const availableWidth = maxWidth - ellipsisWidth;
  if (availableWidth <= 0) {
    return { text: ellipsis, width: ellipsisWidth, truncated: true };
  }

  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const w = measureTextWidth(ctx, text.slice(0, mid));
    if (w <= availableWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  const truncated = text.slice(0, lo) + ellipsis;
  return { text: truncated, width: measureTextWidth(ctx, truncated), truncated: true };
}

/**
 * Canvas font string matching the grid's DOM font.
 * 12px system-ui, matching DataGrid's text-xs + font-family.
 */
export const GRID_FONT =
  '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const GRID_FONT_ITALIC = `italic ${GRID_FONT}`;

export function setGridFont(ctx: CanvasRenderingContext2D, italic = false) {
  ctx.font = italic ? GRID_FONT_ITALIC : GRID_FONT;
}

export const CELL_PADDING_X = 12; // matches px-3
