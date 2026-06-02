# Scripts

Utility scripts for build, maintenance, data import, and performance tasks.

## Build & Deployment

| Script                        | Purpose                                                       | Usage                                        |
| ----------------------------- | ------------------------------------------------------------- | -------------------------------------------- |
| `generate-bundled-images.ts`  | Generates `bundledImages.ts` from processed device images     | `npx tsx scripts/generate-bundled-images.ts` |
| `generate-gh-dash-config.js`  | Generates `.gh-dash.yml` with dynamic milestone detection     | `node scripts/generate-gh-dash-config.js`    |
| `verify-version-alignment.sh` | Verifies all published images report the same release version | `bash scripts/verify-version-alignment.sh`   |

## Maintenance

| Script                            | Purpose                                                                                     | Usage                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `check-compose-persist-parity.sh` | Checks docker-compose.yml parity between root and deploy/                                   | `bash scripts/check-compose-persist-parity.sh` |
| `backfill-labels.sh`              | One-time label cleanup: renames misspelled labels, merges duplicates, removes obsolete ones | `bash scripts/backfill-labels.sh`              |
| `update-contributors.ts`          | Updates contributors section in ACKNOWLEDGEMENTS.md                                         | `npx tsx scripts/update-contributors.ts`       |

## Data Import (NetBox)

Scripts for importing device definitions from the [NetBox devicetype-library](https://github.com/netbox-community/devicetype-library):

| Script                                  | Purpose                                                   | Scope                            |
| --------------------------------------- | --------------------------------------------------------- | -------------------------------- |
| `import-netbox-devices.ts`              | Full import from NetBox devicetype-library                | All vendors and devices          |
| `curated-import.ts`                     | Curated import of popular models                          | ~420 devices from select vendors |
| `bulk-import-netbox.ts`                 | Bulk import across multiple vendors                       | Multiple vendors, configurable   |
| `generate-netbox-homelab-candidates.ts` | Ranked net-new homelab candidates from local NetBox clone | Homelab-focused ranking          |

### `import-netbox-devices.ts` flags

| Flag               | Purpose                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| `--vendor <name>`  | Vendor folder name in NetBox (case-sensitive). **Required** (except `--list-vendors`).               |
| `--all`            | Import every device for the vendor.                                                                  |
| `--slug <name>`    | Import a single device by its NetBox YAML filename (e.g. `USW-Pro-24`).                               |
| `--write`          | Write definitions into `src/lib/data/brandPacks/<vendor>.ts`, creating + registering it in `index.ts` if new. Idempotent (de-dupes by slug). Without it, the generated TypeScript is only printed. |
| `--category <cat>` | Force a category for every device in the import, overriding auto-detection. Also **re-categorises devices already present** in the brand pack (so it fixes entries a previous no-`--category` run wrote as `other`). See values below. |
| `--list`           | List a vendor's available devices without importing.                                                 |
| `--list-vendors`   | List all available vendors.                                                                          |
| `--dry-run`        | Preview without writing or downloading.                                                              |
| `--images-only`    | Only download images; skip TypeScript updates.                                                       |

**Valid `--category` values** (must match the `DeviceCategory` union in [`src/lib/types/index.ts`](../src/lib/types/index.ts)):

| Category           | Typical devices                                          |
| ------------------ | -------------------------------------------------------- |
| `server`           | Servers, blades, compute nodes, workstations             |
| `network`          | Switches, routers, gateways, access points               |
| `firewall`         | Firewalls / security appliances                          |
| `patch-panel`      | Patch panels, keystone panels                            |
| `power`            | UPS, PDU, ATS, surge, battery modules                    |
| `storage`          | NAS, SAN, JBOD, disk shelves, NVR/DVR                    |
| `kvm`              | KVM, console / serial servers, IPMI                      |
| `av-media`         | Video matrices, capture, encoders/decoders               |
| `cooling`          | Fans, cooling/thermal units                              |
| `shelf`            | Rack shelves, trays                                      |
| `blank`            | Blanking panels                                          |
| `cable-management` | Cable managers, wire ducts, brush panels                 |
| `chassis`          | Blade/server chassis, enclosures                         |
| `other`            | Neutral fallback when nothing else fits                  |

```bash
# Fully automated, idempotent import for CI/Docker (one vendor per run):
npx tsx scripts/import-netbox-devices.ts --vendor Eaton --all --write --category power
npm run process-images
npm run generate-bundled-images
```

See [docs/guides/NETBOX-IMPORT.md](../docs/guides/NETBOX-IMPORT.md) for the full guide.

## Image Processing

| Script              | Purpose                                                                                                       | Usage                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `process-images.ts` | Processes device images from `assets-source/` to `src/lib/assets/device-images/` (resizes to 400px max width) | `npx tsx scripts/process-images.ts` |
| `audit-images.ts`   | Compares source vs processed images to detect clipping                                                        | `npx tsx scripts/audit-images.ts`   |

## Performance

| Script                       | Purpose                                                                           | Usage                                        |
| ---------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------- |
| `performance-benchmark.ts`   | Measures render performance at various device and port counts                     | `npx tsx scripts/performance-benchmark.ts`   |
| `measure-startup-payload.ts` | Measures startup payload from `dist/index.html` modulepreload + entry script refs | `npx tsx scripts/measure-startup-payload.ts` |
