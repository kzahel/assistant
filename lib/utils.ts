import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Parse a simple KEY=VALUE .env file. Skips comments and blanks. */
export function loadEnv(dir: string): Record<string, string> {
	const envPath = join(dir, ".env");
	try {
		const raw = readFileSync(envPath, "utf-8");
		const vars: Record<string, string> = {};
		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eq = trimmed.indexOf("=");
			if (eq === -1) continue;
			vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
		}
		return vars;
	} catch {
		return {};
	}
}

/** Resolve the assistant instance directory from env or default. */
export function resolveInstanceDir(): string {
	return (
		process.env.ASSISTANT_INSTANCE_DIR ??
		resolve(process.env.HOME!, "assistant-data/assistants/my-assistant")
	);
}

/** Ensure a directory exists (mkdir -p). */
export function ensureDir(path: string): void {
	if (!existsSync(path)) mkdirSync(path, { recursive: true });
}
