<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { useElementSize } from "@vueuse/core";
import { useCanvasGrid } from "@/composables/useCanvasGrid";
import { drawCells } from "./drawCells";
import { setupCanvasEvents } from "./interaction";
import { type HitTestOptions } from "./hitTest";
import { resolveGridColors } from "./colors";
import { displayCellValue, type CellValue } from "@/lib/cellValue";

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
  rows: CellValue[][];
  displayItems: RowItem[];
  columnWidths: number[];
  rowNumWidth?: number;
  isDark?: boolean;
  selectedRange?: { startRow: number; endRow: number; startCol: number; endCol: number } | null;
  hasColumnSelection?: boolean;
  selectedColumnIndexes?: Set<number>;
  searchMatches?: SearchMatch[];
  currentMatchIndex?: number;
  editingCell?: { rowId: number; col: number } | null;
  formatCell?: (value: CellValue, columnIndex?: number) => string;
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
}>();

const viewportRef = ref<HTMLDivElement>();
const wrapperRef = ref<HTMLDivElement>();
const canvasElRef = ref<HTMLCanvasElement>();
const { width: containerWidth, height: containerHeight } = useElementSize(viewportRef);

const canvas = useCanvasGrid({
  rowHeight: 26,
  headerHeight: 0,
  overscanRows: 8,
});

const colors = computed(() => resolveGridColors(props.isDark ?? false));
const allRows = computed(() => props.displayItems.map((item) => item.data));

const rowStatuses = computed(() => {
  const map = new Map<number, "clean" | "edited" | "deleted" | "new">();
  for (const item of props.displayItems) {
    map.set(item.displayIndex, item.status as "clean" | "edited" | "deleted" | "new");
  }
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

const visibleRows = computed(() => canvas.visibleRowRange(allRows.value.length));
const totalContentWidth = computed(() => (props.rowNumWidth ?? 48) + props.columnWidths.reduce((sum, w) => sum + w, 0));
const totalContentHeight = computed(() => allRows.value.length * canvas.rowHeight + canvas.headerHeight);

function draw() {
  try {
    const ctx = canvas.ctx.value;
    if (!ctx) return;
    const viewW = containerWidth.value;
    const viewH = containerHeight.value;
    if (viewW <= 0 || viewH <= 0) return;
    const colWidths = props.columnWidths;
    if (!colWidths || colWidths.length === 0) return;
    const visibleCols = canvas.visibleColRange(colWidths.length, colWidths);

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, ctx.canvas.width / dpr, ctx.canvas.height / dpr);

    drawCells({
      ctx,
      rows: allRows.value,
      columnWidths: colWidths,
      rowHeight: canvas.rowHeight,
      headerHeight: canvas.headerHeight,
      startRow: visibleRows.value.startRow,
      endRow: visibleRows.value.endRow,
      startCol: visibleCols.startCol,
      endCol: visibleCols.endCol,
      scrollTop: canvas.scrollTop.value,
      xOffset: visibleCols.xOffset,
      colors: colors.value,
      isCellSelected,
      isCellDirty,
      isSearchMatch,
      isCurrentMatch,
      visibleToSourceCol: (vc: number) => vc,
      rowStatuses: rowStatuses.value,
      hoveredRow: canvas.hoveredRow.value,
      isRowActive,
      rowNumWidth: props.rowNumWidth ?? 48,
      formatValue: props.formatCell ?? displayCellValue,
    });
  } catch (e) {
    console.warn("[CanvasGrid] draw error:", e);
  }
}

canvas.setRedrawCallback(draw);

watch([containerWidth, containerHeight], ([w, h]) => {
  if (w > 0 && h > 0) canvas.updateViewport(w, h);
});

watch(
  () => [props.displayItems, props.columnWidths, props.selectedRange, props.searchMatches, props.currentMatchIndex],
  () => canvas.scheduleRedraw(),
  { deep: true },
);

watch([() => canvas.scrollTop.value, () => canvas.scrollLeft.value], () => canvas.scheduleRedraw());

const hitTestOptions = computed<HitTestOptions>(() => ({
  x: 0,
  y: 0,
  columnWidths: props.columnWidths,
  rowHeight: canvas.rowHeight,
  headerHeight: canvas.headerHeight,
  scrollTop: canvas.scrollTop.value,
  scrollLeft: canvas.scrollLeft.value,
  totalRows: allRows.value.length,
  rowNumWidth: props.rowNumWidth ?? 48,
}));

// --- Inline editing ---
const editRow = ref<number | null>(null);
const editCol = ref<number | null>(null);
const editText = ref("");
const editInputRef = ref<HTMLInputElement>();

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
  const raw = allRows.value[row]?.[col];
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
  editRow.value = null;
  editCol.value = null;
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
}

// Unified hover update for all interactions
function updateHover(row: number | null, col: number | null) {
  canvas.hoveredRow.value = row;
  canvas.hoveredCol.value = col;
  canvas.scheduleRedraw();
  emit("hoverUpdate", row, col);
}

onMounted(() => {
  if (!canvasElRef.value || !wrapperRef.value) return;
  canvas.initCanvas(canvasElRef.value);
  canvas.updateViewport(containerWidth.value, containerHeight.value);

  const canvasEl = canvasElRef.value;

  // Forward wheel events to scroll layer for native-like scrolling
  canvasEl.addEventListener(
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
    canvas: canvasEl,
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
        beginEdit(row, col);
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
  });
});

onUnmounted(() => {});

defineExpose({
  scrollLeft: canvas.scrollLeft,
  scrollTop: canvas.scrollTop,
});
</script>

<template>
  <div ref="viewportRef" class="flex-1 relative overflow-hidden">
    <!-- Scroll layer: behind canvas, provides native scrollbar -->
    <div ref="wrapperRef" class="absolute inset-0 overflow-auto" @scroll="onScroll">
      <div :style="{ width: totalContentWidth + 'px', height: totalContentHeight + 'px' }" />
    </div>
    <!-- Canvas layer: on top, receives mouse events -->
    <canvas ref="canvasElRef" class="absolute top-0 left-0" />
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
