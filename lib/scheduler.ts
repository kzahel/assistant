#!/usr/bin/env tsx

/**
 * Smart cron scheduler for assistant instances.
 *
 * Reads schedules from config.yaml, fires Claude Code sessions via the
 * Yep Anywhere server API at the right times, and tracks run state.
 * Also polls Telegram for incoming messages and spawns sessions for them.
 *
 * Usage:
 *   scheduler --instance ~/assistant-data/assistants/my-assistant
 *   scheduler --instance ~/assistant-data/assistants/my-assistant --run-now morning-digest
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import cronParser from "cron-parser";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// --- Types ---

interface ScheduleState {
	lastRunAt?: string;
	lastStatus?: "ok" | "error" | "skipped";
	lastSummary?: string;
	consecutiveErrors: number;
	maxConsecutiveErrors: number;
}

interface SkillRef {
	skill: string;
	args?: Record<string, unknown>;
}

interface Schedule {
	name: string;
	cron: string;
	skills: SkillRef[];
	output?: string;
	prompt?: string;
	enabled?: boolean;
	_state?: ScheduleState;
}

interface Config {
	name: string;
	skills?: Record<string, Record<string, unknown>>;
	schedules?: Schedule[];
}

interface ActiveSession {
	scheduleName: string;
	sessionId: string;
	processId: string;
	startedAt: number;
}

// --- CLI args ---

const { values: args } = parseArgs({
	options: {
		instance: { type: "string" },
		port: { type: "string", default: "3400" },
		"run-now": { type: "string" },
	},
	strict: false,
});

const instanceDir = resolve(
	typeof args.instance === "string" ? args.instance : "",
);
if (!instanceDir || !existsSync(join(instanceDir, "config.yaml"))) {
	console.error(
		"Usage: scheduler --instance <dir> [--port 3400] [--run-now <name>]",
	);
	console.error("  <dir> must contain a config.yaml");
	process.exit(1);
}

const YA_PORT = Number(args.port) || 3400;
const YA_BASE = `http://127.0.0.1:${YA_PORT}`;

// --- Helpers ---

function log(msg: string) {
	console.log(`[${new Date().toISOString()}] ${msg}`);
}

function toProjectId(path: string): string {
	return Buffer.from(path).toString("base64url");
}

function loadConfig(): Config {
	const raw = readFileSync(join(instanceDir, "config.yaml"), "utf-8");
	return parseYaml(raw) as Config;
}

function saveConfig(config: Config) {
	writeFileSync(join(instanceDir, "config.yaml"), stringifyYaml(config));
}

function appendActivity(entry: Record<string, unknown>) {
	const logDir = join(instanceDir, "memory");
	if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
	appendFileSync(
		join(logDir, "activity-log.jsonl"),
		`${JSON.stringify(entry)}\n`,
	);
}

function buildSessionMessage(schedule: Schedule, config: Config): string {
	const skillLines = schedule.skills
		.map((s) => {
			let line = `- ${s.skill}`;
			if (s.args) line += ` (args: ${JSON.stringify(s.args)})`;
			return line;
		})
		.join("\n");

	const outputLine = schedule.output
		? `\nDeliver the combined output via the ${schedule.output} skill.`
		: "";

	const instructions = schedule.prompt ?? "When done, summarize what you did.";

	return [
		`ASSISTANT_TRIGGER=cron:${schedule.name}`,
		"",
		`Run the "${schedule.name}" schedule. Execute these skills in order:`,
		skillLines,
		outputLine,
		"",
		instructions,
		"",
		"Execute autonomously. Do not ask questions. Do not produce unnecessary output.",
	].join("\n");
}

// --- Session management ---

const activeSessions = new Map<string, ActiveSession>();
const projectId = toProjectId(instanceDir);

async function fireSchedule(
	schedule: Schedule,
	config: Config,
): Promise<boolean> {
	const message = buildSessionMessage(schedule, config);

	log(`Firing schedule: ${schedule.name}`);

	try {
		const res = await fetch(`${YA_BASE}/api/projects/${projectId}/sessions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Yep-Anywhere": "true",
			},
			body: JSON.stringify({
				message,
				mode: "bypassPermissions",
			}),
		});

		if (res.status === 200) {
			const data = (await res.json()) as {
				sessionId: string;
				processId: string;
			};
			log(`  Session started: ${data.sessionId}`);
			activeSessions.set(schedule.name, {
				scheduleName: schedule.name,
				sessionId: data.sessionId,
				processId: data.processId,
				startedAt: Date.now(),
			});
			return true;
		}

		if (res.status === 202) {
			const data = (await res.json()) as { queueId: string; position: number };
			log(`  Queued at position ${data.position}`);
			// Treat as fired — we won't have a sessionId to track until it starts
			return true;
		}

		const body = await res.text();
		log(`  Failed (${res.status}): ${body}`);
		return false;
	} catch (err) {
		log(`  Error: ${(err as Error).message}`);
		return false;
	}
}

async function pollSession(
	active: ActiveSession,
): Promise<"running" | "done" | "error"> {
	try {
		const res = await fetch(
			`${YA_BASE}/api/projects/${projectId}/sessions/${active.sessionId}/metadata`,
			{ headers: { "X-Yep-Anywhere": "true" } },
		);

		if (!res.ok) return "error";

		const data = (await res.json()) as { ownership: { owner: string } };
		return data.ownership.owner === "none" ? "done" : "running";
	} catch {
		return "error";
	}
}

function updateState(
	config: Config,
	scheduleName: string,
	status: "ok" | "error",
	durationMs: number,
) {
	const schedule = config.schedules?.find((s) => s.name === scheduleName);
	if (!schedule) return;

	if (!schedule._state) {
		schedule._state = { consecutiveErrors: 0, maxConsecutiveErrors: 5 };
	}

	schedule._state.lastRunAt = new Date().toISOString();
	schedule._state.lastStatus = status;

	if (status === "error") {
		schedule._state.consecutiveErrors++;
	} else {
		schedule._state.consecutiveErrors = 0;
	}

	saveConfig(config);

	appendActivity({
		ts: new Date().toISOString(),
		trigger: "schedule",
		source: scheduleName,
		skill: "*",
		status,
		durationMs,
	});
}

// --- Telegram channel ---

function loadEnv(dir: string): Record<string, string> {
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

const instanceEnv = loadEnv(instanceDir);
const telegramToken = instanceEnv.TELEGRAM_BOT_TOKEN ?? process.env.TELEGRAM_BOT_TOKEN;

interface TelegramUser {
	chatId: string;
	name: string;
}

function loadTelegramUsers(): TelegramUser[] {
	const config = loadConfig();
	const tgConfig = config.skills?.telegram as Record<string, unknown> | undefined;
	if (!tgConfig) return [];

	// Support both old single chatId and new allowedUsers list
	const allowedUsers = tgConfig.allowedUsers as TelegramUser[] | undefined;
	if (allowedUsers) return allowedUsers;

	const chatId = (tgConfig.chatId as string) ?? instanceEnv.TELEGRAM_CHAT_ID ?? process.env.TELEGRAM_CHAT_ID;
	if (chatId) return [{ chatId, name: "User" }];
	return [];
}

const telegramUsers = loadTelegramUsers();
const telegramEnabled = !!(telegramToken && telegramUsers.length > 0);

function findTelegramUser(chatId: string): TelegramUser | undefined {
	return telegramUsers.find((u) => u.chatId === chatId);
}

const TELEGRAM_API = telegramToken
	? `https://api.telegram.org/bot${telegramToken}`
	: "";

const telegramOffsetFile = join(instanceDir, "state", "telegram-offset.json");
const telegramHistoryFile = join(instanceDir, "state", "telegram-history.jsonl");
const telegramSessionsFile = join(instanceDir, "state", "telegram-sessions.json");

const HISTORY_CONTEXT_LINES = 20;

// --- Telegram session reuse ---

interface TelegramSessionState {
	[chatId: string]: {
		sessionId: string;
		startedDate: string; // YYYY-MM-DD, reset daily
	};
}

function loadTelegramSessions(): TelegramSessionState {
	try {
		return JSON.parse(readFileSync(telegramSessionsFile, "utf-8")) as TelegramSessionState;
	} catch {
		return {};
	}
}

function saveTelegramSessions(state: TelegramSessionState) {
	const stateDir = join(instanceDir, "state");
	if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
	writeFileSync(telegramSessionsFile, JSON.stringify(state, null, 2));
}

function getTelegramSession(chatId: string): string | undefined {
	const state = loadTelegramSessions();
	const entry = state[chatId];
	if (!entry) return undefined;
	// Reset on new day
	const today = new Date().toISOString().slice(0, 10);
	if (entry.startedDate !== today) {
		delete state[chatId];
		saveTelegramSessions(state);
		return undefined;
	}
	return entry.sessionId;
}

function setTelegramSession(chatId: string, sessionId: string) {
	const state = loadTelegramSessions();
	state[chatId] = {
		sessionId,
		startedDate: new Date().toISOString().slice(0, 10),
	};
	saveTelegramSessions(state);
}

function clearTelegramSession(chatId: string) {
	const state = loadTelegramSessions();
	delete state[chatId];
	saveTelegramSessions(state);
}

interface ChatMessage {
	ts: string;
	role: "user" | "assistant";
	name: string;
	chatId: string;
	text: string;
}

function appendChatHistory(msg: ChatMessage) {
	const stateDir = join(instanceDir, "state");
	if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
	appendFileSync(telegramHistoryFile, `${JSON.stringify(msg)}\n`);
}

function loadRecentHistory(chatId: string): ChatMessage[] {
	try {
		const raw = readFileSync(telegramHistoryFile, "utf-8");
		const lines = raw.trim().split("\n").filter(Boolean);
		const all = lines.map((l) => JSON.parse(l) as ChatMessage);
		// Filter to this chat and take last N
		return all.filter((m) => m.chatId === chatId).slice(-HISTORY_CONTEXT_LINES);
	} catch {
		return [];
	}
}

function loadTelegramOffset(): number | undefined {
	try {
		const data = JSON.parse(readFileSync(telegramOffsetFile, "utf-8"));
		return data.offset;
	} catch {
		return undefined;
	}
}

function saveTelegramOffset(offset: number) {
	const stateDir = join(instanceDir, "state");
	if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
	writeFileSync(telegramOffsetFile, JSON.stringify({ offset }));
}

interface TelegramUpdate {
	update_id: number;
	message?: {
		message_id: number;
		from?: { id: number; first_name?: string; username?: string };
		chat: { id: number };
		date: number;
		text?: string;
		caption?: string;
		photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>;
		document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
		voice?: { file_id: string; duration: number; mime_type?: string; file_size?: number };
		audio?: { file_id: string; duration: number; mime_type?: string; file_name?: string; file_size?: number };
	};
}

async function tg(method: string, params?: Record<string, unknown>): Promise<unknown> {
	const res = await fetch(`${TELEGRAM_API}/${method}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: params ? JSON.stringify(params) : undefined,
	});
	const data = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
	if (!data.ok) throw new Error(`Telegram: ${data.description ?? "unknown error"}`);
	return data.result;
}

async function downloadTelegramFile(fileId: string, destPath: string): Promise<void> {
	const fileInfo = (await tg("getFile", { file_id: fileId })) as { file_path: string };
	const url = `https://api.telegram.org/file/bot${telegramToken}/${fileInfo.file_path}`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Failed to download file: ${res.status}`);
	const buffer = Buffer.from(await res.arrayBuffer());
	const dir = destPath.slice(0, destPath.lastIndexOf("/"));
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(destPath, buffer);
}

async function transcribeViaGroq(audioPath: string): Promise<string> {
	const apiKey = instanceEnv.GROQ_API_KEY ?? process.env.GROQ_API_KEY;
	if (!apiKey) throw new Error("GROQ_API_KEY not set");
	const { readFileSync: readFile } = await import("node:fs");
	const audioData = readFile(audioPath);
	const formData = new FormData();
	formData.append("file", new Blob([audioData]), "audio.ogg");
	formData.append("model", "whisper-large-v3");
	const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
		method: "POST",
		headers: { Authorization: `Bearer ${apiKey}` },
		body: formData,
	});
	if (!res.ok) throw new Error(`Groq API ${res.status}: ${await res.text()}`);
	const data = (await res.json()) as { text: string };
	return data.text || "(inaudible)";
}

async function transcribeViaOpenAI(audioPath: string): Promise<string> {
	const apiKey = instanceEnv.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
	if (!apiKey) throw new Error("OPENAI_API_KEY not set");
	const { readFileSync: readFile } = await import("node:fs");
	const audioData = readFile(audioPath);
	const formData = new FormData();
	formData.append("file", new Blob([audioData]), "audio.ogg");
	formData.append("model", "whisper-1");
	const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
		method: "POST",
		headers: { Authorization: `Bearer ${apiKey}` },
		body: formData,
	});
	if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
	const data = (await res.json()) as { text: string };
	return data.text || "(inaudible)";
}

async function transcribeViaLocal(audioPath: string, pythonPath: string): Promise<string> {
	const { execSync } = await import("node:child_process");
	const script = `
import whisperx, sys, json, torch
device = "cuda" if torch.cuda.is_available() else "cpu"
model = whisperx.load_model("base", device, compute_type="float16" if device == "cuda" else "int8")
result = model.transcribe(sys.argv[1], batch_size=8)
text = " ".join(seg["text"].strip() for seg in result["segments"])
print(json.dumps({"text": text}))
`.trim();
	const result = execSync(
		`${pythonPath} -c ${JSON.stringify(script)} ${JSON.stringify(audioPath)}`,
		{ timeout: 30000, encoding: "utf-8" },
	);
	const parsed = JSON.parse(result.trim());
	return parsed.text || "(inaudible)";
}

async function transcribeAudio(audioPath: string): Promise<string> {
	const config = loadConfig();
	const transcription = (config.skills?.transcription ?? {}) as Record<string, string>;
	const backend = transcription.backend ?? "auto";

	const backends: Array<{ name: string; fn: () => Promise<string> }> = [];

	if (backend === "groq" || backend === "auto") {
		backends.push({ name: "groq", fn: () => transcribeViaGroq(audioPath) });
	}
	if (backend === "openai" || backend === "auto") {
		backends.push({ name: "openai", fn: () => transcribeViaOpenAI(audioPath) });
	}
	if (backend === "local" || backend === "auto") {
		const pythonPath = transcription.pythonPath ?? "";
		if (pythonPath) {
			backends.push({ name: "local", fn: () => transcribeViaLocal(audioPath, pythonPath) });
		}
	}

	// If explicit backend, just try that one
	if (backend !== "auto" && backends.length === 1) {
		try {
			return await backends[0].fn();
		} catch (err) {
			log(`  Transcription (${backend}) failed: ${(err as Error).message}`);
			return "(transcription failed)";
		}
	}

	// Auto: try each backend in order
	for (const b of backends) {
		try {
			const text = await b.fn();
			log(`  Transcribed via ${b.name}`);
			return text;
		} catch (err) {
			log(`  Transcription (${b.name}) failed: ${(err as Error).message}`);
		}
	}

	return "(transcription failed — no backend available)";
}

function attachmentDir(chatId: string): string {
	return join(instanceDir, "state", "attachments", chatId);
}

async function sendTypingIndicator(chatId: string) {
	try {
		await tg("sendChatAction", { chat_id: chatId, action: "typing" });
	} catch {
		// Non-critical — don't block session on typing indicator failure
	}
}

async function sendTelegramReply(chatId: string, text: string) {
	// Split long messages
	const MAX_LEN = 4096;
	for (let i = 0; i < text.length; i += MAX_LEN) {
		await tg("sendMessage", {
			chat_id: chatId,
			text: text.slice(i, i + MAX_LEN),
		});
	}
}

function formatHistoryContext(history: ChatMessage[]): string {
	if (history.length === 0) return "";
	const lines = history.map((m) => {
		const who = m.role === "user" ? m.name : "Scout";
		return `[${m.ts}] ${who}: ${m.text}`;
	});
	return [
		"## Recent conversation history",
		"",
		...lines,
		"",
	].join("\n");
}

function buildChannelMessage(text: string, user: TelegramUser, attachments?: string[]): string {
	const sendCmd = `ASSISTANT_INSTANCE_DIR=${instanceDir} tsx ${resolve(import.meta.dirname ?? ".", "telegram-cli.ts")} send --to ${user.chatId} --message`;
	const history = loadRecentHistory(user.chatId);
	const historyBlock = formatHistoryContext(history);

	const attachmentBlock = attachments?.length
		? [
			"## Attachments",
			"",
			"The user sent the following files. Use the Read tool to view them:",
			...attachments.map((a) => `- ${a}`),
			"",
		].join("\n")
		: "";

	return [
		`ASSISTANT_TRIGGER=channel:telegram`,
		`ASSISTANT_CHANNEL=${JSON.stringify({ transport: "telegram", chatId: user.chatId, userName: user.name, sendCommand: sendCmd })}`,
		"",
		"## Channel mode behavior",
		"",
		"You are responding to a message from a Telegram chat. Follow these rules:",
		"1. Work silently — tool calls, research, browsing are invisible to the user.",
		"2. Send a final concise response via Telegram when done.",
		"3. Limit to 1-3 messages. Batch information into a single message when possible.",
		"4. Keep messages short — under ~500 chars unless detail was requested.",
		"5. Match conversational tone — this is chat, not a terminal.",
		"6. For short replies, use `--no-parse` to avoid escaping issues. For rich content, write markdown to a file and send with `--message-file <path> --markdown`.",
		"7. If a task takes significant work, send a brief acknowledgment first, then the result.",
		"",
		historyBlock,
		attachmentBlock,
		`## New message`,
		"",
		`${user.name}:`,
		text,
		"",
		`To reply: telegram send --to ${user.chatId} --message "your response" --no-parse`,
		`For rich content: write markdown to /tmp/reply.md, then: telegram send --to ${user.chatId} --message-file /tmp/reply.md --markdown`,
		"",
		"Execute autonomously. Send your response via Telegram, then finish.",
	].join("\n");
}

let telegramOffset = telegramEnabled ? loadTelegramOffset() : undefined;

async function pollTelegram() {
	if (!telegramEnabled) return;

	try {
		const updates = (await tg("getUpdates", {
			timeout: 0,
			limit: 10,
			...(telegramOffset !== undefined && { offset: telegramOffset }),
		})) as TelegramUpdate[];

		for (const update of updates) {
			telegramOffset = update.update_id + 1;
			saveTelegramOffset(telegramOffset);

			const msg = update.message;
			if (!msg) continue;

			// Extract text: prefer text, fall back to caption for photos/documents
			let msgText = msg.text ?? msg.caption ?? "";
			const hasPhoto = !!msg.photo?.length;
			const hasDocument = !!msg.document;
			const hasVoice = !!msg.voice;
			const hasAudio = !!msg.audio;

			// Skip messages with no text/caption and no attachments
			if (!msgText && !hasPhoto && !hasDocument && !hasVoice && !hasAudio) continue;

			// Only accept messages from allowed users
			const chatIdStr = String(msg.chat.id);
			const user = findTelegramUser(chatIdStr);
			if (!user) {
				log(`Telegram: ignoring message from unauthorized chat ${chatIdStr}`);
				continue;
			}

			// Skip /start command
			if (msgText === "/start") continue;

			// Handle /new — reset session for this chat
			if (msgText.trim() === "/new") {
				clearTelegramSession(chatIdStr);
				log(`Telegram: session reset for ${user.name}`);
				await sendTelegramReply(chatIdStr, "Session reset. Next message starts fresh.");
				continue;
			}

			const attachmentNote = hasPhoto ? " [photo attached]" : hasDocument ? ` [file: ${msg.document!.file_name ?? "document"}]` : (hasVoice || hasAudio) ? " [audio message]" : "";
			log(`Telegram: message from ${user.name} (@${msg.from?.username ?? "unknown"}): ${(msgText || "(no text)").slice(0, 80)}${attachmentNote}`);

			// Download attachments
			const attachments: string[] = [];
			const ts = new Date(msg.date * 1000).toISOString().replace(/[:.]/g, "-");
			const destDir = attachmentDir(chatIdStr);

			if (hasPhoto) {
				// Download largest photo (last in array)
				const photo = msg.photo![msg.photo!.length - 1];
				const dest = join(destDir, `${ts}-photo.jpg`);
				try {
					await downloadTelegramFile(photo.file_id, dest);
					attachments.push(dest);
					log(`  Downloaded photo → ${dest}`);
				} catch (err) {
					log(`  Failed to download photo: ${(err as Error).message}`);
				}
			}

			if (hasDocument) {
				const doc = msg.document!;
				const ext = doc.file_name?.split(".").pop() ?? "bin";
				const name = doc.file_name ?? `document.${ext}`;
				const dest = join(destDir, `${ts}-${name}`);
				try {
					await downloadTelegramFile(doc.file_id, dest);
					attachments.push(dest);
					log(`  Downloaded document → ${dest}`);
				} catch (err) {
					log(`  Failed to download document: ${(err as Error).message}`);
				}
			}

			if (hasVoice || hasAudio) {
				const fileId = hasVoice ? msg.voice!.file_id : msg.audio!.file_id;
				const ext = hasVoice ? "ogg" : (msg.audio!.file_name?.split(".").pop() ?? "ogg");
				const dest = join(destDir, `${ts}-voice.${ext}`);
				try {
					await downloadTelegramFile(fileId, dest);
					log(`  Downloaded voice → ${dest}`);
					// Transcribe
					log(`  Transcribing...`);
					const transcription = await transcribeAudio(dest);
					log(`  Transcription: ${transcription.slice(0, 100)}`);
					// Prepend transcription to message text
					const voicePrefix = `[voice message: "${transcription}"]`;
					msgText = msgText ? `${voicePrefix} ${msgText}` : voicePrefix;
				} catch (err) {
					log(`  Failed to process voice: ${(err as Error).message}`);
					msgText = msgText || "[voice message — transcription failed]";
				}
			}

			// Record inbound message
			const fullText = msgText + attachmentNote;
			appendChatHistory({
				ts: new Date(msg.date * 1000).toISOString(),
				role: "user",
				name: user.name,
				chatId: user.chatId,
				text: fullText,
			});

			// Send typing indicator immediately so user knows we're on it
			await sendTypingIndicator(chatIdStr);

			// Resume existing session or start new one
			const existingSessionId = getTelegramSession(chatIdStr);
			try {
				let sessionStarted = false;

				if (existingSessionId) {
					// Resume — send just the user message, session already has full context
					const resumeMessage = attachments?.length
						? `${fullText}\n\nAttachments:\n${attachments.map((a) => `- ${a}`).join("\n")}`
						: fullText;
					const res = await fetch(
						`${YA_BASE}/api/projects/${projectId}/sessions/${existingSessionId}/resume`,
						{
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								"X-Yep-Anywhere": "true",
							},
							body: JSON.stringify({
								message: resumeMessage,
								mode: "bypassPermissions",
							}),
						},
					);

					if (res.status === 200) {
						log(`  Telegram session resumed: ${existingSessionId}`);
						sessionStarted = true;
					} else {
						// Resume failed — clear stale session, fall through to create new
						log(`  Resume failed (${res.status}), starting fresh`);
						clearTelegramSession(chatIdStr);
					}
				}

				if (!sessionStarted) {
					// New session with full channel context
					const sessionMessage = buildChannelMessage(fullText, user, attachments.length ? attachments : undefined);
					const res = await fetch(`${YA_BASE}/api/projects/${projectId}/sessions`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"X-Yep-Anywhere": "true",
						},
						body: JSON.stringify({
							message: sessionMessage,
							mode: "bypassPermissions",
						}),
					});

					if (res.status === 200) {
						const data = (await res.json()) as { sessionId: string };
						log(`  Telegram session started: ${data.sessionId}`);
						setTelegramSession(chatIdStr, data.sessionId);
					} else if (res.status === 202) {
						log(`  Telegram session queued`);
					} else {
						const body = await res.text();
						log(`  Telegram session failed (${res.status}): ${body}`);
						await sendTelegramReply(chatIdStr, "Sorry, I couldn't start a session right now. Try again in a moment.");
					}
				}
			} catch (err) {
				log(`  Telegram session error: ${(err as Error).message}`);
			}

			appendActivity({
				ts: new Date().toISOString(),
				trigger: "channel",
				source: "telegram",
				skill: "*",
				status: "ok",
				user: user.name,
				messagePreview: fullText.slice(0, 100),
			});
		}
	} catch (err) {
		log(`Telegram poll error: ${(err as Error).message}`);
	}
}

// --- Cron logic ---

interface ScheduleTracker {
	schedule: Schedule;
	nextFire: Date;
	advance(): void;
}

function initTrackers(schedules: Schedule[]): ScheduleTracker[] {
	return schedules
		.filter((s) => s.enabled !== false)
		.map((s) => {
			const interval = cronParser.parseExpression(s.cron, {
				tz: "Europe/Zurich",
				currentDate: new Date(),
			});
			return {
				schedule: s,
				nextFire: interval.next().toDate(),
				advance() {
					this.nextFire = interval.next().toDate();
				},
			};
		});
}

function isAutoDisabled(schedule: Schedule): boolean {
	const state = schedule._state;
	if (!state) return false;
	const max = state.maxConsecutiveErrors ?? 5;
	return state.consecutiveErrors >= max;
}

// --- Main loop ---

async function runLoop() {
	let config = loadConfig();
	let trackers = initTrackers(config.schedules ?? []);
	let lastConfigJson = JSON.stringify(config.schedules ?? []);

	function logTrackers() {
		log(`Tracking ${trackers.length} schedule(s):`);
		for (const t of trackers) {
			log(`  ${t.schedule.name}: next fire at ${t.nextFire.toISOString()}`);
		}
	}

	log(`Scheduler started for ${config.name}`);
	logTrackers();

	const tick = async () => {
		const now = new Date();

		// Reload config and re-init trackers if schedules changed
		config = loadConfig();
		const currentJson = JSON.stringify(config.schedules ?? []);
		if (currentJson !== lastConfigJson) {
			log("Config changed, reinitializing trackers");
			trackers = initTrackers(config.schedules ?? []);
			lastConfigJson = currentJson;
			logTrackers();
		}

		// Check schedules
		for (const tracker of trackers) {
			const { schedule } = tracker;

			if (isAutoDisabled(schedule)) continue;
			if (activeSessions.has(schedule.name)) continue;

			if (now >= tracker.nextFire) {
				const success = await fireSchedule(schedule, config);

				if (!success) {
					updateState(config, schedule.name, "error", 0);
				}

				tracker.advance();
				log(
					`  ${schedule.name}: next fire at ${tracker.nextFire.toISOString()}`,
				);
			}
		}

		// Poll active sessions
		for (const [name, active] of Array.from(activeSessions.entries())) {
			const result = await pollSession(active);

			if (result === "done") {
				const durationMs = Date.now() - active.startedAt;
				log(`Session completed: ${name} (${Math.round(durationMs / 1000)}s)`);
				config = loadConfig();
				updateState(config, name, "ok", durationMs);
				activeSessions.delete(name);
			} else if (result === "error") {
				const durationMs = Date.now() - active.startedAt;
				// Only count as error if we've been polling for a while (not just a transient fetch failure)
				if (durationMs > 60_000) {
					log(`Session error/lost: ${name}`);
					config = loadConfig();
					updateState(config, name, "error", durationMs);
					activeSessions.delete(name);
				}
			}
		}
	};

	// Run every 30 seconds
	const intervalId = setInterval(tick, 30_000);

	// Telegram polling — faster interval for responsive chat
	let telegramIntervalId: ReturnType<typeof setInterval> | undefined;
	if (telegramEnabled) {
		log(`Telegram channel enabled (${telegramUsers.length} user(s): ${telegramUsers.map((u) => u.name).join(", ")})`);
		telegramIntervalId = setInterval(pollTelegram, 5_000);
		// Initial poll
		await pollTelegram();
	}

	// Graceful shutdown
	const shutdown = () => {
		log("Shutting down...");
		clearInterval(intervalId);
		if (telegramIntervalId) clearInterval(telegramIntervalId);
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	// Initial tick
	await tick();
}

async function runNow(scheduleName: string) {
	const config = loadConfig();
	const schedule = config.schedules?.find((s) => s.name === scheduleName);

	if (!schedule) {
		console.error(`Schedule "${scheduleName}" not found in config.yaml`);
		console.error(
			`Available: ${config.schedules?.map((s) => s.name).join(", ") ?? "none"}`,
		);
		process.exit(1);
	}

	log(`Running schedule immediately: ${scheduleName}`);
	const success = await fireSchedule(schedule, config);

	if (!success) {
		updateState(config, scheduleName, "error", 0);
		process.exit(1);
	}

	// Poll until done
	log("Waiting for session to complete...");
	const active = activeSessions.get(scheduleName);
	if (!active) {
		log("No active session to track (may have been queued)");
		return;
	}

	const pollInterval = setInterval(async () => {
		const result = await pollSession(active);
		if (result === "done") {
			const durationMs = Date.now() - active.startedAt;
			log(`Done (${Math.round(durationMs / 1000)}s)`);
			const freshConfig = loadConfig();
			updateState(freshConfig, scheduleName, "ok", durationMs);
			clearInterval(pollInterval);
		} else if (result === "error") {
			const durationMs = Date.now() - active.startedAt;
			if (durationMs > 60_000) {
				log("Session lost");
				const freshConfig = loadConfig();
				updateState(freshConfig, scheduleName, "error", durationMs);
				clearInterval(pollInterval);
				process.exit(1);
			}
		}
	}, 5_000);
}

// --- Entry point ---

if (typeof args["run-now"] === "string") {
	await runNow(args["run-now"]);
} else {
	await runLoop();
}
