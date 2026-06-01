import { createApp, defineComponent, h, nextTick, ref } from "vue";
import { createPinia } from "pinia";
import VueVirtualScroller from "vue-virtual-scroller";
import "vue-virtual-scroller/dist/vue-virtual-scroller.css";
import "@/styles/globals.css";
import i18n, { loadSavedLocale } from "@/i18n";
import DataGrid from "@/components/grid/DataGrid.vue";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { QueryResult } from "@/types/database";

type BenchMode = "dom" | "canvas";

declare global {
  interface Window {
    __DBX_GRID_BENCH_READY?: boolean;
    __DBX_GRID_BENCH_METRICS?: () => {
      mode: BenchMode;
      rows: number;
      cols: number;
      elements: number;
      nodes: number;
      canvases: number;
      dataGridCells: number;
      dataGridRows: number;
      dataGridHeaders: number;
    };
  }
}

function intParam(params: URLSearchParams, name: string, fallback: number): number {
  const value = Number(params.get(name));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function modeParam(params: URLSearchParams): BenchMode {
  return params.get("mode") === "canvas" ? "canvas" : "dom";
}

function makeResult(rows: number, cols: number): QueryResult {
  const columns = Array.from({ length: cols }, (_, index) => `col_${String(index + 1).padStart(3, "0")}`);
  const data = Array.from({ length: rows }, (_, rowIndex) =>
    Array.from({ length: cols }, (_, colIndex) => {
      const kind = colIndex % 6;
      if (kind === 0) return rowIndex * cols + colIndex;
      if (kind === 1) return `row_${rowIndex + 1}_col_${colIndex + 1}`;
      if (kind === 2) return (rowIndex + colIndex) % 2 === 0;
      if (kind === 3) return null;
      if (kind === 4) return `2026-06-${String((rowIndex % 28) + 1).padStart(2, "0")} 12:34:56`;
      return `value-${rowIndex + 1}-${colIndex + 1}-abcdefghijklmnopqrstuvwxyz`;
    }),
  );
  return {
    columns,
    rows: data,
    affected_rows: rows,
    execution_time_ms: 1,
  };
}

function collectMetrics(mode: BenchMode, rows: number, cols: number) {
  const root = document.querySelector("[data-grid-root]") ?? document.body;
  const treeWalker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
  let nodes = 1;
  while (treeWalker.nextNode()) nodes += 1;

  return {
    mode,
    rows,
    cols,
    elements: root.querySelectorAll("*").length,
    nodes,
    canvases: root.querySelectorAll("canvas").length,
    dataGridCells: root.querySelectorAll("[data-visible-col-index]").length,
    dataGridRows: root.querySelectorAll("[data-row-index]").length,
    dataGridHeaders: root.querySelectorAll("[data-grid-column-index]").length,
  };
}

async function waitForPaints(count: number) {
  for (let i = 0; i < count; i += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

async function main() {
  const params = new URLSearchParams(window.location.search);
  const mode = modeParam(params);
  const rows = intParam(params, "rows", 1000);
  const cols = intParam(params, "cols", 20);
  localStorage.setItem("dbx-canvas-mode", mode === "canvas" ? "1" : "0");
  window.__DBX_GRID_BENCH_READY = false;

  const result = ref(makeResult(rows, cols));
  const App = defineComponent({
    setup() {
      return () =>
        h(
          TooltipProvider,
          {},
          {
            default: () =>
              h(
                "div",
                { style: "height:100vh;width:100vw;display:flex;overflow:hidden;background:var(--background);" },
                [
                  h(DataGrid, {
                    result: result.value,
                    editable: false,
                    context: "results",
                    cacheKey: `bench-${mode}-${rows}x${cols}`,
                  }),
                ],
              ),
          },
        );
    },
  });

  await loadSavedLocale();
  const app = createApp(App);
  app.use(createPinia());
  app.use(i18n);
  app.use(VueVirtualScroller);
  app.mount("#root");

  await nextTick();
  await waitForPaints(6);
  window.__DBX_GRID_BENCH_METRICS = () => collectMetrics(mode, rows, cols);
  window.__DBX_GRID_BENCH_READY = true;
}

void main();
