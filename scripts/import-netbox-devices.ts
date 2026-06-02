#!/usr/bin/env npx tsx
/**
 * NetBox Device Import Script
 *
 * Imports device definitions and images from the NetBox devicetype-library.
 * Can be run locally or as a GitHub Action.
 *
 * Usage:
 *   npx tsx scripts/import-netbox-devices.ts --vendor Ubiquiti --slug ubiquiti-usw-pro-24
 *   npx tsx scripts/import-netbox-devices.ts --vendor Ubiquiti --all
 *   npx tsx scripts/import-netbox-devices.ts --vendor Ubiquiti --list
 *   npx tsx scripts/import-netbox-devices.ts --list-vendors
 *
 * Options:
 *   --vendor <name>   Vendor name (case-sensitive, matches NetBox folder name)
 *   --slug <slug>     Import a specific device by slug
 *   --all             Import all devices from the vendor
 *   --list            List available devices without importing
 *   --list-vendors    List all available vendors
 *   --dry-run         Show what would be imported without making changes
 *   --images-only     Only download images, don't update TypeScript files
 *   --write           Write device definitions into the brand pack file
 *                     (src/lib/data/brandPacks/<vendor>.ts), creating and
 *                     registering it in index.ts if it does not yet exist.
 *                     Without this flag the script only prints the generated
 *                     TypeScript for manual pasting (legacy behaviour).
 */

import { writeFile, readFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, "..");

// NetBox repository URLs
const NETBOX_RAW_BASE =
  "https://raw.githubusercontent.com/netbox-community/devicetype-library/master";
const NETBOX_API_BASE =
  "https://api.github.com/repos/netbox-community/devicetype-library/contents";

// Local paths
const ASSETS_SOURCE_DIR = join(ROOT_DIR, "assets-source", "device-images");

interface NetBoxDevice {
  manufacturer: string;
  model: string;
  slug: string;
  u_height: number;
  is_full_depth?: boolean;
  front_image?: boolean;
  rear_image?: boolean;
  airflow?: string;
  weight?: number;
  weight_unit?: string;
  subdevice_role?: string;
  comments?: string;
}

interface ImportOptions {
  vendor: string;
  slug?: string;
  all?: boolean;
  list?: boolean;
  listVendors?: boolean;
  dryRun?: boolean;
  imagesOnly?: boolean;
  write?: boolean;
  category?: string;
}

