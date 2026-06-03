/**
 * Cable Edit Request
 *
 * One-shot signal used to ask the Cables panel to open a specific cable for
 * editing (e.g. from the right-click "Edit" action on a cable in the canvas).
 * The panel consumes and clears it.
 */

let requestedId = $state<string | null>(null);

/** Request that the Cables panel open this cable for editing. */
export function requestEditCable(id: string): void {
  requestedId = id;
}

/** Reactive accessor for the pending edit request (cable id or null). */
export function getEditCableRequest(): string | null {
  return requestedId;
}

/** Clear the pending edit request. */
export function clearEditCableRequest(): void {
  requestedId = null;
}
