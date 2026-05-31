import { setGridFont, truncateText, CELL_PADDING_X } from "./textLayout";
import { type GridColors } from "./colors";
import { displayCellValue, type CellValue } from "@/lib/cellValue";

export interface DrawCellsOptions {
  ctx: CanvasRenderingContext2D;
  rows: CellValue[][];
  columnWidths: number[];
  rowHeight: number;
  headerHeight: number;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
  scrollTop: number;
  xOffset: number;
  colors: GridColors;
  isCellSelected?: (displayRow: number, visibleCol: number) => boolean;
  isCellDirty?: (displayRow: number, sourceCol: number) => boolean;
  isSearchMatch?: (displayRow: number, sourceCol: number) => boolean;
  isCurrentMatch?: (displayRow: number, sourceCol: number) => boolean;
  visibleToSourceCol?: (visibleCol: number) => number;
  rowStatuses?: Map<number, "clean" | "edited" | "deleted" | "new">;
  hoveredRow?: number | null;
  isRowActive?: (displayRow: number) => boolean;
  rowNumWidth?: number;
  /** Format a cell value for display */
  formatValue?: (value: CellValue, columnIndex: number) => string;
}

export function drawCells(options: DrawCellsOptions) {
  const {
    ctx,
    rows,
    columnWidths,
    rowHeight,
    headerHeight,
    startRow,
    endRow,
    startCol,
    endCol,
    scrollTop,
    xOffset,
    colors,
    isCellSelected,
    isCellDirty,
    isSearchMatch,
    isCurrentMatch,
    visibleToSourceCol,
    rowStatuses,
    hoveredRow,
    isRowActive,
    rowNumWidth = 48,
    formatValue,
  } = options;

  const fmt = formatValue ?? displayCellValue;

  // Precompute colors
  const totalRowWidth = rowNumWidth + columnWidths.reduce((s, w) => s + w, 0);
  const selectionFill = `color-mix(in oklab, ${colors.primary} 25%, transparent)`;
  const selectionStroke = `color-mix(in oklab, ${colors.primary} 70%, transparent)`;
  const activeRowFill = `color-mix(in oklab, ${colors.primary} 15%, transparent)`;
  const dirtySelectionFill = `color-mix(in oklab, ${colors.dirty} 30%, color-mix(in oklab, ${colors.primary} 18%, transparent))`;

  // Set default font once
  setGridFont(ctx);
  ctx.textBaseline = "middle";

  for (let rowIdx = startRow; rowIdx < endRow; rowIdx++) {
    const rowData = rows[rowIdx];
    if (!rowData) continue;

    const y = headerHeight + rowIdx * rowHeight - scrollTop;
    const status = rowStatuses?.get(rowIdx);
    const isDeleted = status === "deleted";
    const isNew = status === "new";
    const isActive = isRowActive?.(rowIdx);
    const isHovered = hoveredRow === rowIdx;

    // --- Row background ---
    if (isDeleted) {
      ctx.fillStyle = colors.deletedRow;
      ctx.fillRect(0, y, totalRowWidth, rowHeight);
    } else if (isNew && !isActive) {
      ctx.fillStyle = colors.newRow;
      ctx.fillRect(0, y, totalRowWidth, rowHeight);
    } else if (!isNew && !isActive && rowIdx % 2 === 1) {
      ctx.fillStyle = colors.muted;
      ctx.fillRect(0, y, totalRowWidth, rowHeight);
    }

    if (isActive && !isDeleted) {
      ctx.fillStyle = activeRowFill;
      ctx.fillRect(0, y, totalRowWidth, rowHeight);
    }

    if (isHovered && !isActive) {
      ctx.fillStyle = colors.hover;
      ctx.fillRect(0, y, totalRowWidth, rowHeight);
    }

    // --- Row number cell background ---
    if (status === "new") {
      ctx.fillStyle = `color-mix(in oklab, rgb(16,185,129) 15%, ${colors.background})`; // bg-emerald-500/15
    } else if (status === "edited") {
      ctx.fillStyle = `color-mix(in oklab, rgb(245,158,11) 15%, ${colors.background})`; // bg-amber-500/15
    } else if (status === "deleted") {
      ctx.fillStyle = `color-mix(in oklab, ${colors.primary} 15%, transparent)`;
      // Actually use bg-destructive/15:
      ctx.fillStyle = colors.deletedRow;
    } else {
      ctx.fillStyle = colors.rowNumBg;
    }
    if (isHovered && !isActive) {
      ctx.fillStyle = colors.hover;
    }
    if (isActive && status !== "deleted" && status !== "new" && status !== "edited") {
      ctx.fillStyle = `color-mix(in oklab, ${colors.primary} 25%, transparent)`;
    }
    ctx.fillRect(0, y, rowNumWidth, rowHeight);

    // Row number borders
    ctx.fillStyle = colors.border;
    ctx.fillRect(rowNumWidth - 1, y, 1, rowHeight); // right border
    ctx.fillRect(0, y + rowHeight - 1, totalRowWidth, 1); // bottom border

    // Row number text
    setGridFont(ctx);
    if (status === "new") {
      ctx.fillStyle = "rgb(4,120,87)"; // text-emerald-700
    } else if (status === "edited") {
      ctx.fillStyle = "rgb(180,83,9)"; // text-amber-700
    } else if (status === "deleted") {
      ctx.fillStyle = colors.mutedForeground;
    } else if (isActive) {
      ctx.fillStyle = colors.primary;
    } else {
      ctx.fillStyle = colors.mutedForeground;
    }
    ctx.textAlign = "center";
    ctx.fillText(String(rowIdx + 1), rowNumWidth / 2, y + rowHeight / 2);
    ctx.textAlign = "start";

    // --- Data cells ---
    let cellX = rowNumWidth - xOffset;
    for (let colIdx = startCol; colIdx < endCol; colIdx++) {
      const width = columnWidths[colIdx] ?? 0;
      if (width <= 0) continue;

      const cellValue: CellValue = rowData[colIdx] ?? null;
      const isSelected = isCellSelected?.(rowIdx, colIdx) ?? false;
      const sourceCol = visibleToSourceCol?.(colIdx) ?? colIdx;
      const dirty = isCellDirty?.(rowIdx, sourceCol) ?? false;
      const searchHit = isSearchMatch?.(rowIdx, sourceCol) ?? false;
      const currentHit = isCurrentMatch?.(rowIdx, sourceCol) ?? false;

      // Cell background
      if (currentHit) {
        ctx.fillStyle = colors.searchMatchCurrent;
        ctx.fillRect(cellX, y, width, rowHeight - 1);
      } else if (searchHit) {
        ctx.fillStyle = colors.searchMatch;
        ctx.fillRect(cellX, y, width, rowHeight - 1);
      } else if (dirty && isSelected) {
        ctx.fillStyle = dirtySelectionFill;
        ctx.fillRect(cellX, y, width, rowHeight - 1);
        ctx.strokeStyle = selectionStroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(cellX + 0.5, y + 0.5, width - 1, rowHeight - 2);
      } else if (dirty) {
        ctx.fillStyle = colors.dirty;
        ctx.fillRect(cellX, y, width, rowHeight - 1);
      } else if (isSelected) {
        ctx.fillStyle = selectionFill;
        ctx.fillRect(cellX, y, width, rowHeight - 1);
        ctx.strokeStyle = selectionStroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(cellX + 0.5, y + 0.5, width - 1, rowHeight - 2);
      }

      // Right border
      ctx.fillStyle = colors.border;
      ctx.fillRect(cellX + width - 1, y, 1, rowHeight - 1);

      // Cell text
      const isNull = cellValue === null;
      const text = fmt(cellValue, colIdx);
      const maxTextWidth = width - CELL_PADDING_X * 2;
      const label = maxTextWidth > 0 ? truncateText(ctx, text, maxTextWidth) : { text: "", width: 0, truncated: false };

      if (isNull || isDeleted) {
        ctx.fillStyle = colors.mutedForeground;
        if (isNull) setGridFont(ctx, true);
        else setGridFont(ctx);
      } else {
        ctx.fillStyle = colors.foreground;
        setGridFont(ctx);
      }

      ctx.fillText(label.text, cellX + CELL_PADDING_X, y + rowHeight / 2);

      cellX += width;
    }
  }
}
