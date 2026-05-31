import { ref, onUnmounted, type Ref } from "vue";

export interface CanvasGridState {
  canvasRef: Ref<HTMLCanvasElement | undefined>;
  ctx: Ref<CanvasRenderingContext2D | null>;
  dpr: number;
  scrollTop: Ref<number>;
  scrollLeft: Ref<number>;
  viewportWidth: Ref<number>;
  viewportHeight: Ref<number>;
  hoveredRow: Ref<number | null>;
  hoveredCol: Ref<number | null>;
  dirty: Ref<boolean>;
  rowHeight: number;
  headerHeight: number;
  overscanRows: number;
  scheduleRedraw: () => void;
  initCanvas: (canvas: HTMLCanvasElement) => void;
  updateViewport: (width: number, height: number) => void;
  setRedrawCallback: (cb: () => void) => void;
  visibleRowRange: (totalRows: number) => { startRow: number; endRow: number };
  visibleColRange: (totalCols: number, columnWidths: number[]) => { startCol: number; endCol: number; xOffset: number };
}

export interface CanvasGridOptions {
  rowHeight?: number;
  headerHeight?: number;
  overscanRows?: number;
}

const DEFAULT_ROW_HEIGHT = 26;
const DEFAULT_HEADER_HEIGHT = 28;
const DEFAULT_OVERSCAN_ROWS = 8;

export function useCanvasGrid(options: CanvasGridOptions = {}): CanvasGridState {
  const rowHeight = options.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const headerHeight = options.headerHeight ?? DEFAULT_HEADER_HEIGHT;
  const overscanRows = options.overscanRows ?? DEFAULT_OVERSCAN_ROWS;

  const canvasRef = ref<HTMLCanvasElement | undefined>();
  const ctx = ref<CanvasRenderingContext2D | null>(null);
  const dpr = window.devicePixelRatio || 1;
  const scrollTop = ref(0);
  const scrollLeft = ref(0);
  const viewportWidth = ref(0);
  const viewportHeight = ref(0);
  const hoveredRow = ref<number | null>(null);
  const hoveredCol = ref<number | null>(null);
  const dirty = ref(false);

  let rafId = 0;
  let redrawCallback: (() => void) | null = null;

  function initCanvas(canvas: HTMLCanvasElement) {
    canvasRef.value = canvas;
    ctx.value = canvas.getContext("2d");
  }

  function updateViewport(width: number, height: number) {
    viewportWidth.value = width;
    viewportHeight.value = height;
    const c = canvasRef.value;
    if (c) {
      c.style.width = `${width}px`;
      c.style.height = `${height}px`;
      c.width = width * dpr;
      c.height = height * dpr;
      const context = ctx.value;
      if (context) {
        context.scale(dpr, dpr);
      }
    }
    scheduleRedraw();
  }

  function scheduleRedraw() {
    dirty.value = true;
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (dirty.value && redrawCallback) {
        dirty.value = false;
        redrawCallback();
      }
    });
  }

  function setRedrawCallback(cb: () => void) {
    redrawCallback = cb;
  }

  onUnmounted(() => {
    if (rafId) cancelAnimationFrame(rafId);
  });

  function visibleRowRange(totalRows: number) {
    const startRow = Math.max(0, Math.floor(scrollTop.value / rowHeight) - overscanRows);
    const visibleCount = Math.ceil(viewportHeight.value / rowHeight);
    const endRow = Math.min(totalRows, startRow + visibleCount + overscanRows * 2);
    return { startRow, endRow };
  }

  function visibleColRange(
    totalCols: number,
    columnWidths: number[],
  ): { startCol: number; endCol: number; xOffset: number } {
    let xOffset = 0;
    let startCol = 0;
    while (startCol < totalCols && xOffset + (columnWidths[startCol] ?? 0) <= scrollLeft.value) {
      xOffset += columnWidths[startCol] ?? 0;
      startCol++;
    }
    let endCol = startCol;
    let visibleWidth = xOffset;
    while (endCol < totalCols && visibleWidth < scrollLeft.value + viewportWidth.value + 100) {
      visibleWidth += columnWidths[endCol] ?? 0;
      endCol++;
    }
    return { startCol, endCol: Math.min(totalCols, endCol), xOffset };
  }

  return {
    canvasRef,
    ctx,
    dpr,
    scrollTop,
    scrollLeft,
    viewportWidth,
    viewportHeight,
    hoveredRow,
    hoveredCol,
    dirty,
    scheduleRedraw,
    initCanvas,
    updateViewport,
    rowHeight,
    headerHeight,
    overscanRows,
    visibleRowRange,
    visibleColRange,
    setRedrawCallback,
  };
}
