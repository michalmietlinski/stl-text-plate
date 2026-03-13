import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "../core/textPlate.js";

// Single canonical font: download once, cache, always use the same file
const FONT_URL = "https://cdn.jsdelivr.net/npm/opensans-font@1.0.0/OpenSans-Bold.ttf";
const FONT_CACHE_NAME = "OpenSans-Bold.ttf";

function getCacheDir() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(dir, "..", "cache");
}

function getFontCachePath() {
  return path.join(getCacheDir(), FONT_CACHE_NAME);
}

async function ensureFontCached() {
  const cachePath = getFontCachePath();
  try {
    await fs.access(cachePath);
    return cachePath;
  } catch {
    const res = await fetch(FONT_URL);
    if (!res || !res.ok) throw new Error(`Font download failed: ${res?.status ?? "network error"}`);
    const buf = await res.arrayBuffer();
    await fs.mkdir(getCacheDir(), { recursive: true });
    await fs.writeFile(cachePath, new Uint8Array(buf));
    return cachePath;
  }
}

function printHelp() {
  console.log(`
Text Rectangle Generator (Node CLI)

Generates an STL with a rectangular plate and raised text (Arial Bold style when font is provided).

Usage:
  node src/cli/index.js --input examples/example.json --output output/plate.stl [--name my_plate]

Required:
  --input <file>     Input JSON with parameters (rectangle dimensions, text, thickness, letter height)

Optional (plant stake - stick in soil):
  addStake: true     In JSON: add optional stake under plate (stakeWidth, stakeHeight)

Optional:
  --output <path>    Output STL path (default: output/plate.stl)
  --name <text>      STL solid name
  --debug            Log contour/glyph counts to stderr
  --help             Show help
`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (key === "help") {
      args.help = true;
      continue;
    }
    if (key === "debug") {
      args.debug = true;
      continue;
    }
    const value = argv[i + 1];
    if (value == null || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!args.input) {
    throw new Error("Missing required --input <file>.");
  }

  const outputPath = args.output || path.join("output", "plate.stl");
  const inputAbsolute = path.resolve(args.input);
  const inputRaw = await fs.readFile(inputAbsolute, "utf8");
  let params;
  try {
    params = JSON.parse(inputRaw);
  } catch {
    throw new Error(`Invalid JSON in ${args.input}`);
  }

  // Font: use cache so we always use the same font. If fontUrl is set, ensure cache exists and use it.
  if (params.fontUrl) {
    try {
      params.fontPath = await ensureFontCached();
    } catch (e) {
      console.error(`Could not download/cache font: ${e.message}. Run from project root or check network.`);
      delete params.fontPath;
    }
  } else if (params.fontPath && !path.isAbsolute(params.fontPath)) {
    params.fontPath = path.resolve(path.dirname(inputAbsolute), params.fontPath);
  }

  const { stl, meta } = await generate(params, { name: args.name, debug: args.debug });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, stl, "utf8");

  console.log("Output generated successfully.");
  console.log(`Path: ${outputPath}`);
  console.log("Meta:", meta);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
