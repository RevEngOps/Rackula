<!--
  CableOverlay
  Draws coloured connector lines between placed devices for each cable.
  Rendered INSIDE the pan/zoom content container so it inherits the same
  transform as the racks; coordinates are computed in content space from the
  devices' DOM rects (anchored via data-placed-id). Visibility is controlled by
  uiStore.showCables.
-->
<script lang="ts">
  // @ts-nocheck
  import { tick } from "svelte";
  import { getCableStore } from "$lib/stores/cables.svelte";
  import { getUIStore } from "$lib/stores/ui.svelte";
  import { getLayoutStore } from "$lib/stores/layout.svelte";
  import { getCanvasStore } from "$lib/stores/canvas.svelte";

  const cableStore = getCableStore();
  const uiStore = getUIStore();
  const layoutStore = getLayoutStore();
  const canvasStore = getCanvasStore();

  let svgEl = $state<SVGSVGElement | null>(null);
  let segments = $state<
    Array<{
      id: string;
      color: string;
      d: string;
      ax: number;
      ay: number;
      bx: number;
      by: number;
      labelX: number;
      labelY: number;
      labelText: string;
    }>
  >([]);
  let resizeTick = $state(0);

  // Perpendicular spacing (content px) between parallel cables on the same pair.
  const PAIR_SPACING = 22;

  const cables = $derived(cableStore.cables);

  // Changes whenever device geometry that affects positions changes.
  const geometrySignal = $derived(
    JSON.stringify(
      layoutStore.racks.map((r) => [
        r.id,
        r.view,
        r.devices.map((d) => [d.id, d.position, d.face, d.slot_position]),
      ]),
    ),
  );

  function centerOf(
    el: Element,
    containerRect: DOMRect,
    scale: number,
  ): { x: number; y: number } {
    const r = el.getBoundingClientRect();
    return {
      x: (r.left + r.width / 2 - containerRect.left) / scale,
      y: (r.top + r.height / 2 - containerRect.top) / scale,
    };
  }

  async function recompute() {
    if (!svgEl || !uiStore.showCables) {
      segments = [];
      return;
    }
    const container = svgEl.parentElement;
    if (!container) {
      segments = [];
      return;
    }
    // Wait for any pending DOM updates before measuring.
    await tick();
    const containerRect = container.getBoundingClientRect();
    // canvasStore.zoom is a scale factor (1 = 100%).
    const scale = canvasStore.zoom || 1;

    // 1. Collect renderable cables with canonical (id-sorted) endpoints so every
    //    cable on the same device pair shares one orientation for fanning out.
    type Item = {
      id: string;
      color: string;
      labelText: string;
      p1: { x: number; y: number };
      p2: { x: number; y: number };
      pairKey: string;
    };
    const items: Item[] = [];
    for (const c of cables) {
      const aEl = container.querySelector(
        `[data-placed-id="${c.a_device_id}"]`,
      );
      const bEl = container.querySelector(
        `[data-placed-id="${c.b_device_id}"]`,
      );
      if (!aEl || !bEl) continue; // device not currently rendered (e.g. other rack on mobile)

      let id1 = c.a_device_id;
      let id2 = c.b_device_id;
      let el1: Element = aEl;
      let el2: Element = bEl;
      if (id1 > id2) {
        [id1, id2] = [id2, id1];
        [el1, el2] = [bEl, aEl];
      }

      const labelParts: string[] = [];
      if (c.label) labelParts.push(c.label);
      if (c.length != null) labelParts.push(`${c.length}${c.length_unit ?? ""}`);

      items.push({
        id: c.id,
        color: c.color ?? "#6B7280",
        labelText: labelParts.join(" · "),
        p1: centerOf(el1, containerRect, scale),
        p2: centerOf(el2, containerRect, scale),
        pairKey: `${id1}|${id2}`,
      });
    }

    // 2. Group by device pair and fan each cable out along a perpendicular
    //    offset so multiple cables between the same devices stay distinct.
    const groups = new Map<string, Item[]>();
    for (const it of items) {
      const arr = groups.get(it.pairKey);
      if (arr) arr.push(it);
      else groups.set(it.pairKey, [it]);
    }

    const next: typeof segments = [];
    for (const group of groups.values()) {
      const count = group.length;
      group.forEach((it, i) => {
        const { p1, p2 } = it;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy) || 1;
        // Unit perpendicular to the A→B direction.
        const nx = -dy / len;
        const ny = dx / len;
        // Centred offset: e.g. for 3 cables → -PAIR_SPACING, 0, +PAIR_SPACING.
        const offset = (i - (count - 1) / 2) * PAIR_SPACING;
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;

        let d: string;
        let labelX: number;
        let labelY: number;
        if (offset === 0) {
          d = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
          labelX = midX;
          labelY = midY - 4;
        } else {
          // Quadratic curve; control point at 2× offset puts the arc peak ≈offset away.
          const cx = midX + nx * offset * 2;
          const cy = midY + ny * offset * 2;
          d = `M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`;
          labelX = midX + nx * offset;
          labelY = midY + ny * offset;
        }

        next.push({
          id: it.id,
          color: it.color,
          d,
          ax: p1.x,
          ay: p1.y,
          bx: p2.x,
          by: p2.y,
          labelX,
          labelY,
          labelText: it.labelText,
        });
      });
    }
    segments = next;
  }

  // Recompute when cables, geometry, visibility, zoom, the svg ref, or a
  // resize event change.
  $effect(() => {
    void cables;
    void geometrySignal;
    void uiStore.showCables;
    void canvasStore.zoom;
    void resizeTick;
    void svgEl;
    recompute();
  });

  // Track container size changes (e.g. rack added/removed, layout reflow).
  $effect(() => {
    if (!svgEl) return;
    const container = svgEl.parentElement;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      resizeTick++;
    });
    ro.observe(container);
    const onResize = () => {
      resizeTick++;
    };
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  });
</script>

{#if uiStore.showCables}
  <svg class="cable-overlay" bind:this={svgEl} aria-hidden="true">
    {#each segments as seg (seg.id)}
      <g class="cable-line">
        <path
          d={seg.d}
          fill="none"
          stroke={seg.color}
          stroke-width="3"
          stroke-linecap="round"
          opacity="0.85"
        />
        <circle cx={seg.ax} cy={seg.ay} r="4" fill={seg.color} />
        <circle cx={seg.bx} cy={seg.by} r="4" fill={seg.color} />
        {#if seg.labelText}
          <text
            x={seg.labelX}
            y={seg.labelY}
            text-anchor="middle"
            class="cable-label"
          >{seg.labelText}</text>
        {/if}
      </g>
    {/each}
  </svg>
{/if}

<style>
  .cable-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
    z-index: 5;
  }

  .cable-label {
    font-size: 10px;
    fill: var(--colour-text, #111);
    paint-order: stroke;
    stroke: var(--canvas-bg, #fff);
    stroke-width: 3px;
    stroke-linejoin: round;
  }
</style>