function parseArgs(): ImportOptions {
  const args = process.argv.slice(2);
  const options: ImportOptions = { vendor: "" };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--vendor":
        options.vendor = args[++i];
        break;
      case "--slug":
        options.slug = args[++i];
        break;
      case "--all":
        options.all = true;
        break;
      case "--list":
        options.list = true;
        break;
      case "--list-vendors":
        options.listVendors = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--images-only":
        options.imagesOnly = true;
        break;
      case "--write":
        options.write = true;
        break;
      case "--category":
        options.category = args[++i];
        break;
      case "--help":
        printHelp();
        process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
NetBox Device Import Script

Usage:
  npx tsx scripts/import-netbox-devices.ts --vendor <name> [options]

Options:
  --vendor <name>   Vendor name (required, case-sensitive)
  --slug <slug>     Import a specific device by slug
  --all             Import all rack-mountable devices from vendor
  --list            List available devices without importing
  --list-vendors    List all available vendors
  --dry-run         Show what would be imported without changes
  --images-only     Only download images, skip TypeScript updates
  --write           Write device definitions into the brand pack .ts file
                    (and register a new vendor in index.ts). Without it the
                    generated TypeScript is only printed for manual pasting.
  --category <cat>  Force a category for every imported device, overriding
                    auto-detection. One of: server, network, firewall,
                    patch-panel, power, storage, kvm, av-media, cooling,
                    shelf, blank, cable-management, chassis, other.
  --help            Show this help message

Examples:
  # List all Ubiquiti devices
  npx tsx scripts/import-netbox-devices.ts --vendor Ubiquiti --list

  # Import a specific device
  npx tsx scripts/import-netbox-devices.ts --vendor Ubiquiti --slug ubiquiti-usw-pro-24

  # Import all Dell PowerEdge servers
  npx tsx scripts/import-netbox-devices.ts --vendor Dell --all

  # Import all Eaton devices AND write them into the brand pack (CI/Docker)
  npx tsx scripts/import-netbox-devices.ts --vendor Eaton --all --write

  # List all available vendors
  npx tsx scripts/import-netbox-devices.ts --list-vendors
`);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Rackula-Import-Script",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
    );
  }

  return response.json() as Promise<T>;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Rackula-Import-Script",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
    );
  }

  return response.text();
}

async function downloadImage(url: string, destPath: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Rackula-Import-Script",
      },
    });

    if (!response.ok) {
      return false;
    }

    const buffer = await response.arrayBuffer();
    await mkdir(dirname(destPath), { recursive: true });
    await writeFile(destPath, Buffer.from(buffer));
    return true;
  } catch {
    return false;
  }
}

async function listVendors(): Promise<string[]> {
  const url = `${NETBOX_API_BASE}/device-types`;
  const entries = await fetchJson<Array<{ name: string; type: string }>>(url);
  return entries.filter((e) => e.type === "dir").map((e) => e.name);
}

async function listVendorDevices(vendor: string): Promise<string[]> {
  const url = `${NETBOX_API_BASE}/device-types/${vendor}`;
  const files = await fetchJson<Array<{ name: string }>>(url);
  return files
    .filter((f) => f.name.endsWith(".yaml"))
    .map((f) => f.name.replace(".yaml", ""));
}

async function fetchDeviceYaml(
  vendor: string,
  slug: string,
): Promise<NetBoxDevice | null> {
  const url = `${NETBOX_RAW_BASE}/device-types/${vendor}/${slug}.yaml`;

  try {
    const yamlText = await fetchText(url);
    return yaml.load(yamlText) as NetBoxDevice;
  } catch {
    return null;
  }
}

function slugToVarName(slug: string): string {
  // Convert slug to camelCase variable name
  // ubiquiti-usw-pro-24 -> ubiquitiUswPro24
  return slug
    .split("-")
    .map((part, i) =>
      i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join("");
}

// Valid device categories — keep in sync with the DeviceCategory union in
// src/lib/types/index.ts. Used to validate --category and as the keyword map.
const DEVICE_CATEGORIES = [
  "server",
  "network",
  "firewall",
  "patch-panel",
  "power",
  "storage",
  "kvm",
  "av-media",
  "cooling",
  "shelf",
  "blank",
  "cable-management",
  "chassis",
  "other",
] as const;
type DeviceCategory = (typeof DEVICE_CATEGORIES)[number];

// Ordered keyword rules: first matching category wins. More specific
// categories (firewall, kvm) come before broader ones (network) so a
// "firewall" isn't swallowed by a generic "network" rule. Keywords are
// matched against manufacturer + model + slug, lowercased.
const CATEGORY_KEYWORDS: ReadonlyArray<readonly [DeviceCategory, RegExp]> = [
  ["firewall", /firewall|fortigate|\bpalo\b|pfsense|\bfw\b|sonicwall|\butm\b/],
  ["kvm", /\bkvm\b|console server|serial console|\bipmi\b|\bkmm\b/],
  [
    "network",
    /switch|router|gateway|\brouterboard\b|access point|\bap\b|wireless|firebox|\bsfp\b|\bpoe\b|patch.*switch|ethernet|network/,
  ],
  ["power", /\bups\b|\bpdu\b|\bats\b|power distribution|surge|isobar|\bebm\b|battery|inverter|rectifier|\brpp\b|\bpsu\b|power supply/],
  ["storage", /\bnas\b|\bsan\b|\bjbod\b|storage|disk shelf|disk array|diskstation|rackstation|\bnvr\b|\bdvr\b/],
  ["av-media", /hdmi|\bsdi\b|\batem\b|decklink|capture|video matrix|\bkvm matrix\b|av over ip|encoder|decoder/],
  ["cooling", /\bfan\b|cooling|thermal|\bcrac\b|\bcrah\b|air condition/],
  ["patch-panel", /patch panel|patch-panel|keystone|\bpatch\b/],
  ["cable-management", /cable manage|cable-manage|lacing|wire duct|\bduct\b|finger duct|brush panel/],
  ["shelf", /\bshelf\b|\btray\b|rack tray|\bplenum\b/],
  ["chassis", /chassis|enclosure|blade center|bladecenter|\bjbof\b/],
  ["server", /server|poweredge|proliant|\bnode\b|\bblade\b|workstation|compute/],
];

function inferCategory(device: NetBoxDevice): DeviceCategory {
  const haystack =
    `${device.manufacturer ?? ""} ${device.model} ${device.slug}`.toLowerCase();

  for (const [category, pattern] of CATEGORY_KEYWORDS) {
    if (pattern.test(haystack)) return category;
  }

  // Neutral fallback — "other" (grey) is more honest than guessing "server".
  return "other";
}

/** Category to use for a device: explicit --category override, else inferred. */
function resolveCategory(
  device: NetBoxDevice,
  override?: string,
): DeviceCategory {
  return (override as DeviceCategory) ?? inferCategory(device);
}

/** CATEGORY_COLOURS access expression, bracket form for hyphenated keys. */
function categoryColourExpr(category: string): string {
  return /^[a-z][a-z0-9]*$/.test(category)
    ? `CATEGORY_COLOURS.${category}`
    : `CATEGORY_COLOURS[${JSON.stringify(category)}]`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Force `category` (and its matching colour) on the existing device blocks for
 * the given slugs. Device object literals are flat (no nested braces), so each
 * is matched as `{ ... }` containing the target slug. Returns the updated
 * content and the number of device blocks actually changed.
 */
function applyCategoryToExisting(
  content: string,
  slugs: string[],
  category: string,
): { content: string; changed: number } {
  const colour = categoryColourExpr(category);
  let changed = 0;

  for (const slug of slugs) {
    const blockRe = new RegExp(
      `\\{[^{}]*?slug:\\s*["']${escapeRegExp(slug)}["'][^{}]*?\\}`,
    );
    content = content.replace(blockRe, (block) => {
      let updated = block.replace(
        /category:\s*["'][^"']*["']/,
        `category: "${category}"`,
      );
      updated = updated.replace(/colour:\s*[^,\n]+/, `colour: ${colour}`);
      if (updated !== block) changed++;
      return updated;
    });
  }

  return { content, changed };
}

