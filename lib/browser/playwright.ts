import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
import { getScreenshotsDir } from "./chrome.js";
import { applyStealthToPage } from "./stealth.js";
import {
	type ActRequest,
	DEFAULT_ACTION_TIMEOUT_MS,
	DEFAULT_SNAPSHOT_EFFICIENT_MAX_CHARS,
	DEFAULT_SNAPSHOT_MAX_CHARS,
	type SnapshotOptions,
	type Tab,
} from "./types.js";

// --- Connection ---

let cachedBrowser: Browser | null = null;

/** Connect Playwright to Chrome via CDP. Reuses existing connection. */
export async function connect(cdpPort: number): Promise<Browser> {
	if (cachedBrowser?.isConnected()) return cachedBrowser;

	const endpoint = `http://127.0.0.1:${cdpPort}`;
	const browser = await chromium.connectOverCDP(endpoint, { timeout: 10_000 });
	browser.on("disconnected", () => {
		if (cachedBrowser === browser) cachedBrowser = null;
	});
	cachedBrowser = browser;
	return browser;
}

export function disconnect(): void {
	if (cachedBrowser?.isConnected()) {
		cachedBrowser.close().catch(() => {});
	}
	cachedBrowser = null;
}

// --- Page resolution ---

function defaultContext(browser: Browser) {
	return browser.contexts()[0] ?? null;
}

/** Get a page by targetId, or the most recently opened page. */
async function getPage(
	browser: Browser,
	targetId?: string,
): Promise<{ page: Page; targetId: string }> {
	const ctx = defaultContext(browser);
	if (!ctx) throw new Error("No browser context available");

	const pages = ctx.pages();
	if (pages.length === 0) {
		// Create a new page if none exist
		const page = await ctx.newPage();
		await applyStealthToPage(page);
		const id = await getTargetId(page);
		return { page, targetId: id };
	}

	if (targetId) {
		for (const page of pages) {
			const id = await getTargetId(page);
			if (id === targetId) return { page, targetId: id };
		}
		throw new Error(`Tab not found: ${targetId}`);
	}

	const page = pages.at(-1);
	if (!page) throw new Error("No pages available");
	return { page, targetId: await getTargetId(page) };
}

/** Extract the CDP target ID for a page. */
async function getTargetId(page: Page): Promise<string> {
	// Use CDP session to get target info
	try {
		const session = await page.context().newCDPSession(page);
		const info = await session.send("Target.getTargetInfo");
		await session.detach();
		return info.targetInfo.targetId;
	} catch {
		// Fallback: use the page URL as a pseudo-ID
		return page.url();
	}
}

// --- Tabs ---

export async function listTabs(browser: Browser): Promise<Tab[]> {
	const ctx = defaultContext(browser);
	if (!ctx) return [];

	const tabs: Tab[] = [];
	for (const page of ctx.pages()) {
		tabs.push({
			targetId: await getTargetId(page),
			title: await page.title(),
			url: page.url(),
		});
	}
	return tabs;
}

export async function openTab(browser: Browser, url: string): Promise<Tab> {
	const ctx = defaultContext(browser);
	if (!ctx) throw new Error("No browser context available");

	const page = await ctx.newPage();
	await applyStealthToPage(page);
	await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

	return {
		targetId: await getTargetId(page),
		title: await page.title(),
		url: page.url(),
	};
}

export async function closeTab(
	browser: Browser,
	targetId?: string,
): Promise<void> {
	const { page } = await getPage(browser, targetId);
	await page.close();
}

// --- Snapshot ---

// Playwright's private _snapshotForAI method
interface PageWithSnapshot extends Page {
	_snapshotForAI?(opts: {
		timeout?: number;
	}): Promise<{ full: string; incremental?: string }>;
}

export async function snapshot(
	browser: Browser,
	opts: SnapshotOptions = {},
): Promise<{
	snapshot: string;
	targetId: string;
	url: string;
	truncated: boolean;
}> {
	const { page, targetId } = await getPage(browser, opts.targetId);
	const pageWithSnap = page as PageWithSnapshot;

	if (!pageWithSnap._snapshotForAI) {
		throw new Error(
			"Playwright _snapshotForAI not available. Make sure you're using full 'playwright' (not 'playwright-core').",
		);
	}

	const result = await pageWithSnap._snapshotForAI({ timeout: 5000 });
	let text = result.full ?? "";

	const maxChars =
		opts.maxChars ??
		(opts.efficient
			? DEFAULT_SNAPSHOT_EFFICIENT_MAX_CHARS
			: DEFAULT_SNAPSHOT_MAX_CHARS);

	let truncated = false;
	if (text.length > maxChars) {
		text = `${text.slice(0, maxChars)}\n\n[...TRUNCATED - page too large, use --selector to scope]`;
		truncated = true;
	}

	return { snapshot: text, targetId, url: page.url(), truncated };
}

// --- Screenshot ---

export async function screenshot(
	browser: Browser,
	opts: { targetId?: string; fullPage?: boolean; ref?: string } = {},
): Promise<{ path: string; targetId: string }> {
	const { page, targetId } = await getPage(browser, opts.targetId);
	const dir = getScreenshotsDir();
	const filename = `screenshot-${Date.now()}.png`;
	const filePath = path.join(dir, filename);

	if (opts.ref) {
		const locator = refLocator(page, opts.ref);
		await locator.screenshot({
			path: filePath,
			timeout: DEFAULT_ACTION_TIMEOUT_MS,
		});
	} else {
		await page.screenshot({
			path: filePath,
			fullPage: opts.fullPage ?? false,
		});
	}

	return { path: filePath, targetId };
}

