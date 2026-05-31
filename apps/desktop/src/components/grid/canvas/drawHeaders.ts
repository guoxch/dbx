import { setGridFont, truncateText, CELL_PADDING_X } from "./textLayout";
import { type GridColors } from "./colors";

export interface DrawHeadersOptions {
  ctx: CanvasRenderingContext2D;
  columns: string[];
  columnWidths: number[];
  headerHeight: number;
  startCol: number;
  endCol: number;
  xOffset: number;
  colors: GridColors;
  rowNumWidth?: number;
}

export function drawHeaders(options: DrawHeadersOptions) {
  const { ctx, columns, columnWidths, headerHeight, startCol, endCol, xOffset, colors, rowNumWidth = 48 } = options;

  // Header background
  ctx.fillStyle = colors.headerBg;
  ctx.fillRect(0, 0, rowNumWidth + columnWidths.reduce((s, w) => s + w, 0), headerHeight);

  // Bottom border
  ctx.fillStyle = colors.border;
  ctx.fillRect(0, headerHeight - 1, rowNumWidth + columnWidths.reduce((s, w) => s + w, 0), 1);

  // Row number column header
  ctx.fillStyle = colors.border;
  ctx.fillRect(rowNumWidth - 1, 0, 1, headerHeight);

  setGridFont(ctx);
  ctx.fillStyle = colors.headerFg;
  ctx.textBaseline = "middle";

  // Column headers
  let cellX = rowNumWidth - xOffset;
  for (let colIdx = startCol; colIdx < endCol; colIdx++) {
    const width = columnWidths[colIdx] ?? 0;
    if (width <= 0) continue;

    const colName = columns[colIdx] ?? "";

    // Right border
    ctx.fillStyle = colors.border;
    ctx.fillRect(cellX + width - 1, 0, 1, headerHeight);

    // Header text
    ctx.fillStyle = colors.headerFg;
    const maxTextWidth = width - CELL_PADDING_X * 2 - 4; // leave room for resize handle
    const label =
      maxTextWidth > 0 ? truncateText(ctx, colName, maxTextWidth) : { text: "", width: 0, truncated: false };
    ctx.fillText(label.text, cellX + CELL_PADDING_X, headerHeight / 2);

    cellX += width;
  }
}
