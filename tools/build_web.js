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
  console.log("Web assets copied to docs/. Deploy docs/ for GitHub Pages.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
