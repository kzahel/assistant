import { z } from "zod";

// --- Act request schemas ---

export const ClickSchema = z.object({
	kind: z.literal("click"),
	ref: z.string(),
	doubleClick: z.boolean().optional(),
	button: z.enum(["left", "right", "middle"]).optional(),
	modifiers: z.array(z.enum(["Alt", "Control", "Meta", "Shift"])).optional(),
});

export const TypeSchema = z.object({
	kind: z.literal("type"),
	ref: z.string(),
	text: z.string(),
	submit: z.boolean().optional(),
	slowly: z.boolean().optional(),
});

export const PressSchema = z.object({
	kind: z.literal("press"),
	key: z.string(),
});

export const HoverSchema = z.object({
	kind: z.literal("hover"),
	ref: z.string(),
});

export const DragSchema = z.object({
	kind: z.literal("drag"),
	startRef: z.string(),
	endRef: z.string(),
});

export const SelectSchema = z.object({
	kind: z.literal("select"),
	ref: z.string(),
	values: z.array(z.string()),
});

export const FillFieldSchema = z.object({
	ref: z.string(),
	value: z.string(),
});

export const FillSchema = z.object({
	kind: z.literal("fill"),
	fields: z.array(FillFieldSchema),
});

export const EvaluateSchema = z.object({
	kind: z.literal("evaluate"),
	fn: z.string(),
	ref: z.string().optional(),
});

export const WaitSchema = z.object({
	kind: z.literal("wait"),
	timeMs: z.number().optional(),
	text: z.string().optional(),
	textGone: z.string().optional(),
	selector: z.string().optional(),
});

export const CloseSchema = z.object({
	kind: z.literal("close"),
});

export const ResizeSchema = z.object({
	kind: z.literal("resize"),
	width: z.number(),
	height: z.number(),
});

export const ActRequestSchema = z.discriminatedUnion("kind", [
	ClickSchema,
	TypeSchema,
	PressSchema,
	HoverSchema,
	DragSchema,
	SelectSchema,
	FillSchema,
	EvaluateSchema,
	WaitSchema,
	CloseSchema,
	ResizeSchema,
]);

export type ActRequest = z.infer<typeof ActRequestSchema>;

// --- Tab ---

export const TabSchema = z.object({
	targetId: z.string(),
	title: z.string(),
	url: z.string(),
});

export type Tab = z.infer<typeof TabSchema>;

// --- Snapshot options ---

export const SnapshotOptionsSchema = z.object({
	targetId: z.string().optional(),
	maxChars: z.number().optional(),
	efficient: z.boolean().optional(),
	selector: z.string().optional(),
});

export type SnapshotOptions = z.infer<typeof SnapshotOptionsSchema>;

// --- Server status ---

export const StatusSchema = z.object({
	running: z.boolean(),
	pid: z.number().nullable(),
	cdpPort: z.number(),
});

export type Status = z.infer<typeof StatusSchema>;

// --- Constants ---

export const DEFAULT_CDP_PORT = 51978;
export const DEFAULT_SERVER_PORT = 51979;
export const DEFAULT_SNAPSHOT_MAX_CHARS = 80_000;
export const DEFAULT_SNAPSHOT_EFFICIENT_MAX_CHARS = 12_000;
export const DEFAULT_ACTION_TIMEOUT_MS = 8_000;
export const DATA_DIR =
	process.env.BROWSER_CONTROL_DATA_DIR ??
	`${process.env.HOME}/.browser-control`;
