<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { useElementSize } from "@vueuse/core";
import { useCanvasGrid } from "@/composables/useCanvasGrid";
import { drawCells } from "./drawCells";
import { setupCanvasEvents } from "./interaction";
import { cellRect, type HitTestOptions } from "./hitTest";
import { resolveGridColors } from "./colors";
import { displayCellValue, type CellValue } from "@/lib/cellValue";
import { scrollbarGutterWidth } from "@/lib/dataGridScrollGutter";
import { Info } from "lucide-vue-next";

interface RowItem {
  id: number;
  sourceIndex?: number;
  newIndex?: number;
  data: CellValue[];
  isNew: boolean;
  isDeleted: boolean;
  isDirtyCol: boolean[];
  status: string;
  displayIndex: number;
}

interface SearchMatch {
  displayRow: number;
  col: number;
}

const props = defineProps<{
  columns: string[];
  displayItems: RowItem[];
  columnWidths: number[];
  actualColumnIndexes?: number[];
  rowNumWidth?: number;
  isDark?: boolean;
  selectedRange?: { startRow: number; endRow: number; startCol: number; endCol: number } | null;
  hasColumnSelection?: boolean;
  selectedColumnIndexes?: Set<number>;
  selectedRowIds?: Set<number>;
  searchMatches?: SearchMatch[];
  currentMatchIndex?: number;
  editingCell?: { rowId: number; col: number } | null;
  formatCell?: (value: CellValue, columnIndex?: number) => string;
  canEditCell?: (displayRow: number, actualColumnIndex: number) => boolean;
  cellDetailTitle?: string;
}>();

const emit = defineEmits<{
  cellClick: [displayRow: number, visibleCol: number, rowId: number, event: { shiftKey: boolean; metaKey: boolean }];
  headerClick: [visibleCol: number, shiftKey: boolean];
  rowNumClick: [displayRow: number, shiftKey: boolean, metaKey: boolean];
  contextMenu: [row: number | null, col: number | null, clientX: number, clientY: number, isHeader: boolean];
  doubleClick: [displayRow: number, visibleCol: number];
  resizeColumn: [colIndex: number, newWidth: number];
  hoverUpdate: [row: number | null, col: number | null];
  editCommit: [displayRow: number, col: number, value: string];
  editCancel: [];
  cellDetailClick: [displayRow: number, visibleCol: number, actualCol: number];
  scrollUpdate: [scrollLeft: number, scrollTop: number, viewportWidth: number, scrollbarGutter: number];
}>();

const viewportRef = ref<HTMLDivElement>();
const wrapperRef = ref<HTMLDivElement>();
const canvasElRef = ref<HTMLCanvasElement>();
const interactionLayerRef = ref<HTMLDivElement>();
const { width: containerWidth, height: containerHeight } = useElementSize(viewportRef);
const SCROLLBAR_HIT_SIZE = 16;
const verticalOverlayReserve = ref(0);
const horizontalOverlayReserve = ref(0);

const canvas = useCanvasGrid({
  rowHeight: 26,
  headerHeight: 0,
  overscanRows: 8,
});

const colors = computed(() => resolveGridColors(props.isDark ?? false));
const rowItems = computed(() => props.displayItems);

const rowStatuses = computed(() => {
  const map = new Map<number, "clean" | "edited" | "deleted" | "new">();
  props.displayItems.forEach((item, index) => {
    map.set(index, item.status as "clean" | "edited" | "deleted" | "new");
  });
  return map;
});

const searchMatchSet = computed(() => {
  const set = new Set<string>();
  for (const m of props.searchMatches ?? []) {
    set.add(`${m.displayRow}:${m.col}`);
  }
  return set;
});

const currentMatchKey = computed(() => {
  const matches = props.searchMatches ?? [];
  if (matches.length === 0) return null;
  const idx = props.currentMatchIndex ?? 0;
  const m = matches[Math.min(idx, matches.length - 1)];
  if (!m) return null;
  return `${m.displayRow}:${m.col}`;
});

function isCellSelected(displayRow: number, visibleCol: number): boolean {
  const range = props.selectedRange;
  if (!range) {
    return !!(props.hasColumnSelection && props.selectedColumnIndexes?.has(visibleCol));
  }
  if (props.hasColumnSelection) {
    return props.selectedColumnIndexes?.has(visibleCol) ?? false;
  }
  return (
    displayRow >= range.startRow &&
    displayRow <= range.endRow &&
    visibleCol >= range.startCol &&
    visibleCol <= range.endCol
  );
}

function isCellDirty(displayRow: number, _sourceCol: number): boolean {
  const item = props.displayItems[displayRow];
  if (!item) return false;
  return item.isDirtyCol[_sourceCol] ?? false;
}

