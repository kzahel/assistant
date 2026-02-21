/**
 * SessionExecutor abstraction — decouples the scheduler/channel system
 * from any specific way of running Claude Code sessions.
 *
 * Two implementations:
 *   - Yep Anywhere (HTTP API to local YA server)
 *   - Claude CLI (spawns `claude -p` as a child process)
 */

import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

// --- Interface ---

export interface StartResult {
	sessionId: string;
	status: "started" | "queued";
}

export type PermissionMode = "bypassPermissions" | "default" | "plan";

/**
 * Fine-grained permission rules for bash commands.
 * Patterns use glob syntax matched against the full command string.
 * Evaluation order: deny (highest) → allow → permissionMode fallback.
 * In "default" mode, unmatched commands prompt for approval (timeout in unattended sessions).
 */
export interface PermissionRules {
	allow?: string[];
	deny?: string[];
}

export interface PollResult {
	status: "running" | "done" | "error";
	/** Set when session is waiting for user approval (e.g. tool permission) */
	pendingInput?: {
		type: string;
		toolName?: string;
		/** Unique ID for this input request (needed to respond via API) */
		requestId?: string;
		/** Human-readable description of what's being requested */
		prompt?: string;
	};
	/** Context window usage (when available from executor) */
	contextUsage?: { percentage: number };
}

export interface SessionStartOpts {
	cwd?: string;
	permissionMode?: PermissionMode;
	permissions?: PermissionRules;
}

export interface SessionResumeOpts {
	permissionMode?: PermissionMode;
	permissions?: PermissionRules;
}

export interface SessionExecutor {
	readonly name: string;
	start(
		message: string,
		opts?: SessionStartOpts,
	): Promise<StartResult>;
	resume(
		sessionId: string,
		message: string,
		opts?: SessionResumeOpts,
	): Promise<boolean>;
	poll(sessionId: string): Promise<PollResult>;
	cleanup(sessionId: string): void | Promise<void>;
	/** Respond to a pending input request (tool approval). Optional — only some executors support this. */
	respondToInput?(
		sessionId: string,
		requestId: string,
		response: "approve" | "deny",
		feedback?: string,
	): Promise<boolean>;
}

// --- Yep Anywhere executor ---

export interface YepAnywhereExecutorConfig {
	baseUrl: string;
	projectId: string;
}

