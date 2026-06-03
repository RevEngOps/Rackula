<!--
  CablesPanel
  Sidebar panel for managing ethernet (and other) cables between devices.
  Device-to-device connections with colour, type and length. Multiple cables
  are allowed between the same two devices.
-->
<script lang="ts">
  // @ts-nocheck
  import { getLayoutStore } from "$lib/stores/layout.svelte";
  import { getCableStore } from "$lib/stores/cables.svelte";
  import { getUIStore } from "$lib/stores/ui.svelte";
  import { getToastStore } from "$lib/stores/toast.svelte";
  import { toHumanUnits } from "$lib/utils/position";
  import ColourPicker from "./ColourPicker.svelte";
  import type { Cable, CableType, LengthUnit } from "$lib/types";

  const layoutStore = getLayoutStore();
  const cableStore = getCableStore();
  const uiStore = getUIStore();
  const toastStore = getToastStore();

  const DEFAULT_COLOUR = "#2563EB";

  const CABLE_TYPES: { value: CableType; label: string }[] = [
    { value: "cat5e", label: "Cat5e" },
    { value: "cat6", label: "Cat6" },
    { value: "cat6a", label: "Cat6a" },
    { value: "cat7", label: "Cat7" },
    { value: "cat8", label: "Cat8" },
    { value: "dac-passive", label: "DAC (passive)" },
    { value: "dac-active", label: "DAC (active)" },
    { value: "mmf-om3", label: "Fiber OM3" },
    { value: "mmf-om4", label: "Fiber OM4" },
    { value: "smf-os2", label: "Fiber OS2" },
    { value: "aoc", label: "AOC" },
    { value: "power", label: "Power" },
    { value: "serial", label: "Serial" },
  ];

  const LENGTH_UNITS: LengthUnit[] = ["m", "cm", "ft", "in"];

  // Common ethernet jacket colours.
  const COLOUR_PRESETS = [
    "#2563EB", // blue
    "#16A34A", // green
    "#EAB308", // yellow
    "#DC2626", // red
    "#EA580C", // orange
    "#6B7280", // grey
    "#9333EA", // purple
    "#111827", // black
    "#FFFFFF", // white
  ];

  interface DeviceOption {
    id: string;
    label: string;
  }

  const deviceOptions = $derived.by<DeviceOption[]>(() => {
    const opts: DeviceOption[] = [];
    for (const rack of layoutStore.racks) {
      for (const d of rack.devices) {
        const dt = layoutStore.device_types.find(
          (t) => t.slug === d.device_type,
        );
        const name =
          d.name || d.label || dt?.model || dt?.slug || d.device_type;
        opts.push({
          id: d.id,
          label: `${name} — ${rack.name} (U${toHumanUnits(d.position)})`,
        });
      }
    }
    return opts;
  });

  const cables = $derived(cableStore.cables);

  function deviceLabel(id: string): string {
    return deviceOptions.find((o) => o.id === id)?.label ?? "(removed device)";
  }

  function cableTypeLabel(type: CableType | undefined): string {
    return CABLE_TYPES.find((t) => t.value === type)?.label ?? "Cable";
  }

  // --- Form state ---
  let showForm = $state(false);
  let editingId = $state<string | null>(null);
  let aDeviceId = $state("");
  let bDeviceId = $state("");
  let aInterface = $state("");
  let bInterface = $state("");
  let cableType = $state<CableType>("cat6");
  let colour = $state(DEFAULT_COLOUR);
  let lengthValue = $state("");
  let lengthUnit = $state<LengthUnit>("m");
  let label = $state("");
  let formError = $state<string | null>(null);

  function resetForm() {
    editingId = null;
    aDeviceId = "";
    bDeviceId = "";
    aInterface = "";
    bInterface = "";
    cableType = "cat6";
    colour = DEFAULT_COLOUR;
    lengthValue = "";
    lengthUnit = "m";
    label = "";
    formError = null;
  }

  function openAdd() {
    resetForm();
    showForm = true;
  }

  function openEdit(cable: Cable) {
    editingId = cable.id;
    aDeviceId = cable.a_device_id;
    bDeviceId = cable.b_device_id;
    aInterface = cable.a_interface ?? "";
    bInterface = cable.b_interface ?? "";
    cableType = cable.type ?? "cat6";
    colour = cable.color ?? DEFAULT_COLOUR;
    lengthValue = cable.length != null ? String(cable.length) : "";
    lengthUnit = cable.length_unit ?? "m";
    label = cable.label ?? "";
    formError = null;
    showForm = true;
  }

  function cancelForm() {
    showForm = false;
    resetForm();
  }

  function submitForm() {
    formError = null;
    if (!aDeviceId || !bDeviceId) {
      formError = "Select both devices.";
      return;
    }
    // <input type="number"> binds as a number (or null when empty); it may
    // also still be the initial empty string — handle all of these.
    let lengthNum: number | undefined;
    const rawLength =
      typeof lengthValue === "string" ? lengthValue.trim() : lengthValue;
    if (rawLength !== "" && rawLength !== null && rawLength !== undefined) {
      lengthNum = Number(rawLength);
      if (!Number.isFinite(lengthNum) || lengthNum <= 0) {
        formError = "Length must be a positive number.";
        return;
      }
    }

    const payload = {
      a_device_id: aDeviceId,
      b_device_id: bDeviceId,
      a_interface: aInterface.trim() || undefined,
      b_interface: bInterface.trim() || undefined,
      type: cableType,
      color: colour,
      label: label.trim() || undefined,
      length: lengthNum,
      length_unit: lengthNum !== undefined ? lengthUnit : undefined,
    };

    if (editingId) {
      const res = cableStore.updateCable(editingId, payload);
      if (!res.success) {
        formError = res.errors.join(" ");
        return;
      }
      toastStore.showToast("Cable updated", "success");
    } else {
      const res = cableStore.addCable(payload);
      if (res.errors) {
        formError = res.errors.join(" ");
        return;
      }
      toastStore.showToast("Cable added", "success");
    }
    showForm = false;
    resetForm();
  }

  function handleDelete(id: string) {
    cableStore.removeCable(id);
    toastStore.showToast("Cable removed", "info");
    if (editingId === id) cancelForm();
  }
