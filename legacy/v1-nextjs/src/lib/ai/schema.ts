import { z } from "zod";

// ─── Shared primitives ────────────────────────────────────────────────────────

const Position2D = z.object({
  x: z.number(),
  y: z.number(),
});

const Position3D = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number().default(0),
});

const Position3DLike = z.preprocess((value) => {
  if (
    typeof value === "object" &&
    value !== null &&
    "x" in value &&
    "y" in value &&
    !("z" in value)
  ) {
    return { ...(value as Record<string, unknown>), z: 0 };
  }

  return value;
}, Position3D);

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$|^[a-z]+$/, {
  message: "Must be a hex color (#rrggbb) or CSS color name",
});

const Duration = z.number().positive().default(1);

const EasingType = z.enum([
  "linear",
  "easeIn",
  "easeOut",
  "easeInOut",
  "bounce",
  "elastic",
]);

// ─── Step schemas ─────────────────────────────────────────────────────────────

const CreateLatexStep = z.object({
  type: z.literal("create_latex"),
  id: z.string(),
  latex: z.string().min(1),
  position: Position3DLike,
  scale: z.number().positive().default(1),
  color: Color.default("#ffffff"),
  duration: Duration,
});

const CreateTextStep = z.object({
  type: z.literal("create_text"),
  id: z.string(),
  text: z.string().min(1),
  position: Position3DLike,
  fontSize: z.number().positive().default(24),
  color: Color.default("#ffffff"),
  fontWeight: z.enum(["normal", "bold"]).default("normal"),
  duration: Duration,
});

// Normalise common LLM shape aliases before enum validation
const SHAPE_ALIASES: Record<string, string> = {
  square: "rectangle",
  ellipse: "circle",
  oval: "circle",
  polygon: "triangle",
  parallelogram: "rectangle",
  rhombus: "rectangle",
  trapezoid: "rectangle",
  trapezium: "rectangle",
  pentagon: "triangle",
  hexagon: "triangle",
};

const ShapeType = z.preprocess(
  (val) =>
    typeof val === "string"
      ? (SHAPE_ALIASES[val.toLowerCase()] ?? val)
      : val,
  z.enum(["circle", "rectangle", "triangle", "line", "arrow"])
);

const CreateShapeStep = z.object({
  type: z.literal("create_shape"),
  id: z.string(),
  shape: ShapeType,
  position: Position3DLike,
  width: z.number().positive().default(100),
  height: z.number().positive().default(100),
  color: Color.default("#4f8ef7"),
  strokeColor: Color.default("#ffffff"),
  strokeWidth: z.number().nonnegative().default(0),
  opacity: z.number().min(0).max(1).default(1),
  duration: Duration,
});

const CreateAxesStep = z.object({
  type: z.literal("create_axes"),
  id: z.string(),
  position: Position3DLike,
  xRange: z.tuple([z.number(), z.number()]).default([-5, 5]),
  yRange: z.tuple([z.number(), z.number()]).default([-5, 5]),
  xLabel: z.string().default("x"),
  yLabel: z.string().default("y"),
  gridLines: z.boolean().default(true),
  color: Color.default("#888888"),
  duration: Duration,
});

const PlotFunctionStep = z.object({
  type: z.literal("plot_function"),
  id: z.string(),
  axesId: z.string(),
  expression: z
    .string()
    .min(1)
    .describe(
      "JavaScript-safe math expression using x as variable, e.g. 'Math.sin(x)' or 'x*x'"
    ),
  color: Color.default("#f7c948"),
  strokeWidth: z.number().positive().default(2),
  samples: z.number().int().positive().default(100),
  duration: Duration,
});

const CreateDotStep = z.object({
  type: z.literal("create_dot"),
  id: z.string(),
  position: Position3DLike,
  radius: z.number().positive().default(6),
  color: Color.default("#ff4f4f"),
  label: z.string().optional(),
  duration: Duration,
});

const TransformLatexStep = z.object({
  type: z.literal("transform_latex"),
  fromId: z.string(),
  toId: z.string(),
  toLaTeX: z.string().min(1),
  duration: Duration,
});

const HighlightStep = z.object({
  type: z.literal("highlight"),
  targetId: z.string(),
  color: Color.default("#f7c948"),
  pulses: z.number().int().positive().default(2),
  duration: Duration,
});

const MoveToStep = z.object({
  type: z.literal("move_to"),
  targetId: z.string(),
  position: Position3DLike,
  easing: EasingType.default("easeInOut"),
  duration: Duration,
});

const FadeOutStep = z.object({
  type: z.literal("fade_out"),
  targetId: z.string(),
  duration: Duration,
});

const CameraMoveStep = z.object({
  type: z.literal("camera_move"),
  position: Position3D,
  zoom: z.number().positive().default(1),
  easing: EasingType.default("easeInOut"),
  duration: Duration,
});

const WaitStep = z.object({
  type: z.literal("wait"),
  duration: Duration,
});

// ─── Discriminated union of all step types ────────────────────────────────────

export const DAODStep = z.discriminatedUnion("type", [
  CreateLatexStep,
  CreateTextStep,
  CreateShapeStep,
  CreateAxesStep,
  PlotFunctionStep,
  CreateDotStep,
  TransformLatexStep,
  HighlightStep,
  MoveToStep,
  FadeOutStep,
  CameraMoveStep,
  WaitStep,
]);

// ─── Top-level DAOD scene schema ──────────────────────────────────────────────

export const DAODSchema = z.object({
  version: z.literal("1.0").default("1.0"),
  title: z.string().min(1),
  topic: z.string().min(1),
  narration: z
    .array(z.string())
    .min(1)
    .describe(
      "One narration sentence per step — spoken aloud by the TTS system"
    ),
  steps: z.array(DAODStep).min(4).max(40),
});

// ─── TypeScript types ─────────────────────────────────────────────────────────

export type DAOD = z.infer<typeof DAODSchema>;
export type DAODStepType = z.infer<typeof DAODStep>;

// Individual step types for use in the rendering engine
export type CreateLatexStep = z.infer<typeof CreateLatexStep>;
export type CreateTextStep = z.infer<typeof CreateTextStep>;
export type CreateShapeStep = z.infer<typeof CreateShapeStep>;
export type CreateAxesStep = z.infer<typeof CreateAxesStep>;
export type PlotFunctionStep = z.infer<typeof PlotFunctionStep>;
export type CreateDotStep = z.infer<typeof CreateDotStep>;
export type TransformLatexStep = z.infer<typeof TransformLatexStep>;
export type HighlightStep = z.infer<typeof HighlightStep>;
export type MoveToStep = z.infer<typeof MoveToStep>;
export type FadeOutStep = z.infer<typeof FadeOutStep>;
export type CameraMoveStep = z.infer<typeof CameraMoveStep>;
export type WaitStep = z.infer<typeof WaitStep>;