function isSearchMatch(displayRow: number, sourceCol: number): boolean {
  return searchMatchSet.value.has(`${displayRow}:${sourceCol}`);
}

function isCurrentMatch(displayRow: number, sourceCol: number): boolean {
  return currentMatchKey.value === `${displayRow}:${sourceCol}`;
}

function isRowActive(displayRow: number): boolean {
  const range = props.selectedRange;
  if (!range) return false;
  return displayRow >= range.startRow && displayRow <= range.endRow;
}

function isRowSelected(displayRow: number): boolean {
  const item = props.displayItems[displayRow];
  return !!item && (props.selectedRowIds?.has(item.id) ?? false);
}

const visibleRows = computed(() => canvas.visibleRowRange(rowItems.value.length));
const totalContentWidth = computed(() => (props.rowNumWidth ?? 48) + props.columnWidths.reduce((sum, w) => sum + w, 0));
const totalContentHeight = computed(() => rowItems.value.length * canvas.rowHeight + canvas.headerHeight);

const canvasStyle = computed(() => ({
  width: `${canvas.viewportWidth.value}px`,
  height: `${canvas.viewportHeight.value}px`,
}));
const canvasInteractionWidth = computed(() => Math.max(0, canvas.viewportWidth.value - verticalOverlayReserve.value));
const canvasInteractionHeight = computed(() =>
  Math.max(0, canvas.viewportHeight.value - horizontalOverlayReserve.value),
);
const interactionLayerStyle = computed(() => ({
  width: `${canvasInteractionWidth.value}px`,
  height: `${canvasInteractionHeight.value}px`,
}));

function draw() {
  try {
    const ctx = canvas.ctx.value;
    if (!ctx) return;
    const viewW = canvas.viewportWidth.value;
    const viewH = canvas.viewportHeight.value;
    if (viewW <= 0 || viewH <= 0) return;
    const colWidths = props.columnWidths;
    if (!colWidths || colWidths.length === 0) return;
    const visibleCols = canvas.visibleColRange(colWidths.length, colWidths);

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, ctx.canvas.width / dpr, ctx.canvas.height / dpr);

    drawCells({
      ctx,
      rows: rowItems.value,
      columnWidths: colWidths,
      rowHeight: canvas.rowHeight,
      headerHeight: canvas.headerHeight,
      startRow: visibleRows.value.startRow,
      endRow: visibleRows.value.endRow,
      startCol: visibleCols.startCol,
      endCol: visibleCols.endCol,
      scrollTop: canvas.scrollTop.value,
      scrollLeft: canvas.scrollLeft.value,
      xOffset: visibleCols.xOffset,
      colors: colors.value,
      isCellSelected,
      isCellDirty,
      isSearchMatch,
      isCurrentMatch,
      visibleToSourceCol: (vc: number) => props.actualColumnIndexes?.[vc] ?? vc,
      rowStatuses: rowStatuses.value,
      hoveredRow: canvas.hoveredRow.value,
      hoveredCol: canvas.hoveredCol.value,
      isRowActive,
      isRowSelected,
      rowNumWidth: props.rowNumWidth ?? 48,
      formatValue: (value, visibleCol) => {
        const actualCol = props.actualColumnIndexes?.[visibleCol] ?? visibleCol;
        return props.formatCell?.(value, actualCol) ?? displayCellValue(value);
      },
    });
  } catch (e) {
    console.warn("[CanvasGrid] draw error:", e);
  }
}

canvas.setRedrawCallback(draw);

function syncViewportFromScrollLayer() {
  const el = wrapperRef.value;
  const width = el?.clientWidth ?? containerWidth.value;
  const height = el?.clientHeight ?? containerHeight.value;
  const needsVerticalScroll = totalContentHeight.value > height + 1;
  const needsHorizontalScroll = totalContentWidth.value > width + 1;
  const verticalGutter = el ? scrollbarGutterWidth(el) : 0;
  const horizontalGutter = el ? Math.max(0, el.offsetHeight - el.clientHeight) : 0;
  verticalOverlayReserve.value = needsVerticalScroll && verticalGutter === 0 ? SCROLLBAR_HIT_SIZE : 0;
  horizontalOverlayReserve.value = needsHorizontalScroll && horizontalGutter === 0 ? SCROLLBAR_HIT_SIZE : 0;
  if (width > 0 && height > 0) canvas.updateViewport(width, height);
  if (el) {
    emit("scrollUpdate", el.scrollLeft, el.scrollTop, el.clientWidth, scrollbarGutterWidth(el));
  }
}

watch([containerWidth, containerHeight], () => {
  nextTick(syncViewportFromScrollLayer);
});

