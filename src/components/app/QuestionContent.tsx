"use client";

import { useState } from "react";
import { DisplayMath, MathText } from "@/components/app/MathText";
import {
  getQuestionAssetUrl,
  normalizeCenteredMath,
  type ImageContentBlock,
  type QuestionContentBlock,
  type TableContentBlock,
} from "@/lib/questions/content";

type QuestionContentProps = {
  contentBlocks?: QuestionContentBlock[] | null;
  legacyText: string;
  className?: string;
  textClassName?: string;
};

const IMAGE_SIZE_CLASSES: Record<ImageContentBlock["size"], string> = {
  small: "max-w-64",
  medium: "max-w-sm",
  large: "max-w-xl",
  full: "w-full",
};

/**
 * The one question-body renderer used by student surfaces and admin previews.
 * Stored blocks never become cards: they read as one continuous SAT problem.
 */
export function QuestionContent({
  contentBlocks,
  legacyText,
  className = "",
  textClassName = "font-question text-lg leading-7 text-ink",
}: QuestionContentProps) {
  if (!contentBlocks || contentBlocks.length === 0) {
    return (
      <MathText
        as="p"
        text={legacyText}
        className={`${className} ${textClassName} whitespace-pre-line`}
      />
    );
  }

  return (
    <div className={`${className} min-w-0 space-y-4`}>
      {contentBlocks.map((block) => (
        <QuestionContentBlockView
          key={block.id}
          block={block}
          textClassName={textClassName}
        />
      ))}
    </div>
  );
}

function QuestionContentBlockView({
  block,
  textClassName,
}: {
  block: QuestionContentBlock;
  textClassName: string;
}) {
  switch (block.type) {
    case "text": {
      const paragraphs = block.content
        .split(/\n\s*\n/g)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);

      if (paragraphs.length === 0) return null;
      return (
        <div className="space-y-3">
          {paragraphs.map((paragraph, index) => (
            <MathText
              key={index}
              as="p"
              text={paragraph}
              className={`${textClassName} whitespace-pre-line`}
            />
          ))}
        </div>
      );
    }
    case "centered_math": {
      const source = normalizeCenteredMath(block.content);
      if (!source) return null;
      return (
        <div className="max-w-full overflow-x-auto py-1" role="group" aria-label="Centered equation">
          <DisplayMath
            source={source}
            className="mx-auto min-w-max px-1 text-center text-[1.08em]"
          />
        </div>
      );
    }
    case "image":
      return <QuestionImage key={block.storagePath} block={block} />;
    case "table":
      return <QuestionTable block={block} textClassName={textClassName} />;
  }
}

function QuestionImage({ block }: { block: ImageContentBlock }) {
  const [failed, setFailed] = useState(false);
  const src = getQuestionAssetUrl(block.storagePath);

  if (!src || failed) {
    return (
      <p role="img" aria-label={block.alt || "Question diagram unavailable"} className="text-center text-sm italic text-muted">
        Diagram unavailable
      </p>
    );
  }

  return (
    <figure className="mx-auto flex max-w-full flex-col items-center gap-2">
      {/* Natural dimensions preserve the source aspect ratio; figures never crop. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={block.alt}
        loading="lazy"
        decoding="async"
        className={`${IMAGE_SIZE_CLASSES[block.size]} h-auto max-w-full object-contain`}
        onError={() => {
          console.error(`[question-content] image failed to load: ${block.storagePath}`);
          setFailed(true);
        }}
      />
      {block.caption && (
        <figcaption className="max-w-xl text-center text-sm leading-relaxed text-muted">
          <MathText text={block.caption} />
        </figcaption>
      )}
    </figure>
  );
}

function QuestionTable({
  block,
  textClassName,
}: {
  block: TableContentBlock;
  textClassName: string;
}) {
  if (block.rows.length === 0 || block.rows[0]?.length === 0) return null;
  const bodyRows = block.header ? block.rows.slice(1) : block.rows;

  return (
    <div className="max-w-full overflow-x-auto py-1">
      <table className={`mx-auto border-collapse text-center ${textClassName}`}>
        {block.header && (
          <thead>
            <tr>
              {block.rows[0].map((cell, index) => (
                <th
                  key={index}
                  scope="col"
                  className="border border-hairline bg-background px-4 py-2 font-semibold"
                >
                  <MathText text={cell} />
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {bodyRows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, columnIndex) => (
                <td key={columnIndex} className="border border-hairline px-4 py-2">
                  <MathText text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
