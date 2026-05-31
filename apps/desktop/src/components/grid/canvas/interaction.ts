import { hitTest, type HitTestOptions } from "./hitTest";

export interface CanvasInteractionState {
  /** Whether the user is currently dragging to resize a column */
  resizing: boolean;
  /** Column index being resized */
  resizeColIndex: number | null;
  /** Starting X position of the resize */
  resizeStartX: number;
  /** Starting width of the column being resized */
  resizeStartWidth: number;
  /** Whether the left mouse button is pressed (for cell selection drag) */
  selecting: boolean;
  /** Anchor cell for range selection */
  selectAnchor: { row: number; col: number } | null;
}

export function createInteractionState(): CanvasInteractionState {
  return {
    resizing: false,
    resizeColIndex: null,
    resizeStartX: 0,
    resizeStartWidth: 0,
    selecting: false,
    selectAnchor: null,
  };
}

export interface CanvasEventHandlers {
  onCellClick: (row: number, col: number, shiftKey: boolean, metaKey: boolean) => void;
  onHeaderClick: (col: number, shiftKey: boolean) => void;
  onRowNumClick: (row: number, shiftKey: boolean, metaKey: boolean) => void;
  onContextMenu: (row: number | null, col: number | null, x: number, y: number, isHeader: boolean) => void;
  onResizeStart: (colIndex: number) => void;
  onResizeMove: (colIndex: number, deltaX: number) => void;
  onResizeEnd: () => void;
  onHover: (row: number | null, col: number | null) => void;
  onDoubleClick: (row: number, col: number) => void;
  onSelectDrag: (row: number, col: number) => void;
}

export interface SetupCanvasEventsOptions {
  canvas: HTMLCanvasElement;
  hitTestOptions: () => HitTestOptions;
  handlers: CanvasEventHandlers;
  getResizing: () => boolean;
  setResizing: (v: boolean) => void;
}

export function setupCanvasEvents(options: SetupCanvasEventsOptions) {
  const { canvas, hitTestOptions, handlers, getResizing, setResizing } = options;

  function getHit(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return hitTest({ ...hitTestOptions(), x, y });
  }

  function getCursorStyle(e: MouseEvent): string {
    const hit = getHit(e);
    if (hit.isResizeHandle) return "col-resize";
    if (getResizing()) return "col-resize";
    return "default";
  }

  canvas.addEventListener("mousemove", (e) => {
    canvas.style.cursor = getCursorStyle(e);

    if (getResizing()) {
      const deltaX = e.clientX - (resizeStartState.clientX ?? 0);
      const resizeCol = resizeStartState.colIndex;
      if (resizeCol !== null) {
        handlers.onResizeMove(resizeCol, deltaX);
      }
      return;
    }

    const hit = getHit(e);
    handlers.onHover(hit.rowIndex, hit.colIndex);
  });

  let resizeStartState = { clientX: 0, colIndex: null as number | null };

  canvas.addEventListener("mousedown", (e) => {
    const hit = getHit(e);
    if (hit.isResizeHandle && hit.resizeColIndex !== null) {
      e.preventDefault();
      setResizing(true);
      resizeStartState = { clientX: e.clientX, colIndex: hit.resizeColIndex };
      handlers.onResizeStart(hit.resizeColIndex);
      return;
    }

    if (hit.isHeader && hit.colIndex !== null) {
      handlers.onHeaderClick(hit.colIndex, e.shiftKey);
      return;
    }

    if (hit.isRowNum && hit.rowIndex !== null) {
      handlers.onRowNumClick(hit.rowIndex, e.shiftKey, e.metaKey || e.ctrlKey);
      return;
    }

    if (hit.rowIndex !== null && hit.colIndex !== null) {
      handlers.onCellClick(hit.rowIndex, hit.colIndex, e.shiftKey, e.metaKey || e.ctrlKey);
    }
  });

  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const hit = getHit(e);
    handlers.onContextMenu(hit.rowIndex, hit.colIndex, e.clientX, e.clientY, hit.isHeader);
  });

  canvas.addEventListener("dblclick", (e) => {
    const hit = getHit(e);
    if (hit.rowIndex !== null && hit.colIndex !== null) {
      handlers.onDoubleClick(hit.rowIndex, hit.colIndex);
    }
  });

  canvas.addEventListener("mouseleave", () => {
    if (!getResizing()) {
      handlers.onHover(null, null);
    }
  });

  document.addEventListener("mouseup", () => {
    if (getResizing()) {
      setResizing(false);
      handlers.onResizeEnd();
    }
  });
}