// --- Navigate ---

export async function navigate(
	browser: Browser,
	url: string,
	targetId?: string,
): Promise<{ url: string; targetId: string }> {
	const resolved = await getPage(browser, targetId);
	await resolved.page.goto(url, {
		waitUntil: "domcontentloaded",
		timeout: 30_000,
	});
	return { url: resolved.page.url(), targetId: resolved.targetId };
}

// --- Console ---

const consoleMessages: Map<
	string,
	Array<{ level: string; text: string; timestamp: number }>
> = new Map();

export function setupConsoleCapture(browser: Browser): void {
	const ctx = defaultContext(browser);
	if (!ctx) return;

	for (const page of ctx.pages()) {
		captureConsolePage(page);
	}
	ctx.on("page", (page) => captureConsolePage(page));
}

function captureConsolePage(page: Page): void {
	page.on("console", (msg) => {
		getTargetId(page)
			.then((id) => {
				const messages = consoleMessages.get(id) ?? [];
				messages.push({
					level: msg.type(),
					text: msg.text(),
					timestamp: Date.now(),
				});
				// Keep last 200 messages per tab
				if (messages.length > 200) messages.splice(0, messages.length - 200);
				consoleMessages.set(id, messages);
			})
			.catch(() => {});
	});
}

export async function getConsoleMessages(
	browser: Browser,
	opts: { targetId?: string; level?: string } = {},
): Promise<{
	messages: Array<{ level: string; text: string; timestamp: number }>;
	targetId: string;
}> {
	const { targetId } = await getPage(browser, opts.targetId);
	let messages = consoleMessages.get(targetId) ?? [];
	if (opts.level) {
		messages = messages.filter((m) => m.level === opts.level);
	}
	return { messages, targetId };
}

// --- PDF ---

export async function pdf(
	browser: Browser,
	targetId?: string,
): Promise<{ path: string; targetId: string }> {
	const resolved = await getPage(browser, targetId);
	const dir = getScreenshotsDir();
	const filename = `page-${Date.now()}.pdf`;
	const filePath = path.join(dir, filename);
	await resolved.page.pdf({ path: filePath });
	return { path: filePath, targetId: resolved.targetId };
}

// --- Ref resolution ---

/** Convert an element ref like "e5" into a Playwright locator. */
function refLocator(page: Page, ref: string) {
	// Normalize: strip leading @ or ref= prefix
	const normalized = ref.startsWith("@")
		? ref.slice(1)
		: ref.startsWith("ref=")
			? ref.slice(4)
			: ref;

	// Playwright's internal aria-ref selector engine (injected by _snapshotForAI)
	return page.locator(`aria-ref=${normalized}`);
}

// --- Act ---

export async function act(
	browser: Browser,
	request: ActRequest,
	targetId?: string,
): Promise<{ ok: true; targetId: string; url: string; result?: unknown }> {
	const resolved = await getPage(browser, targetId);
	const { page } = resolved;
	const timeout = DEFAULT_ACTION_TIMEOUT_MS;

	switch (request.kind) {
		case "click": {
			const locator = refLocator(page, request.ref);
			if (request.doubleClick) {
				await locator.dblclick({
					timeout,
					button: request.button,
					modifiers: request.modifiers,
				});
			} else {
				await locator.click({
					timeout,
					button: request.button,
					modifiers: request.modifiers,
				});
			}
			break;
		}

		case "type": {
			const locator = refLocator(page, request.ref);
			if (request.slowly) {
				await locator.pressSequentially(request.text, {
					timeout,
					delay: 50,
				});
			} else {
				await locator.fill(request.text, { timeout });
			}
			if (request.submit) {
				await page.keyboard.press("Enter");
			}
			break;
		}

		case "press": {
			await page.keyboard.press(request.key);
			break;
		}

		case "hover": {
			const locator = refLocator(page, request.ref);
			await locator.hover({ timeout });
			break;
		}

		case "drag": {
			const start = refLocator(page, request.startRef);
			const end = refLocator(page, request.endRef);
			await start.dragTo(end, { timeout });
			break;
		}

		case "select": {
			const locator = refLocator(page, request.ref);
			await locator.selectOption(request.values, { timeout });
			break;
		}

		case "fill": {
			for (const field of request.fields) {
				const locator = refLocator(page, field.ref);
				await locator.fill(field.value, { timeout });
			}
			break;
		}

		case "evaluate": {
			const result = await page.evaluate(request.fn);
			return {
				ok: true,
				targetId: resolved.targetId,
				url: page.url(),
				result,
			};
		}

		case "wait": {
			if (request.timeMs) {
				await page.waitForTimeout(request.timeMs);
			}
			if (request.text) {
				await page
					.locator(`text=${request.text}`)
					.first()
					.waitFor({ state: "visible", timeout });
			}
			if (request.textGone) {
				await page
					.locator(`text=${request.textGone}`)
					.first()
					.waitFor({ state: "hidden", timeout });
			}
			if (request.selector) {
				await page
					.locator(request.selector)
					.first()
					.waitFor({ state: "visible", timeout });
			}
			break;
		}

		case "close": {
			await page.close();
			break;
		}

		case "resize": {
			await page.setViewportSize({
				width: request.width,
				height: request.height,
			});
			break;
		}
	}

	return { ok: true, targetId: resolved.targetId, url: page.url() };
}
