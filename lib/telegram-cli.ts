#!/usr/bin/env tsx

/**
 * Telegram Bot CLI — send and receive messages via the Telegram Bot API.
 *
 * Usage:
 *   telegram send --message "text"
 *   telegram send --message-file report.md --markdown
 *   echo "hello" | telegram send
 *   telegram send --to <chat-id> --message <text>
 *   telegram poll [--timeout 30] [--offset <update-id>]
 *   telegram get-me
 *   telegram get-chat-id
 *
 * Requires TELEGRAM_BOT_TOKEN in the instance .env file.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { marked } from "marked";
import { loadEnv, resolveInstanceDir } from "./utils.js";
import { createTgApi } from "./channels/telegram.js";

// --- Resolve instance dir ---

const instanceDir = resolveInstanceDir();

const env = loadEnv(instanceDir);
const botToken =
	env.TELEGRAM_BOT_TOKEN ?? process.env.TELEGRAM_BOT_TOKEN;

if (!botToken) {
	console.error(
		"TELEGRAM_BOT_TOKEN not set. Add it to .env or export it.",
	);
	process.exit(1);
}

// --- Telegram API ---

const tg = createTgApi(botToken, {
	onError: (msg) => {
		console.error(msg);
		process.exit(1);
	},
});

// --- Helpers ---

function readStdin(): Promise<string> {
	return new Promise((resolve, reject) => {
		if (process.stdin.isTTY) {
			resolve("");
			return;
		}
		const chunks: Buffer[] = [];
		process.stdin.on("data", (chunk) => chunks.push(chunk));
		process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
		process.stdin.on("error", reject);
	});
}

function mdToHtml(md: string): string {
	const html = marked.parse(md, { async: false }) as string;

	// Telegram only supports: b, strong, i, em, u, ins, s, strike, del,
	// a, code, pre, blockquote, tg-spoiler. Convert everything else.
	return html
		// Headers → bold + newline
		.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, "<b>$1</b>\n")
		// List items → bullet points
		.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "• $1\n")
		// Strip list wrappers
		.replace(/<\/?[uo]l[^>]*>/gi, "")
		// Paragraphs → content + double newline
		.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n")
		// <br> → newline
		.replace(/<br\s*\/?>/gi, "\n")
		// <hr> → separator
		.replace(/<hr\s*\/?>/gi, "---\n")
		// Strip any remaining unsupported tags (img, div, span, table, etc.)
		.replace(/<(?!\/?(?:b|strong|i|em|u|ins|s|strike|del|a|code|pre|blockquote|tg-spoiler)\b)[^>]+>/gi, "")
		// Collapse excessive newlines
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

// --- Commands ---

async function cmdGetMe() {
	const me = await tg("getMe");
	console.log(JSON.stringify(me, null, 2));
}

async function cmdGetChatId() {
	// Fetch bot username dynamically
	const me = (await tg("getMe")) as { username?: string };
	const botName = me.username ? `@${me.username}` : "the bot";
	console.log(
		`Waiting for a message to the bot... (send any message to ${botName})`,
	);
	console.log("Press Ctrl+C to cancel.\n");

	let offset: number | undefined;

	// Poll until we get a message
	while (true) {
		const updates = (await tg("getUpdates", {
			timeout: 30,
			...(offset !== undefined && { offset }),
		})) as Array<{
			update_id: number;
			message?: { chat: { id: number; first_name?: string; username?: string } };
		}>;

		for (const update of updates) {
			offset = update.update_id + 1;
			if (update.message) {
				const chat = update.message.chat;
				console.log(`Chat ID: ${chat.id}`);
				if (chat.first_name) console.log(`Name: ${chat.first_name}`);
				if (chat.username) console.log(`Username: @${chat.username}`);
				return;
			}
		}
	}
}

async function cmdSend(args: string[]) {
	const { values } = parseArgs({
		args,
		options: {
			to: { type: "string" },
			message: { type: "string" },
			"message-file": { type: "string" },
			markdown: { type: "boolean", default: false },
			"no-parse": { type: "boolean", default: false },
			parse: { type: "string" },
		},
		strict: false,
	});

	const chatId = values.to ?? env.TELEGRAM_CHAT_ID ?? process.env.TELEGRAM_CHAT_ID;

	if (!chatId) {
		console.error(
			"No recipient. Use --to <chat-id> or set TELEGRAM_CHAT_ID in .env.",
		);
		process.exit(1);
	}

	// Resolve message text: --message > --message-file > stdin
	let text = values.message ?? "";
	if (!text && values["message-file"]) {
		text = readFileSync(
			resolve(values["message-file"] as string),
			"utf-8",
		);
	}
	if (!text) {
		text = await readStdin();
	}

	if (!text.trim()) {
		console.error("No message. Use --message, --message-file, or pipe to stdin.");
		process.exit(1);
	}

	// Determine parse_mode and convert markdown if requested
	let parseMode: string | undefined;
	if (values["no-parse"]) {
		parseMode = undefined;
	} else if (values.markdown) {
		text = mdToHtml(text);
		parseMode = "HTML";
	} else if (values.parse) {
		parseMode = values.parse;
	} else {
		parseMode = "HTML";
	}

	// Telegram has a 4096 char limit per message — split if needed
	const MAX_LEN = 4096;
	const chunks: string[] = [];
	for (let i = 0; i < text.length; i += MAX_LEN) {
		chunks.push(text.slice(i, i + MAX_LEN));
	}

	for (const chunk of chunks) {
		const params: Record<string, unknown> = {
			chat_id: chatId,
			text: chunk,
		};
		if (parseMode) params.parse_mode = parseMode;
		await tg("sendMessage", params);
	}

	// Append to chat history
	const historyFile = join(instanceDir, "state", "telegram-history.jsonl");
	const stateDir = join(instanceDir, "state");
	if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
	appendFileSync(
		historyFile,
		`${JSON.stringify({
			ts: new Date().toISOString(),
			role: "assistant",
			name: "Scout",
			chatId,
			text,
		})}\n`,
	);

	console.log(`Sent ${chunks.length} message(s) to ${chatId}.`);
}

async function cmdPoll(args: string[]) {
	const { values } = parseArgs({
		args,
		options: {
			timeout: { type: "string", default: "30" },
			offset: { type: "string" },
			limit: { type: "string", default: "10" },
		},
		strict: false,
	});

	const params: Record<string, unknown> = {
		timeout: Number(values.timeout),
		limit: Number(values.limit),
	};
	if (values.offset) params.offset = Number(values.offset);

	const updates = (await tg("getUpdates", params)) as Array<{
		update_id: number;
		message?: {
			message_id: number;
			from?: { id: number; first_name?: string; username?: string };
			chat: { id: number };
			date: number;
			text?: string;
		};
	}>;

	if (updates.length === 0) {
		console.log("No new messages.");
		return;
	}

	for (const update of updates) {
		const msg = update.message;
		if (!msg) continue;
		const from = msg.from?.username
			? `@${msg.from.username}`
			: msg.from?.first_name ?? "unknown";
		const date = new Date(msg.date * 1000).toISOString();
		console.log(`[${date}] ${from} (chat:${msg.chat.id}): ${msg.text ?? "(non-text)"}`);
		console.log(`  update_id: ${update.update_id}`);
	}
}

async function cmdTyping(args: string[]) {
	const { values } = parseArgs({
		args,
		options: {
			to: { type: "string" },
		},
		strict: false,
	});

	const chatId = values.to ?? env.TELEGRAM_CHAT_ID ?? process.env.TELEGRAM_CHAT_ID;

	if (!chatId) {
		console.error(
			"No recipient. Use --to <chat-id> or set TELEGRAM_CHAT_ID in .env.",
		);
		process.exit(1);
	}

	await tg("sendChatAction", { chat_id: chatId, action: "typing" });
	console.log(`Sent typing indicator to ${chatId}.`);
}

// --- Main ---

const [command, ...rest] = process.argv.slice(2);

switch (command) {
	case "get-me":
		await cmdGetMe();
		break;
	case "get-chat-id":
		await cmdGetChatId();
		break;
	case "send":
		await cmdSend(rest);
		break;
	case "poll":
		await cmdPoll(rest);
		break;
	case "typing":
		await cmdTyping(rest);
		break;
	default:
		console.error("Usage: telegram <get-me|get-chat-id|send|poll|typing> [options]");
		console.error("Commands:");
		console.error("  get-me                               Verify bot token");
		console.error("  get-chat-id                          Wait for a message and print the chat ID");
		console.error("  send [options]                       Send a message");
		console.error("    --message <text>                   Inline message text");
		console.error("    --message-file <path>              Read message from file");
		console.error("    (stdin)                            Pipe message via stdin");
		console.error("    --markdown                         Convert markdown input to HTML");
		console.error("    --no-parse                         Send as plain text (no parse_mode)");
		console.error("    --parse <mode>                     Explicit parse_mode (default: HTML)");
		console.error("    --to <chat-id>                     Recipient (default: TELEGRAM_CHAT_ID)");
		console.error("  poll [--timeout 30]                  Long-poll for incoming messages");
		console.error("  typing [--to <chat-id>]              Send typing indicator");
		process.exit(1);
}
