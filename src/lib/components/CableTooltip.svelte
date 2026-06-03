<!--
  CableTooltip Component
  Shows details for the cable currently hovered in the canvas overlay.
  Rendered at document level and positioned with fixed screen coordinates so it
  is unaffected by the canvas pan/zoom transform.
-->
<script lang="ts">
  // @ts-nocheck
  import { getCableTooltipState } from "$lib/stores/cableTooltip.svelte";

  const state = $derived(getCableTooltipState());
  const info = $derived(state.info);
  const visible = $derived(state.visible);

  const TYPE_LABELS: Record<string, string> = {
    cat5e: "Cat5e",
    cat6: "Cat6",
    cat6a: "Cat6a",
    cat7: "Cat7",
    cat8: "Cat8",
    "dac-passive": "DAC (passive)",
    "dac-active": "DAC (active)",
    "mmf-om3": "Fiber OM3",
    "mmf-om4": "Fiber OM4",
    "smf-os2": "Fiber OS2",
    aoc: "AOC",
    power: "Power",
    serial: "Serial",
  };

  function typeLabel(type?: string): string {
    if (!type) return "Cable";
    return TYPE_LABELS[type] ?? type;
  }
</script>

{#if visible && info}
  <div class="cable-tooltip" role="tooltip" style="left: {state.x}px; top: {state.y}px;">
    <div class="cable-tooltip-head">
      <span class="cable-tooltip-swatch" style="background: {info.color ?? '#6B7280'}"></span>
      <span class="cable-tooltip-type">{typeLabel(info.type)}</span>
      {#if info.length}
        <span class="cable-tooltip-length">{info.length}</span>
      {/if}
    </div>
    {#if info.label}
      <div class="cable-tooltip-label">{info.label}</div>
    {/if}
    <div class="cable-tooltip-endpoints">
      <span>{info.a}</span>
      <span class="cable-tooltip-arrow">↔</span>
      <span>{info.b}</span>
    </div>
  </div>
{/if}

<style>
  .cable-tooltip {
    position: fixed;
    z-index: var(--z-tooltip);
    padding: var(--space-2);
    background-color: var(--colour-surface-overlay);
    color: var(--colour-text-inverse);
    font-size: var(--font-size-xs);
    border-radius: var(--radius-sm);
    pointer-events: none;
    box-shadow: var(--shadow-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 140px;
    max-width: 280px;
    transform: translate(-50%, -100%) translateY(calc(-1 * var(--space-2)));
    animation: cable-tooltip-fade-in var(--duration-fast, 100ms)
      var(--ease-out, ease-out);
  }

  @keyframes cable-tooltip-fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .cable-tooltip-head {
    display: flex;
    align-items: center;
    gap: var(--space-1-5, 0.375rem);
    font-weight: 600;
  }

  .cable-tooltip-swatch {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.4);
    flex: 0 0 auto;
  }

  .cable-tooltip-length {
    margin-left: auto;
    color: var(--colour-text-muted-inverse, rgba(255, 255, 255, 0.7));
    font-weight: 400;
  }

  .cable-tooltip-label {
    color: var(--colour-text-inverse);
    word-break: break-word;
  }

  .cable-tooltip-endpoints {
    color: var(--colour-text-muted-inverse, rgba(255, 255, 255, 0.75));
    word-break: break-word;
  }

  .cable-tooltip-arrow {
    margin: 0 4px;
  }

  @media (prefers-reduced-motion: reduce) {
    .cable-tooltip {
      animation: none;
    }
  }
</style>
