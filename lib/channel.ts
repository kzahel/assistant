/**
 * Generic channel abstraction — session management, chat history,
 * message building, and session orchestration via the Yep Anywhere API.
 *
 * Transport-specific implementations (Telegram, etc.) live in channels/.
 */

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir } from "./utils.js";

// --- Types ---

export interface ChannelUser {
	chatId: string;
	name: string;
}

export interface ChatMessage {
	ts: string;
	role: "user" | "assistant";
	name: string;
	chatId: string;
	text: string;
}

export interface ChannelSessionEntry {
	sessionId: string;
	startedDate: string; // YYYY-MM-DD
}

export interface ChannelTransport {
	readonly name: string;
	enabled: boolean;
	poll(): Promise<void>;
}

export interface ChannelContext {
	instanceDir: string;
	yaBase: string;
	projectId: string;
	log: (msg: string) => void;
	appendActivity: (entry: Record<string, unknown>) => void;
}

// --- Session Manager ---

export class SessionManager {
	private filePath: string;
	private stateDir: string;

	constructor(instanceDir: string, transportName: string) {
		this.stateDir = join(instanceDir, "state");
		this.filePath = join(this.stateDir, `${transportName}-sessions.json`);
	}

	private load(): Record<string, ChannelSessionEntry> {
		try {
			return JSON.parse(readFileSync(this.filePath, "utf-8"));
		} catch {
			return {};
		}
	}

	private save(state: Record<string, ChannelSessionEntry>): void {
		ensureDir(this.stateDir);
		writeFileSync(this.filePath, JSON.stringify(state, null, 2));
	}

	get(chatId: string): string | undefined {
		const state = this.load();
		const entry = state[chatId];
		if (!entry) return undefined;
		const today = new Date().toISOString().slice(0, 10);
		if (entry.startedDate !== today) {
			delete state[chatId];
			this.save(state);
			return undefined;
		}
		return entry.sessionId;
	}

	set(chatId: string, sessionId: string): void {
		const state = this.load();
		state[chatId] = {
			sessionId,
			startedDate: new Date().toISOString().slice(0, 10),
		};
		this.save(state);
	}

	clear(chatId: string): void {
		const state = this.load();
		delete state[chatId];
		this.save(state);
	}
}

// --- Chat History ---

export class ChatHistory {
	private filePath: string;
	private stateDir: string;
	private contextLines: number;

	constructor(instanceDir: string, transportName: string, contextLines = 20) {
		this.stateDir = join(instanceDir, "state");
		this.filePath = join(this.stateDir, `${transportName}-history.jsonl`);
		this.contextLines = contextLines;
	}

	append(msg: ChatMessage): void {
		ensureDir(this.stateDir);
		appendFileSync(this.filePath, `${JSON.stringify(msg)}\n`);
	}

	loadRecent(chatId: string): ChatMessage[] {
		try {
			const raw = readFileSync(this.filePath, "utf-8");
			const lines = raw.trim().split("\n").filter(Boolean);
			const all = lines.map((l) => JSON.parse(l) as ChatMessage);
			return all.filter((m) => m.chatId === chatId).slice(-this.contextLines);
		} catch {
			return [];
		}
	}

}

export function formatHistoryContext(history: ChatMessage[]): string {
	if (history.length === 0) return "";
	const lines = history.map((m) => {
		const who = m.role === "user" ? m.name : "Scout";
		return `[${m.ts}] ${who}: ${m.text}`;
	});
	return ["## Recent conversation history", "", ...lines, ""].join("\n");
}

// --- Message Builder ---

export interface BuildChannelMessageOpts {
	text: string;
	user: ChannelUser;
	transportName: string;
	sendCommand: string;
	history: ChatMessage[];
	attachments?: string[];
}

export function buildChannelMessage(opts: BuildChannelMessageOpts): string {
	const { text, user, transportName, sendCommand, history, attachments } = opts;

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

	const channelMeta = JSON.stringify({
		transport: transportName,
		chatId: user.chatId,
		userName: user.name,
		sendCommand,
	});

	return [
		`ASSISTANT_TRIGGER=channel:${transportName}`,
		`ASSISTANT_CHANNEL=${channelMeta}`,
		"",
		`## Channel mode behavior`,
		"",
		`You are responding to a message from a ${transportName} chat. Follow these rules:`,
		"1. Work silently — tool calls, research, browsing are invisible to the user.",
		"2. Send a final concise response via Telegram when done.",
		"3. Limit to 1-3 messages. Batch information into a single message when possible.",
		"4. Keep messages short — under ~500 chars unless detail was requested.",
		"5. Match conversational tone — this is chat, not a terminal.",
		`6. For short replies, use \`--no-parse\` to avoid escaping issues. For rich content, write markdown to a file and send with \`--message-file <path> --markdown\`.`,
		"7. If a task takes significant work, send a brief acknowledgment first, then the result.",
		"",
		historyBlock,
		attachmentBlock,
		`## New message`,
		"",
		`${user.name}:`,
		text,
		"",
		`To reply: ${transportName} send --to ${user.chatId} --message "your response" --no-parse`,
		`For rich content: write markdown to /tmp/reply.md, then: ${transportName} send --to ${user.chatId} --message-file /tmp/reply.md --markdown`,
		"",
		"Execute autonomously. Send your response via Telegram, then finish.",
	].join("\n");
}

// --- Session Orchestration ---

export interface SessionOrchestrateOpts {
	ctx: ChannelContext;
	chatId: string;
	user: ChannelUser;
	messageText: string;
	attachments?: string[];
	sessionManager: SessionManager;
	chatHistory: ChatHistory;
	sendCommand: string;
	transportName: string;
	sendReply: (chatId: string, text: string) => Promise<void>;
}

export async function orchestrateSession(opts: SessionOrchestrateOpts): Promise<void> {
	const {
		ctx,
		chatId,
		user,
		messageText,
		attachments,
		sessionManager,
		chatHistory,
		sendCommand,
		transportName,
		sendReply,
	} = opts;

	const existingSessionId = sessionManager.get(chatId);
	let sessionStarted = false;

	if (existingSessionId) {
		const resumeMessage = attachments?.length
			? `${messageText}\n\nAttachments:\n${attachments.map((a) => `- ${a}`).join("\n")}`
			: messageText;
		const res = await fetch(
			`${ctx.yaBase}/api/projects/${ctx.projectId}/sessions/${existingSessionId}/resume`,
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
			ctx.log(`  ${transportName} session resumed: ${existingSessionId}`);
			sessionStarted = true;
		} else {
			ctx.log(`  Resume failed (${res.status}), starting fresh`);
			sessionManager.clear(chatId);
		}
	}

	if (!sessionStarted) {
		const history = chatHistory.loadRecent(chatId);
		const sessionMessage = buildChannelMessage({
			text: messageText,
			user,
			transportName,
			sendCommand,
			history,
			attachments,
		});
		const res = await fetch(`${ctx.yaBase}/api/projects/${ctx.projectId}/sessions`, {
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
			ctx.log(`  ${transportName} session started: ${data.sessionId}`);
			sessionManager.set(chatId, data.sessionId);
		} else if (res.status === 202) {
			ctx.log(`  ${transportName} session queued`);
		} else {
			const body = await res.text();
			ctx.log(`  ${transportName} session failed (${res.status}): ${body}`);
			await sendReply(chatId, "Sorry, I couldn't start a session right now. Try again in a moment.");
		}
	}
}