watch(
  () => [
    props.displayItems,
    props.columnWidths.join(","),
    props.selectedRange,
    props.searchMatches,
    props.currentMatchIndex,
    props.editingCell,
    props.hasColumnSelection,
    props.selectedColumnIndexes?.size ?? 0,
    props.selectedRowIds?.size ?? 0,
  ],
  () => {
    nextTick(syncViewportFromScrollLayer);
    canvas.scheduleRedraw();
  },
);

watch([() => canvas.scrollTop.value, () => canvas.scrollLeft.value], () => canvas.scheduleRedraw());

function actualColumnIndex(visibleCol: number): number {
  return props.actualColumnIndexes?.[visibleCol] ?? visibleCol;
}

const hitTestOptions = computed<HitTestOptions>(() => ({
  x: 0,
  y: 0,
  columnWidths: props.columnWidths,
  rowHeight: canvas.rowHeight,
  headerHeight: canvas.headerHeight,
  scrollTop: canvas.scrollTop.value,
  scrollLeft: canvas.scrollLeft.value,
  totalRows: rowItems.value.length,
  rowNumWidth: props.rowNumWidth ?? 48,
}));

// --- Inline editing ---
const editRow = ref<number | null>(null);
const editCol = ref<number | null>(null);
const editText = ref("");
const editInputRef = ref<HTMLInputElement>();

const detailButtonCell = computed(() => {
  const row = canvas.hoveredRow.value;
  const col = canvas.hoveredCol.value;
  if (row === null || col === null || editRow.value !== null) return null;
  if (!props.displayItems[row]) return null;
  return { row, col, actualCol: actualColumnIndex(col) };
});

const detailButtonStyle = computed(() => {
  const cell = detailButtonCell.value;
  if (!cell) return {};
  const rect = cellRect(
    cell.row,
    cell.col,
    props.columnWidths,
    canvas.rowHeight,
    canvas.headerHeight,
    canvas.scrollTop.value,
    canvas.scrollLeft.value,
    props.rowNumWidth ?? 48,
  );
  const left = Math.min(rect.x + rect.width - 23, canvasInteractionWidth.value - 21);
  return {
    position: "absolute" as const,
    left: `${Math.max(0, left)}px`,
    top: `${rect.y + 3}px`,
    zIndex: 11,
  };
});

