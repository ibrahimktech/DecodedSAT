import { z } from "zod";
import { SUPABASE_URL } from "@/lib/env";

export const QUESTION_CONTENT_MAX_BLOCKS = 30;
export const QUESTION_TABLE_MAX_ROWS = 50;
export const QUESTION_TABLE_MAX_COLUMNS = 12;
export const QUESTION_ASSET_BUCKET = "question-assets";
export const QUESTION_ASSET_MAX_BYTES = 5 * 1024 * 1024;

export const QuestionImageSizeSchema = z.enum([
  "small",
  "medium",
  "large",
  "full",
]);

const blockId = z.uuid("Each content block needs a valid UUID.");
const storagePath = z
  .string()
  .regex(
    /^questions\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpg|webp)$/i,
    "Image paths must point to a question asset uploaded by DecodedSAT.",
  );

export const TextContentBlockSchema = z
  .object({
    id: blockId,
    type: z.literal("text"),
    content: z
      .string()
      .trim()
      .min(1, "Text blocks cannot be empty.")
      .max(8000, "Text blocks must be 8,000 characters or fewer."),
  })
  .strict();

export const CenteredMathContentBlockSchema = z
  .object({
    id: blockId,
    type: z.literal("centered_math"),
    content: z
      .string()
      .trim()
      .min(1, "Centered equations cannot be empty.")
      .max(4000, "Centered equations must be 4,000 characters or fewer."),
  })
  .strict();

export const ImageContentBlockSchema = z
  .object({
    id: blockId,
    type: z.literal("image"),
    storagePath,
    alt: z.string().trim().max(500).default(""),
    caption: z.string().trim().max(500).default(""),
    size: QuestionImageSizeSchema.default("medium"),
  })
  .strict();

const tableRow = z
  .array(z.string().max(1000, "Table cells must be 1,000 characters or fewer."))
  .min(1, "Tables need at least one column.")
  .max(QUESTION_TABLE_MAX_COLUMNS, `Tables support up to ${QUESTION_TABLE_MAX_COLUMNS} columns.`);

export const TableContentBlockSchema = z
  .object({
    id: blockId,
    type: z.literal("table"),
    header: z.boolean().default(true),
    rows: z
      .array(tableRow)
      .min(1, "Tables need at least one row.")
      .max(QUESTION_TABLE_MAX_ROWS, `Tables support up to ${QUESTION_TABLE_MAX_ROWS} rows.`),
  })
  .strict()
  .superRefine((table, context) => {
    const width = table.rows[0]?.length ?? 0;
    table.rows.forEach((row, rowIndex) => {
      if (row.length !== width) {
        context.addIssue({
          code: "custom",
          path: ["rows", rowIndex],
          message: "Every table row must have the same number of columns.",
        });
      }
    });
  });

export const QuestionContentBlockSchema = z.discriminatedUnion("type", [
  TextContentBlockSchema,
  CenteredMathContentBlockSchema,
  ImageContentBlockSchema,
  TableContentBlockSchema,
]);

export const QuestionContentBlocksSchema = z
  .array(QuestionContentBlockSchema)
  .min(1, "Add at least one question content block.")
  .max(
    QUESTION_CONTENT_MAX_BLOCKS,
    `Questions support up to ${QUESTION_CONTENT_MAX_BLOCKS} content blocks.`,
  )
  .superRefine((blocks, context) => {
    const seen = new Set<string>();
    blocks.forEach((block, index) => {
      if (seen.has(block.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "Content block IDs must be unique.",
        });
      }
      seen.add(block.id);
    });
  });

export type QuestionImageSize = z.infer<typeof QuestionImageSizeSchema>;
export type TextContentBlock = z.infer<typeof TextContentBlockSchema>;
export type CenteredMathContentBlock = z.infer<
  typeof CenteredMathContentBlockSchema
>;
export type ImageContentBlock = z.infer<typeof ImageContentBlockSchema>;
export type TableContentBlock = z.infer<typeof TableContentBlockSchema>;
export type QuestionContentBlock = z.infer<typeof QuestionContentBlockSchema>;

/** Strict persistence/runtime parsing. Invalid stored JSON falls back to prompt. */
export function parseQuestionContentBlocks(
  value: unknown,
): QuestionContentBlock[] | null {
  if (value === null || value === undefined) return null;
  const parsed = QuestionContentBlocksSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  console.error(
    `[question-content] invalid stored blocks at ${issue?.path.join(".") || "root"}: ${issue?.message || "unknown validation error"}`,
  );
  return null;
}

export function newQuestionBlockId(): string {
  return crypto.randomUUID();
}

export function legacyPromptToBlocks(prompt: string): QuestionContentBlock[] {
  return [
    {
      id: newQuestionBlockId(),
      type: "text",
      content: prompt,
    },
  ];
}

/** Centered blocks are raw LaTeX; tolerate an accidentally wrapped pair. */
export function normalizeCenteredMath(source: string): string {
  const trimmed = source.trim();
  if (trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length > 4) {
    return trimmed.slice(2, -2).trim();
  }
  if (trimmed.startsWith("$") && trimmed.endsWith("$") && trimmed.length > 2) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Keeps `prompt` useful to old deployments, search, analytics, and compact
 * summaries while `content_blocks` remains the authoritative rich body.
 */
export function contentBlocksToLegacyPrompt(
  blocks: readonly QuestionContentBlock[],
): string {
  const text = blocks
    .map((block) => {
      switch (block.type) {
        case "text":
          return block.content;
        case "centered_math":
          return `$${normalizeCenteredMath(block.content)}$`;
        case "image":
          return block.caption || block.alt || "[Question diagram]";
        case "table":
          return block.rows.map((row) => row.join(" | ")).join("\n");
      }
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return text || "Question content";
}

export function questionContentAssetPaths(
  blocks: readonly QuestionContentBlock[] | null | undefined,
): string[] {
  return (blocks ?? [])
    .filter((block): block is ImageContentBlock => block.type === "image")
    .map((block) => block.storagePath)
    .filter(Boolean);
}

export function getQuestionAssetUrl(storagePath: string): string {
  if (!SUPABASE_URL || !storagePath) return "";
  const encodedPath = storagePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${SUPABASE_URL}/storage/v1/object/public/${QUESTION_ASSET_BUCKET}/${encodedPath}`;
}
