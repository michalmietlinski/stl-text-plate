import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

async function copyFileRelative(from, toDir) {
  const src = path.join(projectRoot, from);
  const destDir = path.join(projectRoot, toDir);
  const dest = path.join(destDir, path.basename(from));
  await fs.mkdir(destDir, { recursive: true });
  await fs.copyFile(src, dest);
}

async function main() {
  await copyFileRelative("web/index.html", "docs");
  await copyFileRelative("web/main.js", "docs");
  const fontSrc = path.join(projectRoot, "web", "fonts", "OpenSans-Bold.ttf");
  const fontDestDir = path.join(projectRoot, "docs", "fonts");
  const fontDest = path.join(fontDestDir, "OpenSans-Bold.ttf");
  try {
    await fs.mkdir(fontDestDir, { recursive: true });
    await fs.copyFile(fontSrc, fontDest);
    console.log("Font copied to docs/fonts/");
  } catch (e) {
    console.warn("Font not found at web/fonts/OpenSans-Bold.ttf. Run: npm run download-font");
    const cacheFont = path.join(projectRoot, "cache", "OpenSans-Bold.ttf");
    try {
      await fs.copyFile(cacheFont, fontDest);
      console.log("Font copied from cache to docs/fonts/");
    } catch (e2) {
      console.error("Run npm run download-font first, then npm run build-web.");
      process.exitCode = 1;
      return;
    }
  }
  console.log("Web assets copied to docs/. Deploy docs/ for GitHub Pages.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