const editInputStyle = computed(() => {
  const colWidths = props.columnWidths;
  const ec = editCol.value ?? 0;
  let left = (props.rowNumWidth ?? 48) - canvas.scrollLeft.value;
  for (let i = 0; i < ec; i++) left += colWidths[i] ?? 0;
  const top = canvas.headerHeight + (editRow.value ?? 0) * canvas.rowHeight - canvas.scrollTop.value;
  const width = (colWidths[ec] ?? 100) - 2;
  return {
    position: "absolute" as const,
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${canvas.rowHeight}px`,
    zIndex: 10,
  };
});

function beginEdit(row: number, col: number) {
  const raw = rowItems.value[row]?.data[actualColumnIndex(col)];
  editText.value = raw === null || raw === undefined ? "" : String(raw);
  editRow.value = row;
  editCol.value = col;
  nextTick(() => {
    const el = editInputRef.value;
    if (el) {
      el.focus();
      el.select();
    }
  });
}

watch(
  () => props.editingCell,
  (cell) => {
    if (!cell) {
      editRow.value = null;
      editCol.value = null;
      return;
    }
    const row = props.displayItems.findIndex((item) => item.id === cell.rowId);
    const col = props.actualColumnIndexes ? props.actualColumnIndexes.indexOf(cell.col) : cell.col;
    if (row < 0 || col < 0) return;
    beginEdit(row, col);
  },
);

function commitEdit() {
  const row = editRow.value;
  const col = editCol.value;
  const text = editText.value;
  editRow.value = null;
  editCol.value = null;
  try {
    if (row !== null && col !== null) emit("editCommit", row, col, text);
  } catch (e) {
    console.warn("[CanvasGrid] editCommit error:", e);
  }
  // Redraw after Vue has removed the edit input — don't clear hover,
  // the next mousemove or click will update it naturally
  nextTick(() => canvas.scheduleRedraw());
}

function cancelEdit() {
  const hadEdit = editRow.value !== null && editCol.value !== null;
  editRow.value = null;
  editCol.value = null;
  if (hadEdit) emit("editCancel");
  nextTick(() => canvas.scheduleRedraw());
}

function onEditKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") {
    e.preventDefault();
    commitEdit();
  } else if (e.key === "Escape") {
    e.preventDefault();
    cancelEdit();
  } else if (e.key === "Tab") {
    e.preventDefault();
    commitEdit();
  }
}

// --- Resize ---
let resizeStartWidth = 0;
let isResizing = false;

function onResizeStart(colIndex: number) {
  resizeStartWidth = props.columnWidths[colIndex] ?? 100;
  isResizing = true;
}

function onResizeMove(colIndex: number, deltaX: number) {
  const newWidth = Math.max(60, Math.min(400, resizeStartWidth + deltaX));
  emit("resizeColumn", colIndex, newWidth);
  canvas.scheduleRedraw();
}

// --- Scroll ---
function onScroll() {
  const el = wrapperRef.value;
  if (!el) return;
  canvas.scrollTop.value = el.scrollTop;
  canvas.scrollLeft.value = el.scrollLeft;
  canvas.scheduleRedraw();
  emit("scrollUpdate", el.scrollLeft, el.scrollTop, el.clientWidth, scrollbarGutterWidth(el));
}

// Unified hover update for all interactions
function updateHover(row: number | null, col: number | null) {
  canvas.hoveredRow.value = row;
  canvas.hoveredCol.value = col;
  canvas.scheduleRedraw();
  emit("hoverUpdate", row, col);
}

function clearHover() {
  updateHover(null, null);
}

function openCellDetails() {
  const cell = detailButtonCell.value;
  if (!cell) return;
  emit("cellDetailClick", cell.row, cell.col, cell.actualCol);
}

onMounted(() => {
  if (!canvasElRef.value || !interactionLayerRef.value || !wrapperRef.value) return;
  canvas.initCanvas(canvasElRef.value);
  syncViewportFromScrollLayer();

  const interactionLayer = interactionLayerRef.value;

  // Forward wheel events to scroll layer for native-like scrolling
  interactionLayer.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const el = wrapperRef.value;
      if (el) {
        el.scrollTop += e.deltaY;
        el.scrollLeft += e.deltaX;
      }
    },
    { passive: false },
  );

  setupCanvasEvents({
    canvas: interactionLayer,
    hitTestOptions: () => ({ ...hitTestOptions.value, x: 0, y: 0 }),
    handlers: {
      onCellClick(row, col, shiftKey, metaKey) {
        updateHover(row, col);
        const item = props.displayItems[row];
        emit("cellClick", row, col, item?.id ?? row, { shiftKey, metaKey });
      },
      onHeaderClick(col, shiftKey) {
        emit("headerClick", col, shiftKey);
      },
      onRowNumClick(row, shiftKey, metaKey) {
        updateHover(row, null);
        emit("rowNumClick", row, shiftKey, metaKey);
      },
      onContextMenu(row, col, clientX, clientY, isHeader) {
        if (row !== null) updateHover(row, col);
        emit("contextMenu", row, col, clientX, clientY, isHeader);
      },
      onDoubleClick(row, col) {
        emit("doubleClick", row, col);
      },
      onResizeStart,
      onResizeMove,
      onResizeEnd() {
        isResizing = false;
      },
      onHover(row, col) {
        updateHover(row, col);
      },
      onSelectDrag(_row, _col) {},
    },
    getResizing: () => isResizing,
    setResizing: (v) => {
      isResizing = v;
    },
    cellCursor: (row, col) => (props.canEditCell?.(row, actualColumnIndex(col)) ? "text" : "default"),
  });
});

onUnmounted(() => {});

defineExpose({
  scrollLeft: canvas.scrollLeft,
  scrollTop: canvas.scrollTop,
});
</script>

<template>
  <div ref="viewportRef" class="flex-1 relative overflow-hidden" @mouseleave="clearHover">
    <!-- Scroll layer: behind canvas, provides native scrollbar -->
    <div ref="wrapperRef" class="absolute inset-0 overflow-auto" @scroll="onScroll">
      <div :style="{ width: totalContentWidth + 'px', height: totalContentHeight + 'px' }" />
    </div>
    <!-- Canvas layer: on top, receives mouse events -->
    <canvas ref="canvasElRef" class="pointer-events-none absolute top-0 left-0" :style="canvasStyle" />
    <div ref="interactionLayerRef" class="absolute top-0 left-0" :style="interactionLayerStyle" />
    <button
      v-if="detailButtonCell"
      type="button"
      data-canvas-cell-detail-button
      class="absolute flex h-5 w-5 items-center justify-center rounded bg-background/90 text-muted-foreground shadow-sm ring-1 ring-border hover:text-foreground"
      :style="detailButtonStyle"
      :title="cellDetailTitle"
      @mousedown.stop.prevent
      @click.stop="openCellDetails"
    >
      <Info class="h-3 w-3" />
    </button>
    <!-- Edit input overlay -->
    <input
      v-if="editRow !== null && editCol !== null"
      ref="editInputRef"
      v-model="editText"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
      class="absolute z-10 bg-background border-2 border-primary px-2 text-xs outline-none"
      :style="editInputStyle"
      @blur="commitEdit"
      @click.stop
      @keydown.stop="onEditKeydown"
    />
  </div>
</template>
