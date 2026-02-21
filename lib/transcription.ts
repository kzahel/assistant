/**
 * Audio transcription with pluggable backends (Groq, OpenAI, local WhisperX).
 */

import { readFileSync } from "node:fs";

export interface TranscriptionConfig {
	backend?: string; // "groq" | "openai" | "local" | "auto"
	pythonPath?: string;
	groqApiKey?: string;
	openaiApiKey?: string;
}

async function transcribeViaGroq(audioPath: string, apiKey: string): Promise<string> {
	const audioData = readFileSync(audioPath);
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

async function transcribeViaOpenAI(audioPath: string, apiKey: string): Promise<string> {
	const audioData = readFileSync(audioPath);
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

/** Try transcription backends in priority order. Returns transcribed text or failure message. */
export async function transcribeAudio(
	audioPath: string,
	config: TranscriptionConfig,
	log?: (msg: string) => void,
): Promise<string> {
	const backend = config.backend ?? "auto";

	const backends: Array<{ name: string; fn: () => Promise<string> }> = [];

	if (backend === "groq" || backend === "auto") {
		const apiKey = config.groqApiKey;
		if (apiKey) {
			backends.push({ name: "groq", fn: () => transcribeViaGroq(audioPath, apiKey) });
		}
	}
	if (backend === "openai" || backend === "auto") {
		const apiKey = config.openaiApiKey;
		if (apiKey) {
			backends.push({ name: "openai", fn: () => transcribeViaOpenAI(audioPath, apiKey) });
		}
	}
	if (backend === "local" || backend === "auto") {
		const pythonPath = config.pythonPath;
		if (pythonPath) {
			backends.push({ name: "local", fn: () => transcribeViaLocal(audioPath, pythonPath) });
		}
	}

	// If explicit backend, just try that one
	if (backend !== "auto" && backends.length === 1) {
		try {
			return await backends[0].fn();
		} catch (err) {
			log?.(`  Transcription (${backend}) failed: ${(err as Error).message}`);
			return "(transcription failed)";
		}
	}

	// Auto: try each backend in order
	for (const b of backends) {
		try {
			const text = await b.fn();
			log?.(`  Transcribed via ${b.name}`);
			return text;
		} catch (err) {
			log?.(`  Transcription (${b.name}) failed: ${(err as Error).message}`);
		}
	}

	return "(transcription failed — no backend available)";
}
