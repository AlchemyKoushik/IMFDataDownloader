import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const allDirs = [".next", ".next-dev"];
const requestedDir = process.env.NEXT_DIST_DIR || ".next";
const shouldCleanAll = process.argv.includes("--all");
const targetDirs = shouldCleanAll ? allDirs : [requestedDir];

for (const dir of targetDirs) {
  const fullPath = join(process.cwd(), dir);

  if (existsSync(fullPath)) {
    rmSync(fullPath, { recursive: true, force: true });
    console.log(`Removed stale ${dir} directory.`);
  } else {
    console.log(`No ${dir} directory found.`);
  }
}
