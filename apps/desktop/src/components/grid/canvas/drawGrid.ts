import { drawHeaders, type DrawHeadersOptions } from "./drawHeaders";
import { drawCells, type DrawCellsOptions } from "./drawCells";

export interface DrawGridFullOptions extends DrawHeadersOptions, Omit<DrawCellsOptions, "ctx"> {
  ctx: CanvasRenderingContext2D;
}

/**
 * Main grid draw function. Clears the canvas and draws headers + cells.
 */
export function drawGrid(options: DrawGridFullOptions) {
  const { ctx } = options;

  const canvas = ctx.canvas;
  const dpr = window.devicePixelRatio || 1;
  const canvasW = canvas.width / dpr;
  const canvasH = canvas.height / dpr;
  ctx.clearRect(0, 0, canvasW, canvasH);

  // Draw cells in the data area (below header), clip so rows don't leak into header
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, options.headerHeight, canvasW, canvasH - options.headerHeight);
  ctx.clip();
  drawCells(options);
  ctx.restore();

  // Draw headers on top so they always render cleanly over the data
  drawHeaders(options);
}
