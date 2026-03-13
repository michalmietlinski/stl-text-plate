#!/usr/bin/env node
/**
 * Download the canonical font once into cache/ so the CLI always uses the same font.
 * Run once: npm run download-font (or the CLI will download on first run when fontUrl is set).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FONT_URL = "https://cdn.jsdelivr.net/npm/opensans-font@1.0.0/OpenSans-Bold.ttf";
const CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "OpenSans-Bold.ttf");

async function main() {
  try {
    const res = await fetch(FONT_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(CACHE_FILE, new Uint8Array(buf));
    console.log(`Cached font at ${CACHE_FILE}`);
  } catch (e) {
    console.error("Download failed:", e.message);
    process.exitCode = 1;
  }
}
main();
