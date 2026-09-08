"use client";

import { useEffect, useRef, useState } from "react";
import {
  deleteQuestionAssetAction,
  uploadQuestionAssetAction,
} from "@/app/admin/questions/actions";
import { DisplayMath } from "@/components/app/MathText";
import { QuestionContent } from "@/components/app/QuestionContent";
import { ImageBlockEditor } from "@/components/admin/question-content/ImageBlockEditor";
import { TableBlockEditor } from "@/components/admin/question-content/TableBlockEditor";
import {
  QUESTION_CONTENT_MAX_BLOCKS,
  contentBlocksToLegacyPrompt,
  newQuestionBlockId,
  normalizeCenteredMath,
  type ImageContentBlock,
  type QuestionContentBlock,
} from "@/lib/questions/content";

const FIELD_CLASS =
  "rounded-lg border border-hairline bg-surface px-3 py-2 text-[0.9375rem] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

type BlockKind = QuestionContentBlock["type"];

const BLOCK_LABELS: Record<BlockKind, string> = {
  text: "Text",
  centered_math: "Centered equation",
  image: "Image / Diagram",
  table: "Table",
};

export function QuestionContentEditor({
  questionId,
  blocks,
  onChange,
  persistedAssetPaths = [],
  error,
}: {
  questionId: string;
  blocks: QuestionContentBlock[];
  onChange: (blocks: QuestionContentBlock[]) => void;
  persistedAssetPaths?: string[];
  error?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  const blocksRef = useRef(blocks);
  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);
  const persisted = new Set(persistedAssetPaths);

  const replace = (index: number, block: QuestionContentBlock) => {
    const current = blocksRef.current;
    const currentIndex = current.findIndex((entry) => entry.id === block.id);
    const target = currentIndex === -1 ? index : currentIndex;
    const next = [...current];
    next[target] = block;
    onChange(next);
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const remove = (index: number) => {
    const block = blocks[index];
    if (
      block?.type === "image" &&
      block.storagePath &&
      !persisted.has(block.storagePath)
    ) {
      void deleteQuestionAssetAction({
        questionId,
        storagePath: block.storagePath,
      });
    }
    onChange(blocks.filter((_, blockIndex) => blockIndex !== index));
  };

  const add = (type: BlockKind) => {
    let block: QuestionContentBlock;
    const id = newQuestionBlockId();
    switch (type) {
      case "text":
        block = { id, type, content: "" };
        break;
      case "centered_math":
        block = { id, type, content: "" };
        break;
      case "image":
        block = {
          id,
          type,
          storagePath: "",
          alt: "",
          caption: "",
          size: "medium",
        };
        break;
      case "table":
        block = {
          id,
          type,
          header: true,
          rows: [
            ["Column 1", "Column 2"],
            ["", ""],
          ],
        };
        break;
    }
    onChange([...blocks, block]);
    setAdding(false);
  };

  const upload = async (index: number, block: ImageContentBlock, file: File) => {
    setUploading((current) => ({ ...current, [block.id]: true }));
    setUploadErrors((current) => ({ ...current, [block.id]: "" }));
    const formData = new FormData();
    formData.set("questionId", questionId);
    formData.set("file", file);

    try {
      const result = await uploadQuestionAssetAction(formData);
      if (result.status !== "ok") {
        setUploadErrors((current) => ({
          ...current,
          [block.id]: result.message,
        }));
        return;
      }

      const currentBlock = blocksRef.current.find(
        (entry) => entry.id === block.id,
      );
      if (!currentBlock || currentBlock.type !== "image") return;
      const previousPath = currentBlock.storagePath;
      replace(index, { ...currentBlock, storagePath: result.storagePath });
      if (previousPath && !persisted.has(previousPath)) {
        void deleteQuestionAssetAction({
          questionId,
          storagePath: previousPath,
        });
      }
    } catch {
      setUploadErrors((current) => ({
        ...current,
        [block.id]: "The image could not be uploaded. Try again.",
      }));
    } finally {
      setUploading((current) => ({ ...current, [block.id]: false }));
    }
  };

  return (
    <div>
      <div className="flex flex-col gap-3">
        {blocks.map((block, index) => (
          <section
            key={block.id}
            className="rounded-xl border border-hairline bg-background p-3"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted">
                {BLOCK_LABELS[block.type]}
              </h3>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${BLOCK_LABELS[block.type]} block up`}
                  className="rounded-md px-2 py-1 text-sm font-semibold text-muted hover:bg-surface hover:text-ink disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === blocks.length - 1}
                  aria-label={`Move ${BLOCK_LABELS[block.type]} block down`}
                  className="rounded-md px-2 py-1 text-sm font-semibold text-muted hover:bg-surface hover:text-ink disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  aria-label={`Delete ${BLOCK_LABELS[block.type]} block`}
                  className="rounded-md px-2 py-1 text-sm font-semibold text-muted hover:bg-miss-surface hover:text-miss-ink"
                >
                  ×
                </button>
              </div>
            </div>

            {block.type === "text" && (
              <label className="flex flex-col gap-1 text-sm font-medium text-muted">
                Text
                <textarea
                  value={block.content}
                  onChange={(event) =>
                    replace(index, { ...block, content: event.target.value })
                  }
                  rows={4}
                  maxLength={8000}
                  placeholder="Write normal text and use $...$ for inline LaTeX."
                  className={FIELD_CLASS}
                />
              </label>
            )}

            {block.type === "centered_math" && (
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.75fr)]">
                <label className="flex flex-col gap-1 text-sm font-medium text-muted">
                  Raw LaTeX (no dollar signs)
                  <textarea
                    value={block.content}
                    onChange={(event) =>
                      replace(index, { ...block, content: event.target.value })
                    }
                    onBlur={() =>
                      replace(index, {
                        ...block,
                        content: normalizeCenteredMath(block.content),
                      })
                    }
                    rows={3}
                    maxLength={4000}
                    spellCheck={false}
                    placeholder="\\frac{x+4}{3}=8"
                    className={`${FIELD_CLASS} font-mono`}
                  />
                </label>
                <div className="min-w-0 overflow-x-auto rounded-lg border border-hairline bg-surface p-3">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
                    Preview
                  </p>
                  {normalizeCenteredMath(block.content) ? (
                    <DisplayMath
                      source={normalizeCenteredMath(block.content)}
                      className="min-w-max text-center"
                    />
                  ) : (
                    <p className="text-sm italic text-muted">Equation preview</p>
                  )}
                </div>
              </div>
            )}

            {block.type === "image" && (
              <ImageBlockEditor
                block={block}
                uploading={uploading[block.id] === true}
                error={uploadErrors[block.id]}
                onChange={(next) => replace(index, next)}
                onUpload={(file) => void upload(index, block, file)}
              />
            )}

            {block.type === "table" && (
              <TableBlockEditor
                block={block}
                onChange={(next) => replace(index, next)}
              />
            )}
          </section>
        ))}
      </div>

      {error && <p className="mt-2 text-sm font-medium text-miss-ink">{error}</p>}

      <div className="mt-3">
        {adding ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Choose content type">
            {(Object.keys(BLOCK_LABELS) as BlockKind[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => add(type)}
                className="rounded-lg border border-hairline bg-surface px-3 py-2 text-sm font-semibold text-ink hover:border-accent"
              >
                {BLOCK_LABELS[type]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="px-2 py-2 text-sm font-semibold text-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={blocks.length >= QUESTION_CONTENT_MAX_BLOCKS}
            className="rounded-lg border border-hairline bg-surface px-3 py-2 text-sm font-semibold text-ink hover:border-accent disabled:opacity-50"
          >
            + Add content
          </button>
        )}
      </div>

      <aside className="mt-5 min-w-0 rounded-xl border border-hairline bg-surface p-4" aria-label="Student preview">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">
          Student Preview
        </p>
        {blocks.length > 0 ? (
          <QuestionContent
            contentBlocks={blocks}
            legacyText={contentBlocksToLegacyPrompt(blocks)}
          />
        ) : (
          <p className="text-sm italic text-muted">Add question content to preview it.</p>
        )}
      </aside>
    </div>
  );
}
