/**
 * Cable Focus
 *
 * The device whose cables are currently "focused" (filtered/highlighted). The
 * Cables panel sets it from the selected device; the canvas overlay reads it to
 * emphasise cables touching that device and dim the rest.
 */

let focusedDeviceId = $state<string | null>(null);

/** Set (or clear) the device whose cables should be highlighted. */
export function setCableFocusDevice(id: string | null): void {
  focusedDeviceId = id;
}

/** Reactive accessor for the focused device id (or null). */
export function getCableFocusDevice(): string | null {
  return focusedDeviceId;
}