export function createYepAnywhereExecutor(
	config: YepAnywhereExecutorConfig,
): SessionExecutor {
	const { baseUrl, projectId } = config;
	const sessionsUrl = `${baseUrl}/api/projects/${projectId}/sessions`;
	const headers = {
		"Content-Type": "application/json",
		"X-Yep-Anywhere": "true",
	};

	return {
		name: "yep-anywhere",

		async start(message, opts) {
			const mode = opts?.permissionMode ?? "bypassPermissions";
			const payload: Record<string, unknown> = { message, mode };
			if (opts?.permissions) payload.permissions = opts.permissions;
			const res = await fetch(sessionsUrl, {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
			});

			if (res.status === 200) {
				const data = (await res.json()) as {
					sessionId: string;
					processId: string;
				};
				return { sessionId: data.sessionId, status: "started" };
			}

			if (res.status === 202) {
				const data = (await res.json()) as {
					queueId: string;
					position: number;
				};
				return { sessionId: data.queueId, status: "queued" };
			}

			const body = await res.text();
			throw new Error(`YA start failed (${res.status}): ${body}`);
		},

		async resume(sessionId, message, opts) {
			const mode = opts?.permissionMode ?? "bypassPermissions";
			const payload: Record<string, unknown> = { message, mode };
			if (opts?.permissions) payload.permissions = opts.permissions;
			const res = await fetch(`${sessionsUrl}/${sessionId}/resume`, {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
			});
			return res.status === 200;
		},

		async poll(sessionId) {
			try {
				const res = await fetch(`${sessionsUrl}/${sessionId}/metadata`, {
					headers: { "X-Yep-Anywhere": "true" },
				});
				if (!res.ok) return { status: "error" };
				const data = (await res.json()) as {
					ownership: { owner: string; state?: string };
					pendingInputRequest?: {
						id: string;
						type: string;
						toolName?: string;
						prompt?: string;
					};
					session?: {
						contextUsage?: { percentage: number };
					};
				};
				const contextUsage =
					data.session?.contextUsage?.percentage != null
						? { percentage: data.session.contextUsage.percentage }
						: undefined;
				if (data.ownership.owner === "none") return { status: "done", contextUsage };
				if (data.ownership.state === "idle") return { status: "done", contextUsage };
				if (data.ownership.state === "waiting-input" && data.pendingInputRequest) {
					return {
						status: "running",
						contextUsage,
						pendingInput: {
							type: data.pendingInputRequest.type,
							toolName: data.pendingInputRequest.toolName,
							requestId: data.pendingInputRequest.id,
							prompt: data.pendingInputRequest.prompt,
						},
					};
				}
				return { status: "running", contextUsage };
			} catch {
				return { status: "error" };
			}
		},

		async respondToInput(sessionId, requestId, response, feedback) {
			try {
				const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/input`, {
					method: "POST",
					headers,
					body: JSON.stringify({ requestId, response, feedback }),
				});
				if (!res.ok) return false;
				const data = (await res.json()) as { accepted?: boolean };
				return data.accepted === true;
			} catch {
				return false;
			}
		},

		async cleanup(sessionId) {
			try {
				const res = await fetch(`${sessionsUrl}/${sessionId}/metadata`, {
					headers: { "X-Yep-Anywhere": "true" },
				});
				if (!res.ok) return;
				const data = (await res.json()) as {
					ownership: { owner: string; processId?: string };
				};
				if (data.ownership.owner === "self" && data.ownership.processId) {
					await fetch(
						`${baseUrl}/api/processes/${data.ownership.processId}/abort`,
						{ method: "POST", headers },
					);
				}
			} catch {
				// Best-effort
			}
		},
	};
}

// --- Claude CLI executor ---

export interface ClaudeCliExecutorConfig {
	cwd: string;
	permissionMode?: string;
	model?: string;
}

interface TrackedProcess {
	process: ChildProcess;
	exitCode: number | null;
	error?: string;
}

export function createClaudeCliExecutor(
	config: ClaudeCliExecutorConfig,
): SessionExecutor {
	const processes = new Map<string, TrackedProcess>();

	function spawnClaude(
		args: string[],
		message: string,
		cwd: string,
		permissionMode?: PermissionMode,
	): ChildProcess {
		const fullArgs = [
			"-p",
			"--permission-mode",
			permissionMode ?? config.permissionMode ?? "bypassPermissions",
			...(config.model ? ["--model", config.model] : []),
			...args,
		];

		const child = spawn("claude", fullArgs, {
			cwd,
			stdio: ["pipe", "ignore", "pipe"],
		});

		child.stdin!.write(message);
		child.stdin!.end();

		return child;
	}

	function track(sessionId: string, child: ChildProcess): void {
		const entry: TrackedProcess = { process: child, exitCode: null };
		processes.set(sessionId, entry);

		child.on("exit", (code) => {
			entry.exitCode = code ?? 1;
		});

		child.on("error", (err) => {
			entry.exitCode = 1;
			entry.error = err.message;
		});

		// Drain stderr so the pipe buffer doesn't fill.
		child.stderr?.resume();
	}

	return {
		name: "claude-cli",

		async start(message, opts) {
			const sessionId = randomUUID();
			const cwd = opts?.cwd ?? config.cwd;
			const child = spawnClaude(
				["--session-id", sessionId],
				message,
				cwd,
				opts?.permissionMode,
			);
			track(sessionId, child);
			return { sessionId, status: "started" };
		},

		async resume(sessionId, message, opts) {
			const existing = processes.get(sessionId);
			if (existing && existing.exitCode === null) {
				// Previous session still running — can't resume.
				return false;
			}
			const child = spawnClaude(
				["--resume", sessionId],
				message,
				config.cwd,
				opts?.permissionMode,
			);
			track(sessionId, child);
			return true;
		},

		async poll(sessionId) {
			const entry = processes.get(sessionId);
			if (!entry) return { status: "error" };
			if (entry.exitCode === null) return { status: "running" };
			return { status: entry.exitCode === 0 ? "done" : "error" };
		},

		cleanup(sessionId) {
			const entry = processes.get(sessionId);
			if (entry) {
				if (entry.exitCode === null) {
					entry.process.kill("SIGTERM");
				}
				processes.delete(sessionId);
			}
		},
	};
}
