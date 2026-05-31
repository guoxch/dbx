export interface HitTestResult {
  rowIndex: number | null;
  colIndex: number | null;
  /** Whether the click is on the header row */
  isHeader: boolean;
  /** Whether the click is on the row number column */
  isRowNum: boolean;
  /** Whether the click is on a column resize handle */
  isResizeHandle: boolean;
  /** If isResizeHandle, the column index being resized */
  resizeColIndex: number | null;
}

export interface HitTestOptions {
  x: number;
  y: number;
  columnWidths: number[];
  rowHeight: number;
  headerHeight: number;
  scrollTop: number;
  scrollLeft: number;
  totalRows: number;
  rowNumWidth?: number;
  resizeHandleWidth?: number;
}

export function hitTest(options: HitTestOptions): HitTestResult {
  const {
    x,
    y,
    columnWidths,
    rowHeight,
    headerHeight,
    scrollTop,
    scrollLeft,
    totalRows,
    rowNumWidth = 48,
    resizeHandleWidth = 3,
  } = options;

  const isHeader = y < headerHeight;
  const isRowNum = x < rowNumWidth;

  // Row index — subtract headerHeight because data rows start below the header
  const dataY = y + scrollTop - headerHeight;
  const rawRow = dataY >= 0 ? Math.floor(dataY / rowHeight) : -1;
  const rowIndex = isHeader ? null : rawRow >= 0 && rawRow < totalRows ? rawRow : null;

  // Column index - walk through columns accounting for xOffset
  let runningX = rowNumWidth - scrollLeft;
  let colIndex: number | null = null;
  let isResizeHandle = false;
  let resizeColIndex: number | null = null;

  for (let i = 0; i < columnWidths.length; i++) {
    const width = columnWidths[i] ?? 0;
    const colEnd = runningX + width;

    if (x >= runningX && x < colEnd) {
      // Check if near right edge (resize handle zone)
      if (isHeader && x >= colEnd - resizeHandleWidth) {
        isResizeHandle = true;
        resizeColIndex = i;
      }
      colIndex = i;
      break;
    }

    runningX = colEnd;
  }

  return {
    rowIndex,
    colIndex,
    isHeader,
    isRowNum,
    isResizeHandle,
    resizeColIndex,
  };
}

/**
 * Compute cell bounding rect in canvas coordinates for overlay positioning.
 */
export function cellRect(
  rowIndex: number,
  colIndex: number,
  columnWidths: number[],
  rowHeight: number,
  headerHeight: number,
  scrollTop: number,
  scrollLeft: number,
  rowNumWidth = 48,
): { x: number; y: number; width: number; height: number } {
  let x = rowNumWidth - scrollLeft;
  for (let i = 0; i < colIndex; i++) {
    x += columnWidths[i] ?? 0;
  }
  const width = columnWidths[colIndex] ?? 0;
  const y = headerHeight + rowIndex * rowHeight - scrollTop;

  return { x, y, width, height: rowHeight };
}
