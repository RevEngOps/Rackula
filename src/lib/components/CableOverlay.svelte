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

  function duplicateMenuCable() {
    if (!menuCableId) return;
    const res = cableStore.duplicateCable(menuCableId);
    if (res.errors) {
      toastStore.showToast(res.errors.join(" "), "error");
    } else {
      toastStore.showToast("Cable duplicated", "success");
    }
  }

  function deleteMenuCable() {
    if (!menuCableId) return;
    cableStore.removeCable(menuCableId);
    toastStore.showToast("Cable removed", "info");
  }
  let resizeTick = $state(0);

  // Horizontal spacing (content px) between adjacent cable lanes. Wider spacing
  // keeps the hit areas from overlapping so hover is reliable.
  const PAIR_SPACING = 34;

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

  // Find a device's rendered element, preferring the requested face when the
  // device spans both views (face: 'both' → two elements). Falls back to the
  // first rendered element.
  function findDeviceEl(
    container: Element,
    id: string,
    face?: "front" | "rear",
  ): Element | null {
    const els = container.querySelectorAll(`[data-placed-id="${id}"]`);
    if (face) {
      for (const el of els) {
        if (el.getAttribute("data-rack-view") === face) return el;
      }
    }
    return els[0] ?? null;
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
      const aEl = findDeviceEl(container, c.a_device_id, c.a_face);
      const bEl = findDeviceEl(container, c.b_device_id, c.b_face);
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

    // 4. Build cable geometry. Label positions are filled in afterwards by a
    //    global per-side/edge pass so labels from DIFFERENT appliances don't
    //    overlap either (not just within one device pair).
    type Placed = {
      seg: (typeof segments)[number];
      side: "left" | "right";
      attachX: number;
      attachY: number;
      baseX: number;
    };
    const placed: Placed[] = [];

    for (const group of groups.values()) {
      const first = group[0]!;
      const { p1, p2, side } = first;
      const dirX = side === "right" ? 1 : -1;
      const y1 = p1.y;
      const y2 = p2.y;
      const midY = (y1 + y2) / 2;
      // Outermost endpoint x — brackets stick out beyond this on the fan side.
      const baseX = side === "right" ? Math.max(p1.x, p2.x) : Math.min(p1.x, p2.x);

      for (const it of group) {
        // Squared (orthogonal) route: out from the device edge to this lane's x,
        // along to the other endpoint's y, then back. Lane comes from the global
        // assignment so overlapping cables get distinct, well-separated tracks.
        const mag = it.lane * PAIR_SPACING;
        const laneX = baseX + dirX * mag;
        const d = `M ${p1.x} ${y1} L ${laneX} ${y1} L ${laneX} ${y2} L ${p2.x} ${y2}`;

        placed.push({
          side,
          attachX: laneX, // leader attaches at the middle of the vertical track
          attachY: midY,
          baseX,
          seg: {
            id: it.id,
            color: it.color,
            d,
            ax: p1.x,
            ay: p1.y,
            bx: p2.x,
            by: p2.y,
            labelX: 0,
            labelY: 0,
            labelText: it.labelText,
            labelAnchor: side === "right" ? "start" : "end",
            leader: { x1: laneX, y1: midY, x2: 0, y2: 0 },
            info: it.info,
          },
        });
      }
    }

    // 5. Lay labels out in columns grouped by side + edge corridor (so each rack
    //    edge gets its own column), stacking them with no vertical overlap.
    const LABEL_GAP = 48;
    const ROW_HEIGHT = 16;
    const colGroups = new Map<string, Placed[]>();
    for (const p of placed) {
      const key = `${p.side}|${Math.round(p.baseX / 8)}`;
      const arr = colGroups.get(key);
      if (arr) arr.push(p);
      else colGroups.set(key, [p]);
    }
    for (const grp of colGroups.values()) {
      const side = grp[0]!.side;
      const dirX = side === "right" ? 1 : -1;
      // Column sits beyond the furthest track in this corridor.
      const extreme =
        side === "right"
          ? Math.max(...grp.map((p) => p.attachX))
          : Math.min(...grp.map((p) => p.attachX));
      const columnX = extreme + dirX * LABEL_GAP;

      // Sort by the cable's natural y, then push each down so consecutive
      // labels are at least ROW_HEIGHT apart — removes cross-appliance overlap.
      grp.sort((a, b) => a.attachY - b.attachY);
      let lastY = -Infinity;
      for (const p of grp) {
        const y = Math.max(p.attachY, lastY + ROW_HEIGHT);
        lastY = y;
        p.seg.labelX = columnX;
        p.seg.labelY = y;
        p.seg.leader = {
          x1: p.attachX,
          y1: p.attachY,
          x2: columnX - dirX * 4,
          y2: y,
        };
      }
    }

    segments = placed.map((p) => p.seg);
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
          stroke-width="10"
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
  onduplicate={duplicateMenuCable}
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