function deviceToTypeScript(
  device: NetBoxDevice,
  categoryOverride?: string,
): string {
  const category = resolveCategory(device, categoryOverride);
  const categoryColour = categoryColourExpr(category);

  const lines = [
    "\t{",
    `\t\tslug: '${device.slug}',`,
    `\t\tu_height: ${device.u_height},`,
    `\t\tmanufacturer: '${device.manufacturer}',`,
    `\t\tmodel: '${device.model}',`,
    `\t\tis_full_depth: ${device.is_full_depth ?? true},`,
    `\t\tcolour: ${categoryColour},`,
    `\t\tcategory: '${category}'`,
  ];

  if (device.front_image) {
    lines.push(`\t\tfront_image: true,`);
  }
  if (device.rear_image) {
    lines.push(`\t\trear_image: true`);
  }
  if (device.airflow) {
    lines.push(`\t\tairflow: '${device.airflow}',`);
  }

  // Clean up trailing comma on last property
  const lastLine = lines[lines.length - 1];
  if (lastLine.endsWith(",")) {
    lines[lines.length - 1] = lastLine.slice(0, -1);
  }

  lines.push("\t}");
  return lines.join("\n");
}

// --- Self-writing helpers (used by --write) -------------------------------
//
// These generate prettier-style source (2-space indent, double quotes) so the
// edited brand pack files stay consistent with the rest of src/ and pass the
// build without a follow-up `npm run format`.

