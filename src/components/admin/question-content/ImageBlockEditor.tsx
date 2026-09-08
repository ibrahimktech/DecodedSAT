"use client";

import {
  QUESTION_ASSET_MAX_BYTES,
  getQuestionAssetUrl,
  type ImageContentBlock,
  type QuestionImageSize,
} from "@/lib/questions/content";

const FIELD_CLASS =
  "rounded-lg border border-hairline bg-surface px-3 py-2 text-[0.9375rem] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

export function ImageBlockEditor({
  block,
  uploading,
  error,
  onChange,
  onUpload,
}: {
  block: ImageContentBlock;
  uploading: boolean;
  error?: string;
  onChange: (block: ImageContentBlock) => void;
  onUpload: (file: File) => void;
}) {
  const src = getQuestionAssetUrl(block.storagePath);
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <div className="flex min-h-32 items-center justify-center rounded-lg border border-hairline bg-surface p-3">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="max-h-52 max-w-full object-contain" />
        ) : (
          <p className="text-center text-sm text-muted">No image uploaded</p>
        )}
      </div>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          {block.storagePath ? "Replace image" : "Upload image"}
          <input
            type="file"
            accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUpload(file);
              event.target.value = "";
            }}
            className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-hairline file:bg-surface file:px-3 file:py-2 file:font-semibold file:text-ink"
          />
          <span className="text-xs font-normal">
            PNG, JPG, or WebP · up to {QUESTION_ASSET_MAX_BYTES / 1024 / 1024} MB
          </span>
        </label>
        {uploading && <p className="text-sm font-medium text-accent">Uploading…</p>}
        {error && <p role="alert" className="text-sm font-medium text-miss-ink">{error}</p>}
        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          Alt text <span className="font-normal">(recommended)</span>
          <input
            value={block.alt}
            onChange={(event) => onChange({ ...block, alt: event.target.value })}
            maxLength={500}
            placeholder="Right triangle ABC with altitude CD perpendicular to AB."
            className={FIELD_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          Caption <span className="font-normal">(optional)</span>
          <input
            value={block.caption}
            onChange={(event) => onChange({ ...block, caption: event.target.value })}
            maxLength={500}
            className={FIELD_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          Size
          <select
            value={block.size}
            onChange={(event) =>
              onChange({ ...block, size: event.target.value as QuestionImageSize })
            }
            className={FIELD_CLASS}
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
            <option value="full">Full width</option>
          </select>
        </label>
      </div>
    </div>
  );
}
