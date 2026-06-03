<!--
  CableContextMenu Component
  Right-click context menu for cables in the canvas overlay.
  Virtual-trigger mode only (anchored to cursor coordinates), since cables are
  SVG paths that can't wrap a trigger element. Mirrors DeviceContextMenu.
-->
<script lang="ts">
  // @ts-nocheck
  import { ContextMenu } from "bits-ui";
  import "$lib/styles/context-menus.css";

  interface Props {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    onedit?: () => void;
    ondelete?: () => void;
    /** Cursor viewport coordinates the menu anchors to. */
    x?: number;
    y?: number;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    onedit,
    ondelete,
    x,
    y,
  }: Props = $props();

  // Anchor to the cursor's viewport coordinates via a Measurable virtual
  // element (the menu lives inside the transformed canvas, so a fixed trigger
  // would be re-based by the CSS transform — see DeviceContextMenu).
  const virtualAnchor = $derived(
    x !== undefined && y !== undefined
      ? { getBoundingClientRect: () => new DOMRect(x ?? 0, y ?? 0, 0, 0) }
      : null,
  );

  function handleSelect(action?: () => void) {
    return () => {
      action?.();
      open = false;
    };
  }

  function handleOpenChange(newOpen: boolean) {
    open = newOpen;
    onOpenChange?.(newOpen);
  }
</script>

<ContextMenu.Root {open} onOpenChange={handleOpenChange}>
  <ContextMenu.Trigger />
  <ContextMenu.Portal>
    <ContextMenu.Content
      class="context-menu-content"
      sideOffset={5}
      customAnchor={virtualAnchor}
    >
      <ContextMenu.Item class="context-menu-item" onSelect={handleSelect(onedit)}>
        <span class="context-menu-label">Edit</span>
      </ContextMenu.Item>

      <ContextMenu.Separator class="context-menu-separator" />

      <ContextMenu.Item
        class="context-menu-item context-menu-item--destructive"
        onSelect={handleSelect(ondelete)}
      >
        <span class="context-menu-label">Delete</span>
        <span class="context-menu-shortcut">Del</span>
      </ContextMenu.Item>
    </ContextMenu.Content>
  </ContextMenu.Portal>
</ContextMenu.Root>
