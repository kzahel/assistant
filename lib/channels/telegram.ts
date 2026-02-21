/**
 * Telegram transport — implements ChannelTransport for the Telegram Bot API.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ensureDir } from "../utils.js";
import {
	type ChannelContext,
	type ChannelTransport,
	type ChannelUser,
	ChatHistory,
	SessionManager,
	orchestrateSession,
} from "../channel.js";
import type { PermissionMode } from "../session-executor.js";
import { transcribeAudio, type TranscriptionConfig } from "../transcription.js";

// --- Command registry ---

const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
	bypassPermissions: "yolo (auto-approve everything)",
	default: "careful (approve writes, auto-approve reads)",
	plan: "readonly (read-only, no mutations)",
};

interface CommandContext {
	chatId: string;
	user: ChannelUser;
	sessionManager: SessionManager;
	pendingChats: Set<string>;
	contextWarned: Set<string>;
	ctx: ChannelContext;
	sendReply: (chatId: string, text: string) => Promise<void>;
}

interface Command {
	description: string;
	handler: (cmdCtx: CommandContext) => Promise<void>;
}

function createCommands(): Record<string, Command> {
	return {
		"/new": {
			description: "Reset session — start fresh",
			handler: async ({ chatId, user, sessionManager, contextWarned, ctx, sendReply }) => {
				sessionManager.clear(chatId);
				contextWarned.delete(chatId);
				ctx.log(`Telegram: session reset for ${user.name}`);
				await sendReply(chatId, "Session reset. Next message starts fresh.");
			},
		},
		"/stop": {
			description: "Abort current session",
			handler: async ({
				chatId,
				user,
				sessionManager,
				pendingChats,
				contextWarned,
				ctx,
				sendReply,
			}) => {
				const sessionId = sessionManager.get(chatId);
				if (sessionId) {
					await ctx.executor.cleanup(sessionId);
					sessionManager.clear(chatId);
					pendingChats.delete(chatId);
					contextWarned.delete(chatId);
					ctx.log(`Telegram: session stopped for ${user.name}`);
					await sendReply(chatId, "Session stopped.");
				} else {
					await sendReply(chatId, "No active session.");
				}
			},
		},
		"/yolo": {
			description: "Auto-approve everything (default)",
			handler: async ({ chatId, sessionManager, sendReply }) => {
				sessionManager.setPermissionMode(chatId, "bypassPermissions");
				await sendReply(chatId, "Mode: yolo — auto-approve everything.");
			},
		},
		"/careful": {
			description: "Auto-approve reads, prompt for writes",
			handler: async ({ chatId, sessionManager, sendReply }) => {
				sessionManager.setPermissionMode(chatId, "default");
				await sendReply(
					chatId,
					"Mode: careful — reads auto-approved, writes need approval.",
				);
			},
		},
		"/readonly": {
			description: "Read-only — no mutations allowed",
			handler: async ({ chatId, sessionManager, sendReply }) => {
				sessionManager.setPermissionMode(chatId, "plan");
				await sendReply(chatId, "Mode: readonly — no mutations.");
			},
		},
		"/status": {
			description: "Show current session info",
			handler: async ({ chatId, sessionManager, ctx, sendReply }) => {
				const entry = sessionManager.getEntry(chatId);
				const mode =
					PERMISSION_MODE_LABELS[entry?.permissionMode ?? "bypassPermissions"];
				if (!entry?.sessionId) {
					await sendReply(chatId, `No active session.\nMode: ${mode}`);
					return;
				}
				const result = await ctx.executor.poll(entry.sessionId);
				const statusLine = result.pendingInput
					? `${result.status} (waiting: ${result.pendingInput.type})`
					: result.status;
				const contextLine = result.contextUsage
					? `\nContext: ${Math.round(result.contextUsage.percentage)}%`
					: "";
				await sendReply(
					chatId,
					`Session: ${entry.sessionId.slice(0, 8)}...\nMode: ${mode}\nStatus: ${statusLine}${contextLine}`,
				);
			},
		},
		"/help": {
			description: "List available commands",
			handler: async ({ chatId, sendReply }) => {
				const commands = createCommands();
				const lines = Object.entries(commands).map(
					([cmd, { description }]) => `${cmd} — ${description}`,
				);
				await sendReply(chatId, lines.join("\n"));
			},
		},
	};
}

// --- Telegram API ---

export function createTgApi(
	token: string,
	opts?: { onError?: (msg: string) => never },
) {
	const apiBase = `https://api.telegram.org/bot${token}`;

	return async function tg(
		method: string,
		params?: Record<string, unknown>,
	): Promise<unknown> {
		const res = await fetch(`${apiBase}/${method}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: params ? JSON.stringify(params) : undefined,
		});
		const data = (await res.json()) as {
			ok: boolean;
			result?: unknown;
			description?: string;
		};
		if (!data.ok) {
			const msg = `Telegram: ${data.description ?? "unknown error"}`;
			if (opts?.onError) opts.onError(msg);
			throw new Error(msg);
		}
		return data.result;
	};
}

export type TgApi = ReturnType<typeof createTgApi>;

// --- Types ---

export interface TelegramUpdate {
	update_id: number;
	message?: {
		message_id: number;
		from?: { id: number; first_name?: string; username?: string };
		chat: { id: number };
		date: number;
		text?: string;
		caption?: string;
		photo?: Array<{
			file_id: string;
			file_unique_id: string;
			width: number;
			height: number;
			file_size?: number;
		}>;
		document?: {
			file_id: string;
			file_name?: string;
			mime_type?: string;
			file_size?: number;
		};
		voice?: {
			file_id: string;
			duration: number;
			mime_type?: string;
			file_size?: number;
		};
		audio?: {
			file_id: string;
			duration: number;
			mime_type?: string;
			file_name?: string;
			file_size?: number;
		};
	};
	callback_query?: {
		id: string;
		from: { id: number; first_name?: string; username?: string };
		message?: { message_id: number; chat: { id: number } };
		data?: string;
	};
}

export interface TelegramTransportConfig {
	token: string;
	users: ChannelUser[];
	instanceDir: string;
	ctx: ChannelContext;
	transcriptionConfig?: TranscriptionConfig;
}

// --- File download ---

export async function downloadTelegramFile(
	tg: TgApi,
	token: string,
	fileId: string,
	destPath: string,
): Promise<void> {
	const fileInfo = (await tg("getFile", { file_id: fileId })) as {
		file_path: string;
	};
	const url = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Failed to download file: ${res.status}`);
	const buffer = Buffer.from(await res.arrayBuffer());
	const dir = destPath.slice(0, destPath.lastIndexOf("/"));
	ensureDir(dir);
	writeFileSync(destPath, buffer);
}

// --- Offset management ---

function loadOffset(filePath: string): number | undefined {
	try {
		const data = JSON.parse(readFileSync(filePath, "utf-8"));
		return data.offset;
	} catch {
		return undefined;
	}
}

function saveOffset(filePath: string, offset: number): void {
	const dir = filePath.slice(0, filePath.lastIndexOf("/"));
	ensureDir(dir);
	writeFileSync(filePath, JSON.stringify({ offset }));
}

// --- User lookup ---

export function findUser(
	users: ChannelUser[],
	chatId: string,
): ChannelUser | undefined {
	return users.find((u) => u.chatId === chatId);
}

// --- Factory ---

export function createTelegramTransport(
	config: TelegramTransportConfig,
): ChannelTransport {
	const { token, users, instanceDir, ctx, transcriptionConfig } = config;
	const tg = createTgApi(token);
	const sessionManager = new SessionManager(instanceDir, "telegram");
	const chatHistory = new ChatHistory(instanceDir, "telegram");
	const offsetFile = join(instanceDir, "state", "telegram-offset.json");
	let offset = loadOffset(offsetFile);

	const sendCommand = `ASSISTANT_INSTANCE_DIR=${instanceDir} tsx ${resolve(import.meta.dirname ?? ".", "..", "telegram-cli.ts")} send`;

	async function sendReply(chatId: string, text: string): Promise<void> {
		const MAX_LEN = 4096;
		for (let i = 0; i < text.length; i += MAX_LEN) {
			await tg("sendMessage", {
				chat_id: chatId,
				text: text.slice(i, i + MAX_LEN),
			});
		}
	}

	async function sendTyping(chatId: string): Promise<void> {
		try {
			await tg("sendChatAction", { chat_id: chatId, action: "typing" });
		} catch {
			// Non-critical
		}
	}

	function attachmentDir(chatId: string): string {
		return join(instanceDir, "state", "attachments", chatId);
	}

	// Track chats with in-flight sessions for typing keepalive
	const pendingChats = new Set<string>();
	// Track pending input notifications per chat (for inline keyboard approvals)
	interface PendingInputInfo {
		inputKey: string;
		requestId: string;
		messageId: number;
		toolInfo: string;
	}
	const notifiedInputs = new Map<string, PendingInputInfo>();
	// Track chats that have already been warned about high context usage
	const contextWarned = new Set<string>();

	async function refreshTypingIndicators(): Promise<void> {
		for (const chatId of pendingChats) {
			const sessionId = sessionManager.get(chatId);
			if (!sessionId) {
				pendingChats.delete(chatId);
				notifiedInputs.delete(chatId);
				continue;
			}
			const result = await ctx.executor.poll(sessionId);
			if (result.status === "running") {
				await sendTyping(chatId);
				// Notify about pending permission prompts (once per prompt)
				if (result.pendingInput) {
					ctx.log(`Telegram: pendingInput=${JSON.stringify(result.pendingInput)}, hasRespondToInput=${!!ctx.executor.respondToInput}`);
					const inputKey = `${result.pendingInput.type}:${result.pendingInput.toolName ?? ""}`;
					const existing = notifiedInputs.get(chatId);
					if (existing?.inputKey !== inputKey) {
						const toolInfo = result.pendingInput.toolName ?? "Tool";
						const promptText = result.pendingInput.prompt
							? `\n${result.pendingInput.prompt.slice(0, 200)}`
							: "";

						// If executor supports respondToInput and we have a requestId, send inline keyboard
						if (ctx.executor.respondToInput && result.pendingInput.requestId) {
							const sent = (await tg("sendMessage", {
								chat_id: chatId,
								text: `🔧 ${toolInfo}${promptText}`,
								reply_markup: {
									inline_keyboard: [
										[
											{ text: "✓ Approve", callback_data: "approve" },
											{ text: "✗ Deny", callback_data: "deny" },
										],
									],
								},
							})) as { message_id: number };
							notifiedInputs.set(chatId, {
								inputKey,
								requestId: result.pendingInput.requestId,
								messageId: sent.message_id,
								toolInfo,
							});
						} else {
							// Fallback: text-only notification (CLI executor or missing requestId)
							await sendReply(
								chatId,
								`⏳ Waiting for approval (${toolInfo}) — open Yep Anywhere to respond, or /yolo to auto-approve.`,
							);
							notifiedInputs.set(chatId, {
								inputKey,
								requestId: "",
								messageId: 0,
								toolInfo,
							});
						}
					}
				} else {
					// No pending input — if we had a notified approval, it was resolved externally
					const existing = notifiedInputs.get(chatId);
					if (existing?.messageId) {
						try {
							await tg("editMessageText", {
								chat_id: chatId,
								message_id: existing.messageId,
								text: `✓ ${existing.toolInfo} — approved`,
							});
						} catch {
							// Message may already be edited or deleted
						}
						notifiedInputs.delete(chatId);
					}
				}
				// Warn once when context usage crosses 60%
				if (
					result.contextUsage &&
					result.contextUsage.percentage >= 60 &&
					!contextWarned.has(chatId)
				) {
					contextWarned.add(chatId);
					await sendReply(
						chatId,
						`Context at ${Math.round(result.contextUsage.percentage)}%. Quality may degrade — send /new to start a fresh session.`,
					);
				}
			} else {
				pendingChats.delete(chatId);
				notifiedInputs.delete(chatId);
				contextWarned.delete(chatId);
			}
		}
	}

	async function poll(): Promise<void> {
		// Refresh typing indicators for active sessions
		await refreshTypingIndicators();

		try {
			const updates = (await tg("getUpdates", {
				timeout: 0,
				limit: 10,
				...(offset !== undefined && { offset }),
			})) as TelegramUpdate[];

			for (const update of updates) {
				offset = update.update_id + 1;
				saveOffset(offsetFile, offset);

				// Handle inline keyboard button presses (tool approvals)
				if (update.callback_query) {
					const cb = update.callback_query;
					const cbChatId = cb.message?.chat.id
						? String(cb.message.chat.id)
						: undefined;
					const action = cb.data as "approve" | "deny" | undefined;

					try {
						if (cbChatId && action && ctx.executor.respondToInput) {
							const pending = notifiedInputs.get(cbChatId);
							const sessionId = sessionManager.get(cbChatId);

							if (pending?.requestId && sessionId) {
								const ok = await ctx.executor.respondToInput(
									sessionId,
									pending.requestId,
									action,
								);
								const label =
									action === "approve"
										? `✓ Approved: ${pending.toolInfo}`
										: `✗ Denied: ${pending.toolInfo}`;
								await tg("editMessageText", {
									chat_id: cbChatId,
									message_id: cb.message!.message_id,
									text: ok ? label : `⚠ ${label} (already handled)`,
								});
								notifiedInputs.delete(cbChatId);
							} else {
								// Stale button — no pending request
								await tg("editMessageText", {
									chat_id: cbChatId,
									message_id: cb.message!.message_id,
									text: "⚠ Already handled",
								});
							}
						}
						await tg("answerCallbackQuery", {
							callback_query_id: cb.id,
						});
					} catch (err) {
						ctx.log(
							`Telegram: callback_query error: ${(err as Error).message}`,
						);
						try {
							await tg("answerCallbackQuery", {
								callback_query_id: cb.id,
							});
						} catch {
							// Best effort
						}
					}
					continue;
				}

				const msg = update.message;
				if (!msg) continue;

				let msgText = msg.text ?? msg.caption ?? "";
				const hasPhoto = !!msg.photo?.length;
				const hasDocument = !!msg.document;
				const hasVoice = !!msg.voice;
				const hasAudio = !!msg.audio;

				if (!msgText && !hasPhoto && !hasDocument && !hasVoice && !hasAudio)
					continue;

				const chatIdStr = String(msg.chat.id);
				const user = findUser(users, chatIdStr);
				if (!user) {
					ctx.log(
						`Telegram: ignoring message from unauthorized chat ${chatIdStr}`,
					);
					continue;
				}

				if (msgText === "/start") continue;

				// Handle slash commands
				const cmdKey = msgText.trim().split(/\s/)[0].toLowerCase();
				const commands = createCommands();
				if (commands[cmdKey]) {
					await commands[cmdKey].handler({
						chatId: chatIdStr,
						user,
						sessionManager,
						pendingChats,
						contextWarned,
						ctx,
						sendReply,
					});
					continue;
				}

				const attachmentNote = hasPhoto
					? " [photo attached]"
					: hasDocument
						? ` [file: ${msg.document!.file_name ?? "document"}]`
						: hasVoice || hasAudio
							? " [audio message]"
							: "";
				ctx.log(
					`Telegram: message from ${user.name} (@${msg.from?.username ?? "unknown"}): ${(msgText || "(no text)").slice(0, 80)}${attachmentNote}`,
				);

				// Download attachments
				const attachments: string[] = [];
				const ts = new Date(msg.date * 1000)
					.toISOString()
					.replace(/[:.]/g, "-");
				const destDir = attachmentDir(chatIdStr);

				if (hasPhoto) {
					const photo = msg.photo![msg.photo!.length - 1];
					const dest = join(destDir, `${ts}-photo.jpg`);
					try {
						await downloadTelegramFile(tg, token, photo.file_id, dest);
						attachments.push(dest);
						ctx.log(`  Downloaded photo → ${dest}`);
					} catch (err) {
						ctx.log(
							`  Failed to download photo: ${(err as Error).message}`,
						);
					}
				}

				if (hasDocument) {
					const doc = msg.document!;
					const ext = doc.file_name?.split(".").pop() ?? "bin";
					const name = doc.file_name ?? `document.${ext}`;
					const dest = join(destDir, `${ts}-${name}`);
					try {
						await downloadTelegramFile(tg, token, doc.file_id, dest);
						attachments.push(dest);
						ctx.log(`  Downloaded document → ${dest}`);
					} catch (err) {
						ctx.log(
							`  Failed to download document: ${(err as Error).message}`,
						);
					}
				}

				if (hasVoice || hasAudio) {
					const fileId = hasVoice
						? msg.voice!.file_id
						: msg.audio!.file_id;
					const ext = hasVoice
						? "ogg"
						: (msg.audio!.file_name?.split(".").pop() ?? "ogg");
					const dest = join(destDir, `${ts}-voice.${ext}`);
					try {
						await downloadTelegramFile(tg, token, fileId, dest);
						ctx.log(`  Downloaded voice → ${dest}`);
						ctx.log("  Transcribing...");
						const transcription = await transcribeAudio(
							dest,
							transcriptionConfig ?? {},
							ctx.log,
						);
						ctx.log(`  Transcription: ${transcription.slice(0, 100)}`);
						const voicePrefix = `[voice message: "${transcription}"]`;
						msgText = msgText ? `${voicePrefix} ${msgText}` : voicePrefix;
					} catch (err) {
						ctx.log(
							`  Failed to process voice: ${(err as Error).message}`,
						);
						msgText = msgText || "[voice message — transcription failed]";
					}
				}

				// Record inbound message
				const fullText = msgText + attachmentNote;
				chatHistory.append({
					ts: new Date(msg.date * 1000).toISOString(),
					role: "user",
					name: user.name,
					chatId: user.chatId,
					text: fullText,
				});

				await sendTyping(chatIdStr);
				pendingChats.add(chatIdStr);

				try {
					const sessionEntry = sessionManager.getEntry(chatIdStr);
					await orchestrateSession({
						ctx,
						chatId: chatIdStr,
						user,
						messageText: fullText,
						attachments: attachments.length ? attachments : undefined,
						sessionManager,
						chatHistory,
						sendCommand: `${sendCommand} --to ${user.chatId} --message`,
						transportName: "telegram",
						sendReply,
						permissionMode: sessionEntry?.permissionMode,
					});
				} catch (err) {
					ctx.log(
						`  Telegram session error: ${(err as Error).message}`,
					);
				}

				ctx.appendActivity({
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
			ctx.log(`Telegram poll error: ${(err as Error).message}`);
		}
	}

	return {
		name: "telegram",
		enabled: !!(token && users.length > 0),
		poll,
	};
}
