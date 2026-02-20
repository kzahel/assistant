#!/usr/bin/env tsx

import { DEFAULT_SERVER_PORT } from "./browser/types.js";

const BASE_URL =
	process.env.BROWSER_URL ??
	`http://127.0.0.1:${process.env.BROWSER_PORT ?? DEFAULT_SERVER_PORT}`;

/** Safe indexed access — the while loop guarantees the index is valid. */
function arg(args: string[], i: number): string {
	return args[i] as string;
}

// --- HTTP helpers ---

async function get(path: string): Promise<unknown> {
	const res = await fetch(`${BASE_URL}${path}`, {
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`HTTP ${res.status}: ${text}`);
	}
	return res.json();
}

async function post(
	path: string,
	body?: Record<string, unknown>,
): Promise<unknown> {
	const res = await fetch(`${BASE_URL}${path}`, {
		method: "POST",
		headers: body ? { "Content-Type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`HTTP ${res.status}: ${text}`);
	}
	return res.json();
}

// --- Command handlers ---

type Handler = (args: string[]) => Promise<void>;

const commands: Record<string, Handler> = {
	async status() {
		const data = await get("/status");
		console.log(JSON.stringify(data, null, 2));
	},

	async start() {
		const data = await post("/start");
		console.log(JSON.stringify(data, null, 2));
	},

	async stop() {
		const data = await post("/stop");
		console.log(JSON.stringify(data, null, 2));
	},

	async tabs() {
		const data = (await get("/tabs")) as {
			tabs: Array<{ targetId: string; title: string; url: string }>;
		};
		if (data.tabs.length === 0) {
			console.log("No open tabs.");
			return;
		}
		for (const tab of data.tabs) {
			console.log(`${tab.targetId}  ${tab.title}`);
			console.log(`  ${tab.url}`);
		}
	},

	async open(args) {
		const url = args[0];
		if (!url) {
			console.error("Usage: browser open <url>");
			process.exit(1);
		}
		const data = await post("/tabs/open", { url });
		console.log(JSON.stringify(data, null, 2));
	},

	async close(args) {
		const targetId = args[0] || undefined;
		const data = await post("/tabs/close", { targetId });
		console.log(JSON.stringify(data, null, 2));
	},

	async snapshot(args) {
		const params = new URLSearchParams();
		for (let i = 0; i < args.length; i++) {
			const a = arg(args, i);
			if (a === "--efficient") {
				params.set("efficient", "true");
			} else if (a === "--selector" && args[i + 1]) {
				params.set("selector", arg(args, ++i));
			} else if (a === "--max-chars" && args[i + 1]) {
				params.set("maxChars", arg(args, ++i));
			} else if (a === "--tab" && args[i + 1]) {
				params.set("targetId", arg(args, ++i));
			}
		}
		const qs = params.toString();
		const data = (await get(`/snapshot${qs ? `?${qs}` : ""}`)) as {
			snapshot: string;
			url: string;
			targetId: string;
			truncated: boolean;
		};
		// Print just the snapshot text — this is what the AI reads
		console.log(`[url: ${data.url}]`);
		if (data.truncated) console.log("[truncated]");
		console.log(data.snapshot);
	},

	async screenshot(args) {
		const body: Record<string, unknown> = {};
		for (let i = 0; i < args.length; i++) {
			const a = arg(args, i);
			if (a === "--full") body.fullPage = true;
			else if (a === "--element" && args[i + 1]) body.ref = arg(args, ++i);
			else if (a === "--tab" && args[i + 1]) body.targetId = arg(args, ++i);
		}
		const data = (await post("/screenshot", body)) as { path: string };
		console.log(data.path);
	},

	async navigate(args) {
		const url = args[0];
		if (!url) {
			console.error("Usage: browser navigate <url>");
			process.exit(1);
		}
		const targetId = args[1] === "--tab" && args[2] ? args[2] : undefined;
		const data = await post("/navigate", { url, targetId });
		console.log(JSON.stringify(data, null, 2));
	},

	async click(args) {
		const ref = args[0];
		if (!ref) {
			console.error("Usage: browser click <ref>");
			process.exit(1);
		}
		const data = await post("/act", { kind: "click", ref });
		console.log(JSON.stringify(data, null, 2));
	},

	async type(args) {
		const ref = args[0];
		const text = args.slice(1).join(" ");
		if (!ref || !text) {
			console.error("Usage: browser type <ref> <text>");
			process.exit(1);
		}
		const data = await post("/act", { kind: "type", ref, text });
		console.log(JSON.stringify(data, null, 2));
	},

	async press(args) {
		const key = args[0];
		if (!key) {
			console.error("Usage: browser press <key>");
			process.exit(1);
		}
		const data = await post("/act", { kind: "press", key });
		console.log(JSON.stringify(data, null, 2));
	},

	async hover(args) {
		const ref = args[0];
		if (!ref) {
			console.error("Usage: browser hover <ref>");
			process.exit(1);
		}
		const data = await post("/act", { kind: "hover", ref });
		console.log(JSON.stringify(data, null, 2));
	},

	async fill(args) {
		// Parse ref=value pairs
		const fields = args.map((arg) => {
			const eq = arg.indexOf("=");
			if (eq === -1) {
				console.error(`Invalid field format: ${arg} (expected ref=value)`);
				process.exit(1);
			}
			return { ref: arg.slice(0, eq), value: arg.slice(eq + 1) };
		});
		if (fields.length === 0) {
			console.error("Usage: browser fill <ref>=<value> [<ref>=<value>...]");
			process.exit(1);
		}
		const data = await post("/act", { kind: "fill", fields });
		console.log(JSON.stringify(data, null, 2));
	},

	async select(args) {
		const ref = args[0];
		const values = args.slice(1);
		if (!ref || values.length === 0) {
			console.error("Usage: browser select <ref> <value> [<value>...]");
			process.exit(1);
		}
		const data = await post("/act", { kind: "select", ref, values });
		console.log(JSON.stringify(data, null, 2));
	},

	async evaluate(args) {
		const fn = args.join(" ");
		if (!fn) {
			console.error("Usage: browser evaluate <js expression>");
			process.exit(1);
		}
		const data = (await post("/act", { kind: "evaluate", fn })) as {
			result?: unknown;
		};
		if (data.result !== undefined) {
			console.log(
				typeof data.result === "string"
					? data.result
					: JSON.stringify(data.result, null, 2),
			);
		} else {
			console.log("(no result)");
		}
	},

	async console(args) {
		const params = new URLSearchParams();
		for (let i = 0; i < args.length; i++) {
			const a = arg(args, i);
			if (a === "--level" && args[i + 1]) {
				params.set("level", arg(args, ++i));
			} else if (a === "--tab" && args[i + 1]) {
				params.set("targetId", arg(args, ++i));
			}
		}
		const qs = params.toString();
		const data = (await get(`/console${qs ? `?${qs}` : ""}`)) as {
			messages: Array<{ level: string; text: string; timestamp: number }>;
		};
		for (const msg of data.messages) {
			const time = new Date(msg.timestamp).toISOString().slice(11, 19);
			console.log(`[${time}] ${msg.level}: ${msg.text}`);
		}
		if (data.messages.length === 0) {
			console.log("No console messages.");
		}
	},

	async pdf() {
		const data = (await post("/pdf")) as { path: string };
		console.log(data.path);
	},
};

// --- Main ---

async function main() {
	const [command, ...args] = process.argv.slice(2);

	if (!command || command === "help") {
		console.log(`Usage: browser <command> [args...]

Commands:
  status                          Check if browser is running
  start                           Start the browser
  stop                            Stop the browser
  tabs                            List open tabs
  open <url>                      Open URL in new tab
  close [targetId]                Close a tab
  snapshot [options]              Get page accessibility snapshot
    --efficient                   Shorter snapshot (~12k chars)
    --selector <css>              Scope to element
    --max-chars <n>               Max characters
    --tab <targetId>              Target specific tab
  screenshot [options]            Take a screenshot
    --full                        Full page scroll capture
    --element <ref>               Screenshot specific element
    --tab <targetId>              Target specific tab
  navigate <url> [--tab <id>]     Navigate current tab to URL
  click <ref>                     Click element by ref
  type <ref> <text>               Type text into element
  press <key>                     Press keyboard key (Enter, Tab, etc.)
  hover <ref>                     Hover over element
  fill <ref>=<val> [...]          Fill form fields
  select <ref> <val> [...]        Select dropdown values
  evaluate <js>                   Run JavaScript in page
  console [--level <level>]       View console messages
  pdf                             Save page as PDF`);
		process.exit(0);
	}

	const handler = commands[command];
	if (!handler) {
		console.error(`Unknown command: ${command}`);
		console.error("Run 'browser help' for usage.");
		process.exit(1);
	}

	try {
		await handler(args);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
			console.error(
				"Cannot connect to browser server. Start it with: tsx lib/browser/server.ts &",
			);
		} else {
			console.error(`Error: ${msg}`);
		}
		process.exit(1);
	}
}

main();