</script>

<div class="cables-panel">
  <div class="panel-header">
    <span class="panel-title">Cables</span>
    <label class="overlay-toggle" title="Show cable lines on the rack">
      <input
        type="checkbox"
        checked={uiStore.showCables}
        onchange={() => uiStore.toggleCables()}
      />
      <span>Show on rack</span>
    </label>
  </div>

  {#if deviceOptions.length < 2}
    <p class="empty">Place at least two devices in a rack to connect them with a cable.</p>
  {:else}
    {#if !showForm}
      <button class="add-btn" onclick={openAdd}>+ Add cable</button>
    {/if}

    {#if showForm}
      <form class="cable-form" onsubmit={(e) => { e.preventDefault(); submitForm(); }}>
        <label class="field">
          <span>From device</span>
          <select bind:value={aDeviceId}>
            <option value="" disabled>Select device…</option>
            {#each deviceOptions as opt (opt.id)}
              <option value={opt.id}>{opt.label}</option>
            {/each}
          </select>
        </label>

        <label class="field">
          <span>Port / interface (optional)</span>
          <input type="text" bind:value={aInterface} placeholder="e.g. Gi1/0/1" />
        </label>

        <label class="field">
          <span>To device</span>
          <select bind:value={bDeviceId}>
            <option value="" disabled>Select device…</option>
            {#each deviceOptions as opt (opt.id)}
              <option value={opt.id}>{opt.label}</option>
            {/each}
          </select>
        </label>

        <label class="field">
          <span>Port / interface (optional)</span>
          <input type="text" bind:value={bInterface} placeholder="e.g. eth0" />
        </label>

        <label class="field">
          <span>Cable type</span>
          <select bind:value={cableType}>
            {#each CABLE_TYPES as t (t.value)}
              <option value={t.value}>{t.label}</option>
            {/each}
          </select>
        </label>

        <div class="field">
          <span>Colour</span>
          <div class="swatches">
            {#each COLOUR_PRESETS as preset (preset)}
              <button
                type="button"
                class="swatch"
                class:active={colour.toUpperCase() === preset.toUpperCase()}
                style="background:{preset}"
                aria-label="Use colour {preset}"
                onclick={() => (colour = preset)}
              ></button>
            {/each}
          </div>
          <ColourPicker value={colour} onchange={(c) => (colour = c)} />
        </div>

        <div class="field length-field">
          <span>Length (optional)</span>
          <div class="length-row">
            <input
              type="number"
              min="0"
              step="0.1"
              bind:value={lengthValue}
              placeholder="0"
            />
            <select bind:value={lengthUnit}>
              {#each LENGTH_UNITS as u (u)}
                <option value={u}>{u}</option>
              {/each}
            </select>
          </div>
        </div>

        <label class="field">
          <span>Label (optional)</span>
          <input type="text" bind:value={label} placeholder="e.g. Uplink A" />
        </label>

        {#if formError}
          <p class="form-error" role="alert">{formError}</p>
        {/if}

        <div class="form-actions">
          <button type="button" class="btn-secondary" onclick={cancelForm}>Cancel</button>
          <button type="submit" class="btn-primary">
            {editingId ? "Save changes" : "Add cable"}
          </button>
        </div>
      </form>
    {/if}

    <ul class="cable-list">
      {#each cables as cable (cable.id)}
        <li class="cable-item">
          <span class="cable-colour" style="background:{cable.color ?? '#6B7280'}"></span>
          <div class="cable-info">
            <div class="cable-endpoints">
              {deviceLabel(cable.a_device_id)}{cable.a_interface ? ` : ${cable.a_interface}` : ""}
              <span class="arrow">↔</span>
              {deviceLabel(cable.b_device_id)}{cable.b_interface ? ` : ${cable.b_interface}` : ""}
            </div>
            <div class="cable-meta">
              <span>{cableTypeLabel(cable.type)}</span>
              {#if cable.length != null}
                <span>· {cable.length}{cable.length_unit ?? ""}</span>
              {/if}
              {#if cable.label}
                <span>· {cable.label}</span>
              {/if}
            </div>
          </div>
          <div class="cable-actions">
            <button class="icon-btn" title="Edit cable" onclick={() => openEdit(cable)}>✎</button>
            <button class="icon-btn danger" title="Delete cable" onclick={() => handleDelete(cable.id)}>🗑</button>
          </div>
        </li>
      {:else}
        <li class="empty-item">No cables yet. Add one to connect two devices.</li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .cables-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    overflow-y: auto;
    height: 100%;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .panel-title {
    font-weight: var(--font-weight-semibold, 600);
    font-size: var(--font-size-md, 1rem);
  }

  .overlay-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-sm);
    color: var(--colour-text-muted);
    cursor: pointer;
  }

  .empty,
  .empty-item {
    color: var(--colour-text-muted);
    font-size: var(--font-size-sm);
    padding: var(--space-2) 0;
  }

  .add-btn {
    align-self: flex-start;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--colour-border);
    border-radius: var(--radius-sm);
    background: var(--colour-surface, transparent);
    color: var(--colour-text);
    cursor: pointer;
    font-size: var(--font-size-sm);
  }

  .add-btn:hover {
    border-color: var(--colour-selection);
  }

  .cable-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--colour-border);
    border-radius: var(--radius-md, 6px);
    background: var(--colour-sidebar-bg);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--font-size-sm);
  }

  .field > span {
    color: var(--colour-text-muted);
  }

  .field select,
  .field input[type="text"],
  .field input[type="number"] {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--colour-border);
    border-radius: var(--radius-sm);
    background: var(--colour-input-bg, var(--colour-bg, #fff));
    color: var(--colour-text);
    font-size: var(--font-size-sm);
    width: 100%;
  }

  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .swatch {
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--colour-border);
    cursor: pointer;
    padding: 0;
  }

  .swatch.active {
    outline: 2px solid var(--colour-selection);
    outline-offset: 1px;
  }

  .length-row {
    display: flex;
    gap: var(--space-1);
  }

  .length-row input {
    flex: 1;
  }

  .length-row select {
    width: 4.5rem;
  }

  .form-error {
    color: var(--colour-danger, #dc2626);
    font-size: var(--font-size-sm);
    margin: 0;
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .btn-primary,
  .btn-secondary {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--font-size-sm);
    border: 1px solid var(--colour-border);
  }

  .btn-primary {
    background: var(--colour-selection);
    color: var(--colour-on-selection, #fff);
    border-color: var(--colour-selection);
  }

  .btn-secondary {
    background: transparent;
    color: var(--colour-text);
  }

  .cable-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .cable-item {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--colour-border);
    border-radius: var(--radius-sm);
  }

  .cable-colour {
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    margin-top: 2px;
    border: 1px solid var(--colour-border);
  }

  .cable-info {
    flex: 1;
    min-width: 0;
  }

  .cable-endpoints {
    font-size: var(--font-size-sm);
    color: var(--colour-text);
    word-break: break-word;
  }

  .arrow {
    color: var(--colour-text-muted);
    margin: 0 2px;
  }

  .cable-meta {
    font-size: var(--font-size-xs, 0.75rem);
    color: var(--colour-text-muted);
    margin-top: 2px;
  }

  .cable-actions {
    display: flex;
    gap: var(--space-1);
  }

  .icon-btn {
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 0.9rem;
    color: var(--colour-text-muted);
    padding: 2px 4px;
    border-radius: var(--radius-sm);
  }

  .icon-btn:hover {
    background: var(--colour-hover, rgba(127, 127, 127, 0.15));
    color: var(--colour-text);
  }

  .icon-btn.danger:hover {
    color: var(--colour-danger, #dc2626);
  }
</style>
