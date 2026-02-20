#!/usr/bin/env tsx

/**
 * git-sync CLI — thin wrapper around skills/git-sync/scripts/check-repos.sh
 * so that the build step auto-discovers it as a tool.
 *
 * Usage: git-sync-cli.ts [dir1 dir2 ...] [--ignore=name1,name2] [--no-fetch]
 */

import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const engineDir = resolve(import.meta.dirname!, "..");
const script = join(engineDir, "skills", "git-sync", "scripts", "check-repos.sh");

try {
	execFileSync("bash", [script, ...process.argv.slice(2)], {
		stdio: "inherit",
	});
} catch (err: unknown) {
	// check-repos.sh exits 1 when repos need attention — that's not an error
	const code = (err as { status?: number }).status;
	if (code !== undefined) process.exit(code);
	throw err;
}
