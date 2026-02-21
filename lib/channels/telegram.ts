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
import { transcribeAudio, type TranscriptionConfig } from "../transcription.js";

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

	async function poll(): Promise<void> {
		try {
			const updates = (await tg("getUpdates", {
				timeout: 0,
				limit: 10,
				...(offset !== undefined && { offset }),
			})) as TelegramUpdate[];

			for (const update of updates) {
				offset = update.update_id + 1;
				saveOffset(offsetFile, offset);

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

				if (msgText.trim() === "/new") {
					sessionManager.clear(chatIdStr);
					ctx.log(`Telegram: session reset for ${user.name}`);
					await sendReply(
						chatIdStr,
						"Session reset. Next message starts fresh.",
					);
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

				try {
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
