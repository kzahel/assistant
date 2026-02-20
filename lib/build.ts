#!/usr/bin/env tsx

/**
 * Build script: compiles CLAUDE.md for an assistant instance.
 *
 * Reads the template, skill definitions, soul.md, config.yaml, and optional
 * projects.md, then assembles the final CLAUDE.md in the instance directory.
 *
 * Usage:
 *   tsx lib/build.ts --instance ~/assistant-data/assistants/my-assistant
 *   tsx lib/build.ts --instance ~/assistant-data/assistants/my-assistant --skills ~/code/assistant/skills
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import matter from "gray-matter";
import YAML from "yaml";

// --- CLI args ---

const { values } = parseArgs({
	options: {
		instance: { type: "string", short: "i" },
		skills: { type: "string", short: "s" },
		"engine-dir": { type: "string" },
	},
});

const engineDir = values["engine-dir"] ?? resolve(import.meta.dirname!, "..");
const skillsDir = values.skills ?? join(engineDir, "skills");
const instanceDir = values.instance;

if (!instanceDir) {
	console.error(
		"Usage: tsx lib/build.ts --instance <path-to-assistant-instance>",
	);
	process.exit(1);
}

const resolvedInstance = resolve(instanceDir.replace(/^~/, process.env.HOME!));
const resolvedSkills = resolve(skillsDir.replace(/^~/, process.env.HOME!));
const resolvedEngine = resolve(engineDir.replace(/^~/, process.env.HOME!));

// --- Read inputs ---

function readFile(path: string): string {
	const resolved = path.replace(/^~/, process.env.HOME!);
	return readFileSync(resolve(resolved), "utf-8");
}

function fileExists(path: string): boolean {
	return existsSync(resolve(path.replace(/^~/, process.env.HOME!)));
}

// Config
const configPath = join(resolvedInstance, "config.yaml");
if (!fileExists(configPath)) {
	console.error(`No config.yaml found at ${configPath}`);
	process.exit(1);
}
const config = YAML.parse(readFile(configPath)) as {
	name: string;
	skills?: Record<string, Record<string, unknown>>;
	schedules?: Array<{
		name: string;
		cron: string;
		skills: Array<{ skill: string }>;
	}>;
	projects?: Array<{ name: string; path: string; description: string }>;
};

// Soul
const soulPath = join(resolvedInstance, "soul.md");
const soul = fileExists(soulPath) ? readFile(soulPath) : "";

// Projects
const projectsPath = join(resolvedInstance, "projects.md");
const projects = fileExists(projectsPath) ? readFile(projectsPath) : "";

// User
const userPath = join(resolvedInstance, "user.md");
const user = fileExists(userPath) ? readFile(userPath) : "";

// Heart
const heartPath = join(resolvedInstance, "heart.md");
const heart = fileExists(heartPath) ? readFile(heartPath) : "";

// Learnings
const learningsPath = join(resolvedInstance, "memory", "learnings.md");
const learnings = fileExists(learningsPath) ? readFile(learningsPath) : "";

// Template
const templatePath = join(resolvedEngine, "templates", "claude.md");
const template = readFile(templatePath);

// --- Scan skills ---

interface SkillEntry {
	name: string;
	description: string;
	path: string;
	configured: boolean;
}

const skills: SkillEntry[] = [];
const configuredSkills = new Set(Object.keys(config.skills ?? {}));

if (existsSync(resolvedSkills)) {
	for (const entry of readdirSync(resolvedSkills, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const skillMdPath = join(resolvedSkills, entry.name, "SKILL.md");
		if (!existsSync(skillMdPath)) continue;

		const raw = readFileSync(skillMdPath, "utf-8");
		const { data } = matter(raw);

		if (!data.name || !data.description) {
			console.warn(
				`WARN: ${skillMdPath} missing name or description in frontmatter, skipping`,
			);
			continue;
		}

		skills.push({
			name: data.name as string,
			description: data.description as string,
			path: join(resolvedSkills, entry.name),
			configured: configuredSkills.has(data.name as string),
		});
	}
}

skills.sort((a, b) => a.name.localeCompare(b.name));

// Validate: every configured skill must exist
for (const name of configuredSkills) {
	if (!skills.find((s) => s.name === name)) {
		console.error(
			`ERROR: Skill "${name}" referenced in config.yaml but no SKILL.md found`,
		);
		process.exit(1);
	}
}

// Validate: every scheduled skill must be configured
for (const schedule of config.schedules ?? []) {
	for (const { skill } of schedule.skills) {
		if (!configuredSkills.has(skill)) {
			console.error(
				`ERROR: Schedule "${schedule.name}" references skill "${skill}" which is not in config.yaml skills`,
			);
			process.exit(1);
		}
	}
}

// --- Build skill index ---

function buildSkillIndex(): string {
	if (skills.length === 0) return "No skills available.\n";

	const lines = [
		"## Available Skills",
		"",
		"| Skill | Description | Configured | SKILL.md |",
		"|-------|-------------|:----------:|----------|",
	];

	for (const s of skills) {
		const check = s.configured ? "yes" : "no";
		lines.push(
			`| ${s.name} | ${s.description} | ${check} | ${s.path}/SKILL.md |`,
		);
	}

	lines.push("");
	lines.push(
		"**Before using a skill, read its SKILL.md for full instructions.**",
	);

	return lines.join("\n");
}

// --- Discover tools ---

interface ToolEntry {
	name: string;
	command: string;
}

function discoverTools(): ToolEntry[] {
	const libDir = join(resolvedEngine, "lib");
	const entries = readdirSync(libDir, { withFileTypes: true });
	const tools: ToolEntry[] = [];

	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const match = entry.name.match(/^(.+)-cli\.ts$/);
		if (!match) continue;
		tools.push({
			name: match[1],
			command: `tsx ${join(libDir, entry.name)}`,
		});
	}

	return tools.sort((a, b) => a.name.localeCompare(b.name));
}

const tools = discoverTools();

function buildToolPaths(): string {
	if (tools.length === 0) return "No tools found.\n";

	const lines = ["| Tool | Command |", "|------|---------|"];

	for (const tool of tools) {
		lines.push(`| ${tool.name} | \`${tool.command}\` |`);
	}

	return lines.join("\n");
}

// --- Assemble CLAUDE.md ---

function render(tmpl: string): string {
	let output = tmpl;

	// Simple partial replacements
	output = output.replace("{{name}}", config.name);
	output = output.replace("{{instance_dir}}", resolvedInstance);
	output = output.replace("{{> soul}}", soul.trim());
	output = output.replace("{{> user}}", user.trim() || "");
	output = output.replace("{{> heart}}", heart.trim() || "");
	output = output.replace(
		"{{> learnings}}",
		learnings.trim() || "No learnings recorded yet.",
	);
	output = output.replace("{{> skill_index}}", buildSkillIndex());
	output = output.replace("{{> tool_paths}}", buildToolPaths());

	// Conditional projects section
	if (projects.trim()) {
		output = output.replace("{{#if projects}}", "");
		output = output.replace("{{> projects}}", projects.trim());
		output = output.replace("{{else}}", "");
		output = output.replace(/No project references configured yet\./, "");
		output = output.replace("{{/if}}", "");
	} else {
		// Remove the "if projects" block, keep the else
		output = output.replace(/{{#if projects}}\n[\s\S]*?{{else}}\n/, "");
		output = output.replace("{{/if}}", "");
	}

	// Clean up any double blank lines
	output = output.replace(/\n{3,}/g, "\n\n");

	return output;
}

const claudeMd = render(template);

// --- Write output ---

const outputPath = join(resolvedInstance, "CLAUDE.md");
writeFileSync(outputPath, claudeMd, "utf-8");

console.log(`Built ${outputPath}`);
console.log(`  Skills: ${skills.map((s) => s.name).join(", ") || "(none)"}`);
console.log(`  Configured: ${[...configuredSkills].join(", ") || "(none)"}`);
console.log(`  Soul: ${soul ? "yes" : "no"}`);
console.log(`  Projects: ${projects ? "yes" : "no"}`);
console.log(`  Tools: ${tools.map((t) => t.name).join(", ") || "(none)"}`);
