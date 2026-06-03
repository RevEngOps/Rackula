/**
 * Cable Tooltip Store
 *
 * Global state for the hover tooltip shown over a cable in the canvas overlay.
 * The overlay (which lives inside the zoom-transformed container) populates it;
 * CableTooltip renders it at document level in screen coordinates.
 */

/** Resolved, ready-to-render info for a single cable. */
export interface CableTooltipInfo {
  /** Hex colour of the cable */
  color?: string;
  /** Raw cable type (e.g. "cat6"); CableTooltip maps it to a friendly label */
  type?: string;
  /** A-side endpoint label (device name, optionally ": port") */
  a: string;
  /** B-side endpoint label */
  b: string;
  /** Pre-formatted length (e.g. "2m"), if any */
  length?: string;
  /** User label, if any */
  label?: string;
}

export interface CableTooltipState {
  info: CableTooltipInfo | null;
  x: number;
  y: number;
  visible: boolean;
}

let tooltipState = $state<CableTooltipState>({
  info: null,
  x: 0,
  y: 0,
  visible: false,
});

/** Show the tooltip for a cable at the given screen coordinates. */
export function showCableTooltip(
  info: CableTooltipInfo,
  x: number,
  y: number,
): void {
  tooltipState = { info, x, y, visible: true };
}

/** Update the tooltip position (e.g. on mousemove) while visible. */
export function moveCableTooltip(x: number, y: number): void {
  if (!tooltipState.visible) return;
  tooltipState = { ...tooltipState, x, y };
}

/** Hide the tooltip. */
export function hideCableTooltip(): void {
  tooltipState = { ...tooltipState, visible: false };
}

/** Reactive accessor for the current tooltip state. */
export function getCableTooltipState(): CableTooltipState {
  return tooltipState;
}
