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
        r.show_rear,
        r.devices.map((d) => [d.id, d.position, d.face, d.slot_position]),
      ]),
    ),
  );

  function faceOf(el: Element): "front" | "rear" {
    return el.getAttribute("data-rack-view") === "rear" ? "rear" : "front";
  }

  // Anchor at the device's side edge, vertical middle: right edge for rear,
  // left edge for front. Returned in content-space coordinates.
  function anchorOf(
    el: Element,
    face: "front" | "rear",
    containerRect: DOMRect,
    scale: number,
  ): { x: number; y: number } {
    const r = el.getBoundingClientRect();
    const x = face === "rear" ? r.right : r.left;
    const y = r.top + r.height / 2;
    return {
      x: (x - containerRect.left) / scale,
      y: (y - containerRect.top) / scale,
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
    // Derive the live scale straight from the DOM: the container's on-screen
    // (transformed) width divided by its layout (untransformed) width. This is
    // exactly consistent with the rects we measure below, whereas trusting the
    // store's zoom value can be slightly off — and that error is multiplied by
    // a device's distance from the content origin, so lines for devices far
    // from origin (2nd/3rd rack) drift away on zoom.
    const layoutWidth = (container as HTMLElement).offsetWidth;
    const scale =
      layoutWidth > 0 ? containerRect.width / layoutWidth : canvasStore.zoom || 1;

    // 1. Collect renderable cables with canonical (id-sorted) endpoints so every
    //    cable on the same device pair shares one orientation for fanning out.
    type Item = {
      id: string;
      color: string;
      labelText: string;
      p1: { x: number; y: number };
      p2: { x: number; y: number };
      pairKey: string;
      // Which screen side the bundle fans toward: rear endpoints → right,
      // front endpoints → left.
      side: "left" | "right";
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

      const face1 = faceOf(el1);
      const face2 = faceOf(el2);

      const labelParts: string[] = [];
      if (c.label) labelParts.push(c.label);
      if (c.length != null) labelParts.push(`${c.length}${c.length_unit ?? ""}`);

      items.push({
        id: c.id,
        color: c.color ?? "#6B7280",
        labelText: labelParts.join(" · "),
        p1: anchorOf(el1, face1, containerRect, scale),
        p2: anchorOf(el2, face2, containerRect, scale),
        pairKey: `${id1}|${id2}`,
        side: face1 === "rear" || face2 === "rear" ? "right" : "left",
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
        const { p1, p2, side } = it;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy) || 1;
        // Unit perpendicular to the A→B direction, oriented so it points toward
        // the requested screen side (rear → right / +x, front → left / -x).
        let nx = -dy / len;
        let ny = dx / len;
        const want = side === "right" ? 1 : -1;
        if ((want === 1 && nx < 0) || (want === -1 && nx > 0)) {
          nx = -nx;
          ny = -ny;
        }

        // One-directional fan: the first cable runs straight along the edge,
        // each subsequent one bows further out on the same side.
        const mag = i * PAIR_SPACING;
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        const cx = midX + nx * mag;
        const cy = midY + ny * mag;
        const d = `M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`;

        // Stagger each cable's label to a distinct point ALONG its own arc so
        // labels for multiple cables on the same pair don't stack on top of
        // each other. t spreads evenly across the bundle (e.g. 1/4, 2/4, 3/4).
        const t = count > 1 ? (i + 1) / (count + 1) : 0.5;
        const mt = 1 - t;
        const labelX = mt * mt * p1.x + 2 * mt * t * cx + t * t * p2.x;
        const labelY = mt * mt * p1.y + 2 * mt * t * cy + t * t * p2.y - 4;

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
