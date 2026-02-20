import { Hono } from "hono";
import {
	getCdpPort,
	getPid,
	isRunning,
	launchChrome,
	stopChrome,
} from "./chrome.js";
import {
	act,
	closeTab,
	connect,
	disconnect,
	getConsoleMessages,
	listTabs,
	navigate,
	openTab,
	pdf,
	screenshot,
	setupConsoleCapture,
	snapshot,
} from "./playwright.js";
import { ActRequestSchema } from "./types.js";

export const app = new Hono();

// Global error handler — return JSON errors instead of crashing
app.onError((err, c) => {
	const message = err instanceof Error ? err.message : String(err);
	console.error(`[error] ${c.req.method} ${c.req.path}: ${message}`);
	return c.json({ error: message }, 500);
});

/** Ensure Chrome is running and Playwright is connected. */
async function ensureBrowser() {
	if (!isRunning()) {
		await launchChrome();
	}
	const browser = await connect(getCdpPort());
	return browser;
}

// --- Status ---

app.get("/status", (c) => {
	return c.json({
		running: isRunning(),
		pid: getPid(),
		cdpPort: getCdpPort(),
	});
});

// --- Lifecycle ---

app.post("/start", async (c) => {
	await launchChrome();
	const browser = await connect(getCdpPort());
	setupConsoleCapture(browser);
	return c.json({
		running: isRunning(),
		pid: getPid(),
		cdpPort: getCdpPort(),
	});
});

app.post("/stop", (c) => {
	disconnect();
	stopChrome();
	return c.json({ ok: true });
});

// --- Tabs ---

app.get("/tabs", async (c) => {
	const browser = await ensureBrowser();
	const tabs = await listTabs(browser);
	return c.json({ tabs });
});

app.post("/tabs/open", async (c) => {
	const body = await c.req.json();
	const url = body.url;
	if (typeof url !== "string") {
		return c.json({ error: "url required" }, 400);
	}
	const browser = await ensureBrowser();
	const tab = await openTab(browser, url);
	return c.json(tab);
});

app.post("/tabs/close", async (c) => {
	const body = await c.req.json();
	const browser = await ensureBrowser();
	await closeTab(browser, body.targetId);
	return c.json({ ok: true });
});

// --- Snapshot ---

app.get("/snapshot", async (c) => {
	const browser = await ensureBrowser();
	const opts = {
		targetId: c.req.query("targetId") || undefined,
		maxChars: c.req.query("maxChars")
			? Number(c.req.query("maxChars"))
			: undefined,
		efficient: c.req.query("efficient") === "true",
		selector: c.req.query("selector") || undefined,
	};
	const result = await snapshot(browser, opts);
	return c.json(result);
});

// --- Screenshot ---

app.post("/screenshot", async (c) => {
	const body = await c.req.json().catch(() => ({}));
	const browser = await ensureBrowser();
	const result = await screenshot(browser, {
		targetId: body.targetId,
		fullPage: body.fullPage,
		ref: body.ref,
	});
	return c.json(result);
});

// --- Navigate ---

app.post("/navigate", async (c) => {
	const body = await c.req.json();
	if (typeof body.url !== "string") {
		return c.json({ error: "url required" }, 400);
	}
	const browser = await ensureBrowser();
	const result = await navigate(browser, body.url, body.targetId);
	return c.json(result);
});

// --- Act ---

app.post("/act", async (c) => {
	const body = await c.req.json();
	const parsed = ActRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid act request", details: parsed.error.format() },
			400,
		);
	}
	const browser = await ensureBrowser();
	const result = await act(browser, parsed.data, body.targetId);
	return c.json(result);
});

// --- Console ---

app.get("/console", async (c) => {
	const browser = await ensureBrowser();
	const result = await getConsoleMessages(browser, {
		targetId: c.req.query("targetId") || undefined,
		level: c.req.query("level") || undefined,
	});
	return c.json(result);
});

// --- PDF ---

app.post("/pdf", async (c) => {
	const body = await c.req.json().catch(() => ({}));
	const browser = await ensureBrowser();
	const result = await pdf(browser, body.targetId);
	return c.json(result);
});