const BRAND_PACKS_DIR = join(ROOT_DIR, "src", "lib", "data", "brandPacks");

/** "Eaton" -> "eaton", "TP-Link" -> "tp-link", "Palo Alto" -> "palo-alto" */
function vendorToFileSlug(vendor: string): string {
  return vendor
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "Eaton" -> "eatonDevices", "TP-Link" -> "tplinkDevices" */
function vendorToVarName(vendor: string): string {
  return vendor.toLowerCase().replace(/[^a-z0-9]+/g, "") + "Devices";
}

/** Render a single device as a prettier-style object literal (2-space indent). */
function deviceToObjectLiteral(
  device: NetBoxDevice,
  categoryOverride?: string,
): string {
  const category = resolveCategory(device, categoryOverride);
  const colourExpr = categoryColourExpr(category);

  const lines: string[] = ["  {"];
  lines.push(`    slug: ${JSON.stringify(device.slug)},`);
  lines.push(`    u_height: ${device.u_height},`);
  lines.push(`    manufacturer: ${JSON.stringify(device.manufacturer)},`);
  lines.push(`    model: ${JSON.stringify(device.model)},`);
  if (device.is_full_depth !== undefined) {
    lines.push(`    is_full_depth: ${device.is_full_depth},`);
  }
  if (device.airflow) {
    lines.push(`    airflow: ${JSON.stringify(device.airflow)},`);
  }
  lines.push(`    colour: ${colourExpr},`);
  lines.push(`    category: ${JSON.stringify(category)},`);
  if (device.front_image) {
    lines.push(`    front_image: true,`);
  }
  if (device.rear_image) {
    lines.push(`    rear_image: true,`);
  }
  lines.push("  },");
  return lines.join("\n");
}

/** Build a brand pack file from scratch for a brand-new vendor. */
function newBrandPackContent(
  vendor: string,
  varName: string,
  devices: NetBoxDevice[],
  categoryOverride?: string,
): string {
  const body = devices
    .map((d) => deviceToObjectLiteral(d, categoryOverride))
    .join("\n");
  return (
    `/**\n` +
    ` * ${vendor} Brand Pack\n` +
    ` * Pre-defined device types for ${vendor} rack-mountable devices\n` +
    ` * Source: NetBox community devicetype-library\n` +
    ` */\n\n` +
    `import type { DeviceType } from "$lib/types";\n` +
    `import { CATEGORY_COLOURS } from "$lib/types/constants";\n\n` +
    `export const ${varName}: DeviceType[] = [\n${body}\n];\n`
  );
}

/**
 * Register a newly created brand pack in brandPacks/index.ts.
 * All-or-nothing: if any anchor is missing the file is left untouched and the
 * caller is told to wire it up manually. Returns true on success.
 */
async function registerInIndex(
  vendor: string,
  varName: string,
  fileSlug: string,
): Promise<boolean> {
  const indexPath = join(BRAND_PACKS_DIR, "index.ts");
  let content = await readFile(indexPath, "utf-8");

  if (content.includes(`from "./${fileSlug}"`)) {
    return true; // already registered
  }

  const title = vendor;
  const sectionId = fileSlug;
  // Preserve the file's existing EOL style (the repo ships CRLF files); every
  // regex below uses \r?\n so it matches regardless.
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = (...parts: string[]): string => parts.join(eol);

  // 1. import statement — after the last brand `*Devices` import
  const importRe = /import \{ \w+Devices \} from "\.\/[^"]+";/g;
  const importMatches = [...content.matchAll(importRe)];
  if (importMatches.length === 0) return false;
  const lastImport = importMatches[importMatches.length - 1];
  const importInsertAt = lastImport.index! + lastImport[0].length;
  content =
    content.slice(0, importInsertAt) +
    `${eol}import { ${varName} } from "./${fileSlug}";` +
    content.slice(importInsertAt);

  // 2. re-export — before the closing `};` of the first `export { ... };` block
  const exportBlockRe = /export \{\r?\n([\s\S]*?)\r?\n\};/;
  if (!exportBlockRe.test(content)) return false;
  content = content.replace(
    exportBlockRe,
    (_m, inner) => lines("export {", inner, `  ${varName},`, "};"),
  );

  // 3. getBrandPacks() — append a section before that function's closing `];`
  const sectionLiteral = lines(
    "    {",
    `      id: ${JSON.stringify(sectionId)},`,
    `      title: ${JSON.stringify(title)},`,
    `      devices: ${varName},`,
    `      defaultExpanded: false,`,
    "    },",
  );
  const getBrandPacksRe =
    /(export function getBrandPacks\(\): BrandSection\[\] \{[\s\S]*?return \[\r?\n)([\s\S]*?)(\r?\n  \];)/;
  if (!getBrandPacksRe.test(content)) return false;
  content = content.replace(
    getBrandPacksRe,
    (_m, head, body, tail) => `${head}${body}${eol}${sectionLiteral}${tail}`,
  );

  // 4. getBrandDevices() — add a case before `default:`
  const getBrandDevicesRe =
    /(export function getBrandDevices\(brandId: string\): DeviceType\[\] \{[\s\S]*?)(\r?\n    default:)/;
  if (!getBrandDevicesRe.test(content)) return false;
  content = content.replace(
    getBrandDevicesRe,
    (_m, head, def) =>
      head +
      lines("", `    case ${JSON.stringify(sectionId)}:`, `      return ${varName};`) +
      def,
  );

  // 5. getAllBrandDevices() — add a spread before that function's closing `];`
  const getAllRe =
    /(export function getAllBrandDevices\(\): DeviceType\[\] \{[\s\S]*?return \[\r?\n)([\s\S]*?)(\r?\n  \];)/;
  if (!getAllRe.test(content)) return false;
  content = content.replace(
    getAllRe,
    (_m, head, body, tail) => `${head}${body}${eol}    ...${varName},${tail}`,
  );

  await writeFile(indexPath, content, "utf-8");
  return true;
}

/**
 * Write the imported devices into their brand pack file.
 * - Existing file: merge new devices (by slug) into the exported array.
 * - Missing file: create it and register it in index.ts.
 * Returns the number of devices newly added.
 */
async function writeBrandPack(
  vendor: string,
  devices: NetBoxDevice[],
  dryRun: boolean,
  categoryOverride?: string,
): Promise<number> {
  const fileSlug = vendorToFileSlug(vendor);
  const varName = vendorToVarName(vendor);
  const filePath = join(BRAND_PACKS_DIR, `${fileSlug}.ts`);
  const relPath = `src/lib/data/brandPacks/${fileSlug}.ts`;

  if (existsSync(filePath)) {
    let content = await readFile(filePath, "utf-8");

    const existingSlugs = new Set(
      [...content.matchAll(/slug:\s*["']([^"']+)["']/g)].map((m) => m[1]),
    );
    const newDevices = devices.filter((d) => !existingSlugs.has(d.slug));
    // With --category, also re-categorise devices that already exist (the
    // de-dup would otherwise leave their original category untouched).
    const presentSlugs = categoryOverride
      ? devices.filter((d) => existingSlugs.has(d.slug)).map((d) => d.slug)
      : [];

    if (newDevices.length === 0 && presentSlugs.length === 0) {
      console.log(
        `\n✅ ${relPath}: all ${devices.length} device(s) already present, nothing to add`,
      );
      return 0;
    }

    if (dryRun) {
      if (newDevices.length > 0) {
        console.log(
          `\n[DRY RUN] Would add ${newDevices.length} device(s) to ${relPath}:`,
        );
        newDevices.forEach((d) => console.log(`  + ${d.slug}`));
      }
      if (presentSlugs.length > 0 && categoryOverride) {
        const { changed } = applyCategoryToExisting(
          content,
          presentSlugs,
          categoryOverride,
        );
        if (changed > 0) {
          console.log(
            `[DRY RUN] Would set category="${categoryOverride}" on ${changed} existing device(s).`,
          );
        }
      }
      return newDevices.length;
    }

    // Preserve the file's existing EOL style in the inserted lines.
    const eol = content.includes("\r\n") ? "\r\n" : "\n";

    // 1. Re-categorise already-present devices (only when --category is set).
    let recategorised = 0;
    if (presentSlugs.length > 0 && categoryOverride) {
      const result = applyCategoryToExisting(
        content,
        presentSlugs,
        categoryOverride,
      );
      content = result.content;
      recategorised = result.changed;
    }

    // 2. Append the genuinely new devices to the array.
    if (newDevices.length > 0) {
      // Tolerant of both LF and CRLF line endings (the repo ships CRLF files).
      const arrayRe =
        /(export const \w+: DeviceType\[\] = \[)([\s\S]*?)(\r?\n\];)/;
      if (!arrayRe.test(content)) {
        throw new Error(
          `Could not locate the device array in ${relPath} (expected "export const <name>: DeviceType[] = [ ... ];").`,
        );
      }
      const block = newDevices
        .map((d) => deviceToObjectLiteral(d, categoryOverride))
        .join("\n")
        .replace(/\n/g, eol);
      content = content.replace(
        arrayRe,
        (_m, open, body, close) =>
          `${open}${body.replace(/\s+$/, "")}${eol}${block}${close}`,
      );
    }

    await writeFile(filePath, content, "utf-8");
    if (newDevices.length > 0) {
      console.log(`\n✅ Added ${newDevices.length} device(s) to ${relPath}`);
      newDevices.forEach((d) => console.log(`  + ${d.slug}`));
    }
    if (recategorised > 0) {
      console.log(
        `✅ Set category="${categoryOverride}" on ${recategorised} existing device(s) in ${relPath}`,
      );
    }
    return newDevices.length;
  }

  // New vendor — create file + register it.
  if (dryRun) {
    console.log(
      `\n[DRY RUN] Would create ${relPath} with ${devices.length} device(s) and register it in index.ts`,
    );
    return devices.length;
  }

  await writeFile(
    filePath,
    newBrandPackContent(vendor, varName, devices, categoryOverride),
    "utf-8",
  );
  console.log(`\n✅ Created ${relPath} with ${devices.length} device(s)`);

  const registered = await registerInIndex(vendor, varName, fileSlug);
  if (registered) {
    console.log(`✅ Registered ${varName} in brandPacks/index.ts`);
  } else {
    console.warn(
      `\n⚠️  Could not auto-register the new pack in index.ts. Add manually:\n` +
        `   import { ${varName} } from "./${fileSlug}";\n` +
        `   …add ${varName} to the export block, getBrandPacks(), getBrandDevices() and getAllBrandDevices().`,
    );
  }
  return devices.length;
}

async function importDevice(
  vendor: string,
  slug: string,
  options: ImportOptions,
): Promise<{
  device: NetBoxDevice | null;
  frontImage: boolean;
  rearImage: boolean;
}> {
  console.log(`\nImporting: ${slug}`);

  // Fetch device YAML
  const device = await fetchDeviceYaml(vendor, slug);
  if (!device) {
    console.log(`  ⚠️  Could not fetch device YAML`);
    return { device: null, frontImage: false, rearImage: false };
  }

  console.log(`  Model: ${device.model}`);
  console.log(`  Height: ${device.u_height}U`);

  if (options.dryRun) {
    console.log(`  [DRY RUN] Would import this device`);
    return { device, frontImage: false, rearImage: false };
  }

  // Download images
  const vendorLower = vendor.toLowerCase();
  const destDir = join(ASSETS_SOURCE_DIR, vendorLower);

  // Use the device.slug from YAML (already lowercase with vendor prefix)
  // e.g., device.slug = 'hpe-proliant-dl360-gen10'
  const imageSlug = device.slug;

  let frontImage: boolean;
  let rearImage: boolean;

  // Try to download front image (try .png first, then .jpg)
  const frontDest = join(destDir, `${imageSlug}.front.png`);
  const frontDestJpg = join(destDir, `${imageSlug}.front.jpg`);
  if (!existsSync(frontDest) && !existsSync(frontDestJpg)) {
    // Try PNG first
    let frontUrl = `${NETBOX_RAW_BASE}/elevation-images/${vendor}/${imageSlug}.front.png`;
    frontImage = await downloadImage(frontUrl, frontDest);
    if (!frontImage) {
      // Try JPG
      frontUrl = `${NETBOX_RAW_BASE}/elevation-images/${vendor}/${imageSlug}.front.jpg`;
      frontImage = await downloadImage(frontUrl, frontDestJpg);
    }
    if (frontImage) {
      console.log(`  ✅ Downloaded front image`);
    }
  } else {
    frontImage = true;
    console.log(`  ⏭️  Front image already exists`);
  }

  // Try to download rear image (try .png first, then .jpg)
  const rearDest = join(destDir, `${imageSlug}.rear.png`);
  const rearDestJpg = join(destDir, `${imageSlug}.rear.jpg`);
  if (!existsSync(rearDest) && !existsSync(rearDestJpg)) {
    // Try PNG first
    let rearUrl = `${NETBOX_RAW_BASE}/elevation-images/${vendor}/${imageSlug}.rear.png`;
    rearImage = await downloadImage(rearUrl, rearDest);
    if (!rearImage) {
      // Try JPG
      rearUrl = `${NETBOX_RAW_BASE}/elevation-images/${vendor}/${imageSlug}.rear.jpg`;
      rearImage = await downloadImage(rearUrl, rearDestJpg);
    }
    if (rearImage) {
      console.log(`  ✅ Downloaded rear image`);
    }
  } else {
    rearImage = true;
    console.log(`  ⏭️  Rear image already exists`);
  }

  // Update device with image flags based on what we downloaded
  device.front_image = frontImage;
  device.rear_image = rearImage;

  return { device, frontImage, rearImage };
}

async function main(): Promise<void> {
  const options = parseArgs();

  // Handle --list-vendors before requiring --vendor
  if (options.listVendors) {
    console.log(`\n🔌 NetBox Device Import`);
    console.log(`========================`);
    console.log(`\nFetching vendor list...`);
    const vendors = await listVendors();
    console.log(`\nFound ${vendors.length} vendor(s):\n`);
    vendors.forEach((v) => console.log(`  ${v}`));
    return;
  }

  if (!options.vendor) {
    console.error("Error: --vendor is required");
    printHelp();
    process.exit(1);
  }

  if (
    options.category &&
    !DEVICE_CATEGORIES.includes(options.category as DeviceCategory)
  ) {
    console.error(
      `Error: invalid --category "${options.category}". Valid values: ${DEVICE_CATEGORIES.join(", ")}`,
    );
    process.exit(1);
  }

  console.log(`\n🔌 NetBox Device Import`);
  console.log(`========================`);
  console.log(`Vendor: ${options.vendor}`);

  if (options.list) {
    console.log(`\nFetching device list...`);
    const devices = await listVendorDevices(options.vendor);
    console.log(`\nFound ${devices.length} device(s):\n`);
    devices.forEach((d) => console.log(`  - ${d}`));
    return;
  }

  let slugsToImport: string[] = [];

  if (options.slug) {
    slugsToImport = [options.slug];
  } else if (options.all) {
    console.log(`\nFetching all devices...`);
    slugsToImport = await listVendorDevices(options.vendor);
    console.log(`Found ${slugsToImport.length} device(s)`);
  } else {
    console.error("Error: Specify --slug <slug> or --all");
    process.exit(1);
  }

  const importedDevices: NetBoxDevice[] = [];

  for (const slug of slugsToImport) {
    const result = await importDevice(options.vendor, slug, options);
    if (result.device && result.device.u_height >= 1) {
      // Only import rack-mountable devices (1U or higher)
      importedDevices.push(result.device);
    }
  }

  console.log(`\n========================`);
  console.log(`Imported ${importedDevices.length} rack-mountable device(s)`);

  // --write: persist the device definitions into the brand pack source file
  // so a CI / Docker build picks them up. process-images +
  // generate-bundled-images (run separately) handle the image manifest.
  if (options.write && !options.imagesOnly) {
    if (importedDevices.length === 0) {
      console.log(`\nNo rack-mountable devices to write.`);
    } else {
      await writeBrandPack(
        options.vendor,
        importedDevices,
        options.dryRun ?? false,
        options.category,
      );
      if (!options.dryRun) {
        console.log(`\n📋 Next steps (usually scripted in CI/Docker):`);
        console.log(`1. Run: npm run process-images`);
        console.log(`2. Run: npm run generate-bundled-images`);
        console.log(`3. Run: npm run build`);
      }
    }
    return;
  }

  if (importedDevices.length > 0 && !options.dryRun && !options.imagesOnly) {
    // Generate TypeScript for imported devices
    console.log(`\n📝 Generated TypeScript:`);
    console.log(`\nAdd these to your brand pack file:\n`);
    console.log(`import type { DeviceType } from '$lib/types';`);
    console.log(`import { CATEGORY_COLOURS } from '$lib/types/constants';\n`);
    console.log(
      `export const ${options.vendor.toLowerCase()}Devices: DeviceType[] = [`,
    );
    importedDevices.forEach((device, i) => {
      console.log(
        deviceToTypeScript(device, options.category) +
          (i < importedDevices.length - 1 ? "," : ""),
      );
    });
    console.log(`];`);

    // Generate bundledImages.ts entries
    const devicesWithImages = importedDevices.filter(
      (d) => d.front_image || d.rear_image,
    );
    if (devicesWithImages.length > 0) {
      console.log(`\n📸 Add to bundledImages.ts:\n`);
      console.log(`// Imports:`);
      const vendorLower = options.vendor.toLowerCase();
      devicesWithImages.forEach((device) => {
        const varBase = slugToVarName(device.slug);
        if (device.front_image) {
          console.log(
            `import ${varBase}Front from '$lib/assets/device-images/${vendorLower}/${device.slug}.front.webp';`,
          );
        }
        if (device.rear_image) {
          console.log(
            `import ${varBase}Rear from '$lib/assets/device-images/${vendorLower}/${device.slug}.rear.webp';`,
          );
        }
      });

      console.log(`\n// Manifest entries:`);
      devicesWithImages.forEach((device) => {
        const varBase = slugToVarName(device.slug);
        const parts = [];
        if (device.front_image) parts.push(`front: ${varBase}Front`);
        if (device.rear_image) parts.push(`rear: ${varBase}Rear`);
        console.log(`'${device.slug}': { ${parts.join(", ")} },`);
      });
    }
  }

  if (!options.dryRun) {
    console.log(`\n📋 Next steps:`);
    console.log(`1. Run: npm run process-images`);
    console.log(`2. Update src/lib/data/bundledImages.ts with new imports`);
    console.log(`3. Add devices to brand pack file if not already present`);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
