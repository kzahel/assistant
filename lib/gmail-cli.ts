#!/usr/bin/env tsx

/**
 * Gmail CLI — IMAP inbox reading and SMTP sending via Gmail app passwords.
 *
 * Usage:
 *   gmail inbox [--max-age 24h] [--limit 20] [--folder INBOX]
 *   gmail read <message-uid>
 *   gmail send --to <addr> --subject <subj> --body <text> [--html] [--body-file <path>]
 *
 * Requires GMAIL_APP_PASSWORD in the instance .env file.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ImapFlow } from "imapflow";
import { createTransport } from "nodemailer";

// --- Resolve instance dir (walk up from this file or use env) ---

const instanceDir =
	process.env.ASSISTANT_INSTANCE_DIR ??
	resolve(process.env.HOME!, "assistant-data/assistants/my-assistant");

// --- Load .env ---

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

const env = loadEnv(instanceDir);
const appPassword = env.GMAIL_APP_PASSWORD ?? process.env.GMAIL_APP_PASSWORD;
const account = env.GMAIL_ACCOUNT ?? process.env.GMAIL_ACCOUNT;

if (!account) {
	console.error("GMAIL_ACCOUNT not set. Add it to .env or export it.");
	process.exit(1);
}

if (!appPassword) {
	console.error("GMAIL_APP_PASSWORD not set. Add it to .env or export it.");
	process.exit(1);
}

// --- IMAP helpers ---

function getImapClient(): ImapFlow {
	return new ImapFlow({
		host: "imap.gmail.com",
		port: 993,
		secure: true,
		auth: { user: account, pass: appPassword },
		logger: false,
	});
}

function parseMaxAge(s: string): Date {
	const match = s.match(/^(\d+)\s*(h|d|m)$/);
	if (!match) throw new Error(`Invalid max-age: ${s}`);
	const n = Number(match[1]);
	const unit = match[2];
	const ms = unit === "h" ? n * 3600e3 : unit === "d" ? n * 86400e3 : n * 60e3;
	return new Date(Date.now() - ms);
}

// --- Commands ---

async function cmdInbox(args: string[]) {
	const { values } = parseArgs({
		args,
		options: {
			folder: { type: "string", default: "INBOX" },
			"max-age": { type: "string", default: "24h" },
			limit: { type: "string", default: "50" },
		},
		strict: false,
	});

	const since = parseMaxAge(values["max-age"] as string);
	const limit = Number(values.limit);
	const folder = values.folder as string;
	const client = getImapClient();

	try {
		await client.connect();
		const lock = await client.getMailboxLock(folder);
		try {
			const messages: string[] = [];
			let count = 0;

			for await (const msg of client.fetch(
				{ since },
				{ envelope: true, uid: true },
			)) {
				if (count >= limit) break;
				const e = msg.envelope;
				if (!e) continue;
				const from = e.from?.[0]?.address ?? "unknown";
				const date = e.date?.toISOString() ?? "unknown";
				messages.push(
					[
						`From: ${from}`,
						`Subject: ${e.subject ?? "(no subject)"}`,
						`Date: ${date}`,
						`UID: ${msg.uid}`,
					].join("\n"),
				);
				count++;
			}

			if (messages.length === 0) {
				console.log("No messages found.");
			} else {
				console.log(messages.join("\n---\n"));
			}
		} finally {
			lock.release();
		}
	} finally {
		await client.logout();
	}
}

async function cmdRead(args: string[]) {
	const uid = args[0];
	if (!uid) {
		console.error("Usage: gmail read <message-uid>");
		process.exit(1);
	}

	const client = getImapClient();

	try {
		await client.connect();
		const lock = await client.getMailboxLock("INBOX");
		try {
			const msg = await client.fetchOne(
				uid,
				{
					envelope: true,
					source: true,
				},
				{ uid: true },
			);

			if (!msg) {
				console.error(`Message UID ${uid} not found.`);
				process.exit(1);
			}

			const e = msg.envelope;
			if (e) {
				const from = e.from?.[0]?.address ?? "unknown";
				console.log(`From: ${from}`);
				console.log(`Subject: ${e.subject ?? "(no subject)"}`);
				console.log(`Date: ${e.date?.toISOString() ?? "unknown"}`);
				console.log(
					`To: ${e.to?.map((a: { address?: string }) => a.address).join(", ") ?? "unknown"}`,
				);
			}
			console.log("");

			// Parse body from raw source
			const source = msg.source?.toString("utf-8");
			if (source) {
				// Simple extraction: everything after the first blank line is body
				const bodyStart = source.indexOf("\r\n\r\n");
				if (bodyStart !== -1) {
					let body = source.slice(bodyStart + 4);
					// Trim to reasonable length
					if (body.length > 10000) {
						body = `${body.slice(0, 10000)}\n... (truncated)`;
					}
					console.log(body);
				}
			}
		} finally {
			lock.release();
		}
	} finally {
		await client.logout();
	}
}

async function cmdSend(args: string[]) {
	const { values } = parseArgs({
		args,
		options: {
			to: { type: "string" },
			subject: { type: "string" },
			body: { type: "string" },
			"body-file": { type: "string" },
			html: { type: "boolean", default: false },
		},
		strict: false,
	});

	if (!values.to || !values.subject) {
		console.error(
			"Usage: gmail send --to <addr> --subject <subj> --body <text>",
		);
		process.exit(1);
	}

	let bodyContent = values.body ?? "";
	if (values["body-file"]) {
		bodyContent = readFileSync(resolve(values["body-file"] as string), "utf-8");
	}

	if (!bodyContent) {
		console.error("No body provided. Use --body or --body-file.");
		process.exit(1);
	}

	const transport = createTransport({
		host: "smtp.gmail.com",
		port: 465,
		secure: true,
		auth: { user: account, pass: appPassword },
	});

	const mailOptions: Record<string, unknown> = {
		from: account,
		to: values.to,
		subject: values.subject,
	};

	if (values.html) {
		mailOptions.html = bodyContent;
	} else {
		mailOptions.text = bodyContent;
	}

	const info = await transport.sendMail(mailOptions);
	console.log(`Sent: ${info.messageId}`);
}

// --- Main ---

const [command, ...rest] = process.argv.slice(2);

switch (command) {
	case "inbox":
		await cmdInbox(rest);
		break;
	case "read":
		await cmdRead(rest);
		break;
	case "send":
		await cmdSend(rest);
		break;
	default:
		console.error("Usage: gmail <inbox|read|send> [options]");
		console.error("Commands:");
		console.error("  inbox [--max-age 24h] [--limit 50] [--folder INBOX]");
		console.error("  read <message-uid>");
		console.error(
			"  send --to <addr> --subject <subj> --body <text> [--html] [--body-file <path>]",
		);
		process.exit(1);
}
