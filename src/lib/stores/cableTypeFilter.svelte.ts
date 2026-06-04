/**
 * Cable Type Filter
 *
 * Tracks which cable types are hidden from the canvas overlay. A type is
 * visible unless explicitly hidden. The Cables panel toggles types; the overlay
 * reads visibility to decide what to draw.
 */

// Keyed by cable type (or "__untyped" for cables with no type). Value true = hidden.
let hidden = $state<Record<string, boolean>>({});

function key(type: string | undefined): string {
  return type ?? "__untyped";
}

/** Whether cables of this type should be drawn. */
export function isCableTypeVisible(type: string | undefined): boolean {
  return !hidden[key(type)];
}

/** Toggle visibility of a cable type. */
export function toggleCableTypeVisibility(type: string | undefined): void {
  const k = key(type);
  hidden[k] = !hidden[k];
}

/** Reactive accessor for the hidden map (for dependency tracking). */
export function getHiddenCableTypes(): Record<string, boolean> {
  return hidden;
}
