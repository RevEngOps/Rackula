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
  import {
    showCableTooltip,
    moveCableTooltip,
    hideCableTooltip,
    type CableTooltipInfo,
  } from "$lib/stores/cableTooltip.svelte";
  import { requestEditCable } from "$lib/stores/cableEdit.svelte";
  import { getToastStore } from "$lib/stores/toast.svelte";
  import CableContextMenu from "./CableContextMenu.svelte";

  const cableStore = getCableStore();
  const toastStore = getToastStore();
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
      labelAnchor: "start" | "middle" | "end";
      // Dotted leader from the cable to its label (null for single cables).
      leader: { x1: number; y1: number; x2: number; y2: number } | null;
      // Resolved details shown in the hover tooltip.
      info: CableTooltipInfo;
    }>
  >([]);
  // Id of the cable currently hovered (for visual emphasis).
  let hoveredId = $state<string | null>(null);

  // Right-click context menu state.
  let menuOpen = $state(false);
  let menuX = $state(0);
  let menuY = $state(0);
  let menuCableId = $state<string | null>(null);

  function openCableMenu(event: MouseEvent, id: string) {
    event.preventDefault();
    event.stopPropagation(); // don't also open the canvas context menu
    hideCableTooltip();
    menuCableId = id;
    menuX = event.clientX;
    menuY = event.clientY;
    menuOpen = true;
  }

  function editMenuCable() {
    if (!menuCableId) return;
    requestEditCable(menuCableId);
    uiStore.setSidebarTab("cables");
  }

  function deleteMenuCable() {
    if (!menuCableId) return;
    cableStore.removeCable(menuCableId);
    toastStore.showToast("Cable removed", "info");
  }
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

  // Human-readable name for a placed device (across all racks).
  function deviceName(id: string): string {
    for (const rack of layoutStore.racks) {
      const d = rack.devices.find((x) => x.id === id);
      if (d) {
        const dt = layoutStore.device_types.find(
          (t) => t.slug === d.device_type,
        );
        return d.name || d.label || dt?.model || dt?.slug || d.device_type;
      }
    }
    return "(removed device)";
  }

  function endpointLabel(id: string, iface?: string): string {
    const name = deviceName(id);
    return iface ? `${name} : ${iface}` : name;
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
      info: CableTooltipInfo;
      // Vertical extent + representative x of the (straight) cable, used to
      // detect cables that would run over one another along the same edge.
      yMin: number;
      yMax: number;
      cxRep: number;
      // Assigned lane (0 = hugs the edge); larger lanes bow further out.
      lane: number;
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

      const lengthText =
        c.length != null ? `${c.length}${c.length_unit ?? ""}` : undefined;
      const labelParts: string[] = [];
      if (c.label) labelParts.push(c.label);
      if (lengthText) labelParts.push(lengthText);

      // Tooltip uses the cable's original A/B orientation (as entered), not the
      // id-sorted geometry order.
      const info: CableTooltipInfo = {
        color: c.color,
        type: c.type,
        a: endpointLabel(c.a_device_id, c.a_interface),
        b: endpointLabel(c.b_device_id, c.b_interface),
        length: lengthText,
        label: c.label,
      };

      const p1 = anchorOf(el1, face1, containerRect, scale);
      const p2 = anchorOf(el2, face2, containerRect, scale);

      items.push({
        id: c.id,
        color: c.color ?? "#6B7280",
        labelText: labelParts.join(" · "),
        p1,
        p2,
        pairKey: `${id1}|${id2}`,
        side: face1 === "rear" || face2 === "rear" ? "right" : "left",
        info,
        yMin: Math.min(p1.y, p2.y),
        yMax: Math.max(p1.y, p2.y),
        cxRep: (p1.x + p2.x) / 2,
        lane: 0,
      });
    }

    // 2. Assign lanes per side so cables that would overlap don't hide each
    //    other. Two cables conflict if they're the same pair, OR they run along
    //    the same edge corridor (similar x) with overlapping vertical extents —
    //    e.g. a long top↔bottom cable vs. a short cable in the middle. Longest
    //    cables are placed first so they hug the edge (lane 0) and shorter
    //    overlapping ones bow outward to stay visible.
    const CORRIDOR_EPS = 8; // px: cables within this x distance share a corridor
    const conflicts = (a: Item, b: Item): boolean => {
      if (a.pairKey === b.pairKey) return true;
      const sameCorridor = Math.abs(a.cxRep - b.cxRep) < CORRIDOR_EPS;
      const overlapY = a.yMin < b.yMax && b.yMin < a.yMax;
      return sameCorridor && overlapY;
    };
    for (const sideName of ["left", "right"] as const) {
      const sideItems = items
        .filter((it) => it.side === sideName)
        .sort((a, b) => b.yMax - b.yMin - (a.yMax - a.yMin));
      const lanes: Item[][] = [];
      for (const it of sideItems) {
        let placed = false;
        for (let L = 0; L < lanes.length; L++) {
          if (!lanes[L]!.some((o) => conflicts(o, it))) {
            lanes[L]!.push(it);
            it.lane = L;
            placed = true;
            break;
          }
        }
        if (!placed) {
          it.lane = lanes.length;
          lanes.push([it]);
        }
      }
    }

    // 3. Group by device pair for label layout (callout columns).
    const groups = new Map<string, Item[]>();
    for (const it of items) {
      const arr = groups.get(it.pairKey);
      if (arr) arr.push(it);
      else groups.set(it.pairKey, [it]);
    }

    const next: typeof segments = [];
    for (const group of groups.values()) {
      const count = group.length;
      // All cables in a group share the same two endpoints, so geometry that
      // depends only on the endpoints is computed once for the whole group.
      const first = group[0]!;
      const { p1, p2, side } = first;
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
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;

      // Callout label column: stacked vertically and pushed clear of the
      // widest arc, on the same side the bundle fans toward.
      const dirX = side === "right" ? 1 : -1;
      const groupMaxLane = group.reduce((m, g) => Math.max(m, g.lane), 0);
      const maxPeak = (groupMaxLane * PAIR_SPACING) / 2;
      const labelDistance = Math.max(72, maxPeak + 44);
      const labelColumnX = midX + dirX * labelDistance;
      const ROW_HEIGHT = 16;
      const labelAnchor: "start" | "middle" | "end" =
        count > 1 ? (side === "right" ? "start" : "end") : "middle";

      group.forEach((it, i) => {
        // Bow magnitude comes from the globally-assigned lane: lane 0 hugs the
        // edge, higher lanes bow further out so overlapping cables (within this
        // pair AND across pairs sharing the edge) stay visible.
        const mag = it.lane * PAIR_SPACING;
        const cx = midX + nx * mag;
        const cy = midY + ny * mag;
        const d = `M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`;

        // Point on this cable's arc (peak, t=0.5) — where its leader attaches.
        const peakX = 0.25 * p1.x + 0.5 * cx + 0.25 * p2.x;
        const peakY = 0.25 * p1.y + 0.5 * cy + 0.25 * p2.y;

        let labelX: number;
        let labelY: number;
        let leader: { x1: number; y1: number; x2: number; y2: number } | null;

        if (count > 1) {
          // Spread labels into a vertical column with a dotted leader back to
          // the cable so each is clearly readable and attributable.
          labelX = labelColumnX;
          labelY = midY + (i - (count - 1) / 2) * ROW_HEIGHT;
          leader = {
            x1: peakX,
            y1: peakY,
            x2: labelX - dirX * 4,
            y2: labelY,
          };
        } else {
          // Single cable: keep the label inline on the arc, no leader.
          labelX = peakX;
          labelY = peakY - 4;
          leader = null;
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
          labelAnchor,
          leader,
          info: it.info,
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
          stroke-width={hoveredId === seg.id ? 5 : 3}
          stroke-linecap="round"
          opacity={hoveredId === seg.id ? 1 : 0.85}
        />
        <circle cx={seg.ax} cy={seg.ay} r="4" fill={seg.color} />
        <circle cx={seg.bx} cy={seg.by} r="4" fill={seg.color} />
        <!-- Transparent wide hit area for hovering -->
        <path
          class="cable-hit"
          d={seg.d}
          fill="none"
          stroke="transparent"
          stroke-width="14"
          role="presentation"
          onmouseenter={(e) => {
            hoveredId = seg.id;
            showCableTooltip(seg.info, e.clientX, e.clientY);
          }}
          onmousemove={(e) => moveCableTooltip(e.clientX, e.clientY)}
          onmouseleave={() => {
            if (hoveredId === seg.id) hoveredId = null;
            hideCableTooltip();
          }}
          oncontextmenu={(e) => openCableMenu(e, seg.id)}
        />
        {#if seg.labelText}
          {#if seg.leader}
            <line
              x1={seg.leader.x1}
              y1={seg.leader.y1}
              x2={seg.leader.x2}
              y2={seg.leader.y2}
              stroke={seg.color}
              stroke-width="1"
              stroke-dasharray="2 2"
              opacity="0.7"
            />
            <circle cx={seg.leader.x1} cy={seg.leader.y1} r="2" fill={seg.color} />
          {/if}
          <text
            x={seg.labelX}
            y={seg.labelY}
            text-anchor={seg.labelAnchor}
            dominant-baseline="middle"
            class="cable-label"
          >{seg.labelText}</text>
        {/if}
      </g>
    {/each}
  </svg>
{/if}

<CableContextMenu
  bind:open={menuOpen}
  x={menuX}
  y={menuY}
  onedit={editMenuCable}
  ondelete={deleteMenuCable}
/>

<style>
  /* Only the cable hit-areas capture pointer events; the rest of the overlay
     stays transparent to clicks/drags so panning and device selection work. */
  .cable-hit {
    pointer-events: stroke;
    cursor: pointer;
  }

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
