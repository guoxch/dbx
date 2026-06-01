# Canvas grid memory benchmark

Date: 2026-06-01

Branch: `canvas-table`

## Method

- Rendered `DataGrid` through a dedicated Vite benchmark entry at `apps/desktop/perf-grid.html`.
- Generated synthetic result sets in-browser and toggled `localStorage["dbx-canvas-mode"]` between DOM and canvas.
- Ran each measurement in a fresh headless Google Chrome process with a fresh profile.
- Ran 3 isolated samples per scenario and reported the median.
- Forced garbage collection before measurement with CDP `HeapProfiler.collectGarbage` and `globalThis.gc()`.
- Collected JS heap with `Runtime.getHeapUsage`.
- Collected RSS from the full Chrome process tree. RSS includes browser overhead and is noisier than JS heap, so the comparable signal is the median delta.

## Results

| Scenario | DOM JS Heap MiB | Canvas JS Heap MiB | JS Heap Delta MiB | DOM RSS MiB | Canvas RSS MiB | RSS Delta MiB | DOM Elements | Canvas Elements | Element Delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Grid 1000 x 20 | 21.1 | 18.9 | -2.2 | 909.2 | 1059.1 | +149.9 | 1331 | 288 | -1043 |
| Grid 1000 x 200 | 25.9 | 23.7 | -2.2 | 990.4 | 1070.6 | +80.2 | 1331 | 288 | -1043 |
| Grid 5000 x 200 | 52.2 | 50.1 | -2.1 | 1053.9 | 1103.8 | +49.8 | 1331 | 288 | -1043 |

## Notes

- The current DOM grid already has row virtualization and horizontal column windowing. In these scenarios it renders about 55 rows and 14 body columns, not the full result width.
- Canvas primarily removes the visible body-cell DOM: 770 measured body cells become one canvas and one interaction layer.
- The larger shared win in this pass came from avoiding clean-row copies, avoiding per-row false dirty-column arrays, building display rows in one pass, and making transpose record widths sparse. Canvas also avoids a deep watcher over full table data.
- RSS was unstable across repeated headless Chrome process-tree measurements after the canvas path started using native canvas/GPU resources. Treat JS heap and DOM counts as the stable signal in this benchmark; RSS needs a WebView-app-level capture before making product claims.
- Keeping the DOM header for sort, filter, formatter, and resize actions means canvas still pays the header-window cost. A larger canvas-only memory reduction needs either a lighter header path or a canvas/header overlay path.

## Reproduction

```sh
DBX_GRID_BENCH_SAMPLES=3 node scripts/measure-grid-canvas-vs-dom.mjs
```
