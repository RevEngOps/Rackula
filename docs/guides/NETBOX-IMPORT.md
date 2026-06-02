# NetBox Device Import Guide

This guide explains how to import devices from the [NetBox community devicetype-library](https://github.com/netbox-community/devicetype-library) into Rackula.

## Quick Start

### Complete Import Workflow

```bash
# 1. Import devices AND write them into the brand pack file.
#    --write merges the device definitions into src/lib/data/brandPacks/<vendor>.ts
#    (creating + registering the file in index.ts if the vendor is new) and
#    downloads images. Omit --write to only print the TypeScript for manual pasting.
npx tsx scripts/import-netbox-devices.ts --vendor HPE --all --write

# 2. Process images (convert to optimized WebP)
npm run process-images

# 3. Generate bundled images manifest (register images for bundling)
npm run generate-bundled-images

# 4. Verify build works
npm run build
```

> **Fully automated builds (CI / Docker):** the four commands above are all you
> need — with `--write`, no manual editing of brand pack files or
> `bundledImages.ts` is required. Run the import once per vendor (each `--write`
> run targets a single `--vendor`). See [Automatic vs. Manual Import](#automatic-vs-manual-import).

### Using the Import Script

```bash
# List available devices from a vendor
npx tsx scripts/import-netbox-devices.ts --vendor Ubiquiti --list

# Import a specific device and write it into the brand pack
npx tsx scripts/import-netbox-devices.ts --vendor Ubiquiti --slug USW-Pro-24 --write

# Import all devices from a vendor (dry run first!)
npx tsx scripts/import-netbox-devices.ts --vendor Dell --all --write --dry-run
npx tsx scripts/import-netbox-devices.ts --vendor Dell --all --write

# Force a category for the whole import (overrides auto-detection)
npx tsx scripts/import-netbox-devices.ts --vendor Eaton --all --write --category power
```

**Key flags:**

| Flag               | Effect                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `--write`          | Merge devices into `src/lib/data/brandPacks/<vendor>.ts` (create + register in `index.ts` if new).      |
| `--category <cat>` | Force the category for every imported device, overriding auto-detection (see [Category Mapping](#category-mapping)). |
| `--dry-run`        | Preview what would be imported/written without making changes.                                          |
| `--images-only`    | Only download images; skip TypeScript updates.                                                          |

> Without `--write` the script only **prints** the generated TypeScript for you
> to paste manually (the original behaviour).

> **Note on `--slug`:** the value is the NetBox YAML **filename** (e.g.
> `USW-Pro-24`), not the lowercase Rackula device slug.

### Using GitHub Actions

1. Go to **Actions** → **Import NetBox Devices**
2. Click **Run workflow**
3. Enter the vendor name and optionally a specific slug (NetBox YAML filename)
4. Leave **write** enabled to write device definitions into the brand pack
   (disable it to only print/download). Optionally set **category** to force a
   category instead of auto-detecting.
5. Enable **Dry run** to preview changes first
6. The action imports devices, processes images, regenerates `bundledImages.ts`,
   and opens a PR with the result

## Automatic vs. Manual Import

With `--write`, the import script writes device definitions directly into the
brand pack source, so the **automatic** path needs no hand-editing:

- **Existing vendor** (e.g. `eaton.ts` already exists): new devices are merged
  into the exported array, de-duped by `slug`, so re-runs are idempotent and
  your curated entries are preserved.
- **New vendor** (no brand pack file yet): a `src/lib/data/brandPacks/<vendor>.ts`
  is created and registered in `index.ts` (import, re-export, `getBrandPacks()`,
  `getBrandDevices()`, and `getAllBrandDevices()`).

Generated code matches the repo's formatting (2-space indent, double quotes) and
preserves the target file's existing line endings.

The **manual** process below is only needed if you prefer to hand-curate entries
(or run the script without `--write`). Note that only **rack-mountable** devices
(`u_height >= 1`) are imported; 0U devices such as access points and vertical
PDUs are skipped.

## Manual Import Process

### Step 1: Find Device in NetBox Library

Browse the [NetBox devicetype-library](https://github.com/netbox-community/devicetype-library/tree/master/device-types) to find devices.

**Directory structure:**

```
device-types/
├── Ubiquiti/
│   ├── USW-Pro-24.yaml
│   └── ...
├── Dell/
│   ├── PowerEdge-R640.yaml
│   └── ...
└── ...
```

### Step 2: Download Device YAML

Example Ubiquiti switch YAML:

```yaml
manufacturer: Ubiquiti
model: USW-Pro-24
slug: ubiquiti-usw-pro-24
u_height: 1
is_full_depth: false
front_image: true
rear_image: true
```

### Step 3: Convert to TypeScript

Map NetBox fields to Rackula `DeviceType`:

| NetBox Field    | Rackula Field   | Notes                              |
| --------------- | --------------- | ---------------------------------- |
| `slug`          | `slug`          | Direct mapping                     |
| `manufacturer`  | `manufacturer`  | Direct                             |
| `model`         | `model`         | Direct                             |
| `u_height`      | `u_height`      | Direct                             |
| `is_full_depth` | `is_full_depth` | Default: `true`                    |
| `front_image`   | `front_image`   | Boolean flag                       |
| `rear_image`    | `rear_image`    | Boolean flag                       |
| `airflow`       | `airflow`       | Optional                           |
| —               | `colour`        | Use `CATEGORY_COLOURS.{category}`  |
| —               | `category`      | Infer from device type (see below) |

**TypeScript result:**

```typescript
{
  slug: 'ubiquiti-usw-pro-24',
  u_height: 1,
  manufacturer: 'Ubiquiti',
  model: 'USW-Pro-24',
  is_full_depth: false,
  colour: CATEGORY_COLOURS.network,
  category: 'network',
  front_image: true,
  rear_image: true
}
```

### Step 4: Download Elevation Images

Images are in the `elevation-images/` directory:

```
elevation-images/
├── Ubiquiti/
│   ├── ubiquiti-usw-pro-24.front.png
│   ├── ubiquiti-usw-pro-24.rear.png
│   └── ...
└── ...
```

**URL pattern:**

```
https://raw.githubusercontent.com/netbox-community/devicetype-library/master/elevation-images/{Vendor}/{slug}.{face}.png
```

**Download to:**

```
assets-source/device-images/{vendor}/{slug}.{face}.png
```

### Step 5: Process Images

Run the image processor to convert to optimized WebP:

```bash
npm run process-images
```

This:

- Reads from `assets-source/device-images/`
- Resizes to max 400px width (preserves aspect ratio)
- Converts to WebP format
- Outputs to `src/lib/assets/device-images/`

### Step 6: Generate bundledImages.ts

Run the bundled images generator to register new images:

```bash
npm run generate-bundled-images
```

This:

- Scans `src/lib/assets/device-images/` for vendor subdirectories
- Parses image paths to extract slug and face (front/rear)
- Groups images by device slug
- Auto-generates ES module imports and manifest entries
- Preserves the starter library (manually maintained generic devices)

**Output example:**

```
🖼️  Bundled Images Generator
============================

Found 366 device images
Parsed 366 valid images
Grouped into 206 device entries

By vendor:
  apc: 29 devices
  dell: 21 devices
  hpe: 12 devices
  ubiquiti: 48 devices
  ...

✅ Generated: src/lib/data/bundledImages.ts
```

> **Note:** The generator automatically creates proper import statements and manifest entries. You no longer need to manually edit `bundledImages.ts` for brand pack images.

### Step 7: Add to Brand Pack

> **Tip:** running the import with `--write` does this step for you (merging into
> the existing file or creating + registering a new one). The manual steps below
> apply only when running without `--write`.

Add device to the appropriate brand pack file in `src/lib/data/brandPacks/`:

```typescript
// src/lib/data/brandPacks/ubiquiti.ts
export const ubiquitiDevices: DeviceType[] = [
	// ... existing devices
	{
		slug: 'ubiquiti-usw-pro-24',
		u_height: 1,
		manufacturer: 'Ubiquiti',
		model: 'USW-Pro-24',
		is_full_depth: false,
		colour: CATEGORY_COLOURS.network,
		category: 'network',
		front_image: true,
		rear_image: true
	}
];
```

## Category Mapping

When `--category` is **not** given, the script infers a category from the
manufacturer + model + slug using an ordered keyword match (first match wins):

| Keywords (in name/slug)                                  | Rackula Category  |
| -------------------------------------------------------- | ----------------- |
| firewall, fortigate, palo, pfsense, sonicwall, utm       | `firewall`        |
| kvm, console server, serial console, ipmi                | `kvm`             |
| switch, router, gateway, access point, wireless, sfp, poe | `network`        |
| ups, pdu, ats, surge, isobar, ebm, battery, inverter, psu | `power`          |
| nas, san, jbod, storage, diskstation, rackstation, nvr   | `storage`         |
| hdmi, sdi, atem, decklink, capture, encoder, decoder     | `av-media`        |
| fan, cooling, thermal, crac, crah                        | `cooling`         |
| patch panel, keystone, patch                             | `patch-panel`     |
| cable manage, lacing, wire duct, brush panel             | `cable-management`|
| shelf, tray, plenum                                      | `shelf`           |
| chassis, enclosure, bladecenter                          | `chassis`         |
| server, poweredge, proliant, node, blade, workstation    | `server`          |
| _no match_                                               | `other`           |

Heuristics are imperfect for mixed-catalog vendors. **For a guaranteed result,
pin the category** for the whole import:

```bash
# Every imported device is written as category: 'power'
npx tsx scripts/import-netbox-devices.ts --vendor Eaton --all --write --category power
```

> **`--category` also re-categorises existing devices.** Because the import
> de-dupes by slug, a device that was already written (e.g. as `other` by an
> earlier run without `--category`) is normally skipped. When you pass
> `--category`, the script additionally rewrites the `category` (and colour) of
> those already-present devices, so re-running with `--category power` fixes the
> whole pack. Use `--dry-run` to preview how many entries would change.

`--category` accepts: `server`, `network`, `firewall`, `patch-panel`, `power`,
`storage`, `kvm`, `av-media`, `cooling`, `shelf`, `blank`, `cable-management`,
`chassis`, `other`.

## Quality Checklist

Before committing imported devices:

- [ ] Slug matches NetBox convention (`{manufacturer}-{product-line}-{model}`)
- [ ] `u_height` is correct (check NetBox YAML)
- [ ] `is_full_depth` is set correctly
- [ ] Category is appropriate for device type
- [ ] Front/rear images downloaded (if available)
- [ ] Images processed to WebP (`npm run process-images`)
- [ ] `bundledImages.ts` regenerated (`npm run generate-bundled-images`)
- [ ] Brand pack file updated
- [ ] Build succeeds (`npm run build`)
- [ ] Tests pass (`npm run test:run`)

## Slug Naming Convention

Rackula uses NetBox-compatible slugs:

**Pattern:** `{manufacturer}-{product-line}-{model}`

**Examples:**

- `ubiquiti-usw-pro-24` (UniFi Switch Pro 24)
- `dell-poweredge-r640` (Dell PowerEdge R640)
- `synology-rs1221-plus` (Synology RS1221+)

**Rules:**

- Lowercase
- Kebab-case (hyphens, no underscores)
- No special characters (+ becomes `-plus`)
- Must be unique across all devices

## Troubleshooting

### Image not found

Not all NetBox devices have elevation images. Check the `elevation-images/` directory for your vendor.

### Wrong aspect ratio

The `process-images.ts` script uses `fit: 'inside'` which preserves aspect ratio. If images appear stretched, check the source image.

### Slug mismatch

NetBox YAML filenames don't always match the slug inside. Use the `slug` field from the YAML, not the filename.

## License

NetBox devicetype-library is licensed under **CC0 1.0 Universal** (Public Domain):

- No attribution required
- Can modify and redistribute freely
- Commercial use allowed
