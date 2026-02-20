import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { STEALTH_CHROME_ARGS } from "./stealth.js";
import { DATA_DIR, DEFAULT_CDP_PORT } from "./types.js";

let chromeProcess: ChildProcess | null = null;
let currentCdpPort = DEFAULT_CDP_PORT;

const USER_DATA_DIR = path.join(DATA_DIR, "user-data");
const SCREENSHOTS_DIR = path.join(DATA_DIR, "screenshots");

export function getScreenshotsDir(): string {
	fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
	return SCREENSHOTS_DIR;
}

/** Find a usable Chromium executable. Prefers system Chrome, falls back to Playwright's bundled Chromium. */
function findChromium(): string {
	// Check common Linux paths
	const candidates = [
		"/usr/bin/google-chrome",
		"/usr/bin/google-chrome-stable",
		"/usr/bin/chromium-browser",
		"/usr/bin/chromium",
	];

	for (const p of candidates) {
		if (fs.existsSync(p)) return p;
	}

	// Fall back to Playwright's bundled Chromium
	return chromium.executablePath();
}

/** Check if Chrome's CDP endpoint is reachable. */
async function isChromeReady(port: number): Promise<boolean> {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
			signal: AbortSignal.timeout(1000),
		});
		return res.ok;
	} catch {
		return false;
	}
}

export function getCdpPort(): number {
	return currentCdpPort;
}

export function isRunning(): boolean {
	return chromeProcess !== null && chromeProcess.exitCode === null;
}

export function getPid(): number | null {
	return chromeProcess?.pid ?? null;
}

/** Launch Chrome with CDP enabled. */
export async function launchChrome(
	port: number = DEFAULT_CDP_PORT,
): Promise<void> {
	if (isRunning()) return;

	fs.mkdirSync(USER_DATA_DIR, { recursive: true });

	const exe = findChromium();
	const args = [
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${USER_DATA_DIR}`,
		"--headless=new",
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-sync",
		"--disable-background-networking",
		"--disable-blink-features=AutomationControlled",
		"--disable-dev-shm-usage",
		"--no-sandbox",
		"--disable-setuid-sandbox",
		"--disable-gpu",
		...STEALTH_CHROME_ARGS,
		"about:blank",
	];

	const proc = spawn(exe, args, {
		stdio: "pipe",
		env: { ...process.env, HOME: os.homedir() },
		detached: false,
	});

	proc.on("exit", (code) => {
		if (chromeProcess === proc) {
			chromeProcess = null;
			console.log(`Chrome exited with code ${code}`);
		}
	});

	proc.stderr?.on("data", (data: Buffer) => {
		const msg = data.toString().trim();
		if (msg && !msg.includes("DevTools listening")) {
			console.error(`[chrome] ${msg}`);
		}
	});

	chromeProcess = proc;
	currentCdpPort = port;

	// Wait for CDP to become reachable (max 15s)
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		if (await isChromeReady(port)) return;
		await new Promise((r) => setTimeout(r, 200));
	}

	// If we get here, Chrome didn't start properly
	stopChrome();
	throw new Error(
		`Chrome failed to start within 15s (exe: ${exe}, port: ${port})`,
	);
}

/** Stop the Chrome process. */
export function stopChrome(): void {
	if (!chromeProcess) return;

	const proc = chromeProcess;
	chromeProcess = null;

	try {
		proc.kill("SIGTERM");
	} catch {
		// already dead
	}

	// Force kill after 3s if still alive
	setTimeout(() => {
		try {
			proc.kill("SIGKILL");
		} catch {
			// already dead
		}
	}, 3000);
}
