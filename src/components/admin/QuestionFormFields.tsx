"use client";

import type { ReactNode } from "react";
import { MathText } from "@/components/app/MathText";
import type { Domain, Subtopic } from "@/lib/learn/types";
import {
  CHOICE_LETTERS,
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  type Difficulty,
} from "@/lib/learn/types";

export type QuestionDraft = {
  prompt: string;
  choices: string[];
  correctChoice: number;
  explanation: string;
  difficulty: Difficulty;
  domainId: string;
  subtopicId: string;
};

export type QuestionFieldErrors = Record<string, string>;

const FIELD_CLASS =
  "rounded-xl border border-hairline bg-surface px-3 py-2 text-[0.9375rem] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

function FieldError({ id, children }: { id: string; children?: string }) {
  if (!children) return null;
  return (
    <span id={id} className="text-sm font-medium text-miss-ink">
      {children}
    </span>
  );
}

function FormSection({
  title,
  description,
  compact,
  children,
  preview,
}: {
  title: string;
  description: string;
  compact: boolean;
  children: ReactNode;
  preview?: ReactNode;
}) {
  if (compact) {
    return (
      <section className="contents">
        <h3 className="sr-only">{title}</h3>
        {children}
      </section>
    );
  }

  return (
    <section className="grid gap-4 border-b border-hairline py-6 first:pt-0 last:border-b-0 last:pb-0 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.72fr)] lg:gap-6">
      <div className="min-w-0">
        <h2 className="font-display text-xl font-bold text-ink">{title}</h2>
        <p className="mt-1 text-sm text-muted">{description}</p>
        <div className="mt-4 flex flex-col gap-3">{children}</div>
      </div>
      {preview && (
        <aside
          aria-label={`${title} preview`}
          className="min-w-0 self-start rounded-xl border border-hairline bg-background p-4"
        >
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">
            Preview
          </p>
          {preview}
        </aside>
      )}
    </section>
  );
}

function PreviewText({ text, empty }: { text: string; empty: string }) {
  if (text.trim() === "") {
    return <p className="text-sm italic text-muted">{empty}</p>;
  }
  return (
    <MathText
      as="div"
      text={text}
      className="font-question whitespace-pre-wrap text-base leading-7 text-ink"
    />
  );
}

/** Shared question fields used by both manual creation and inline editing. */
export function QuestionFormFields({
  idPrefix,
  value,
  onChange,
  domains,
  subtopics,
  errors = {},
  compact = false,
}: {
  idPrefix: string;
  value: QuestionDraft;
  onChange: (value: QuestionDraft) => void;
  domains: Domain[];
  subtopics: Subtopic[];
  errors?: QuestionFieldErrors;
  compact?: boolean;
}) {
  const domainSubtopics = subtopics.filter(
    (subtopic) => subtopic.domainId === value.domainId,
  );

  const update = <Key extends keyof QuestionDraft>(
    key: Key,
    next: QuestionDraft[Key],
  ) => onChange({ ...value, [key]: next });

  return (
    <div className={compact ? "flex flex-col gap-3" : undefined}>
      <FormSection
        title="Question"
        description="Write the prompt exactly as students should see it. Use $...$ for inline LaTeX."
        compact={compact}
        preview={
          compact ? undefined : (
            <PreviewText text={value.prompt} empty="Question preview" />
          )
        }
      >
        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          Question content <span className="sr-only">(required)</span>
          <textarea
            id={`${idPrefix}-prompt`}
            value={value.prompt}
            onChange={(event) => update("prompt", event.target.value)}
            rows={compact ? 3 : 6}
            maxLength={4000}
            required
            autoFocus={!compact}
            aria-invalid={Boolean(errors.prompt)}
            aria-describedby={errors.prompt ? `${idPrefix}-prompt-error` : undefined}
            placeholder="Enter the SAT question. LaTeX such as $x^2$ is preserved."
            className={FIELD_CLASS}
          />
          <FieldError id={`${idPrefix}-prompt-error`}>{errors.prompt}</FieldError>
        </label>
      </FormSection>

      <FormSection
        title="Answers"
        description="DecodedSAT currently uses four-choice multiple choice. Select the correct answer beside its text."
        compact={compact}
        preview={
          compact ? undefined : (
            <ol className="flex flex-col gap-2">
              {CHOICE_LETTERS.map((letter, index) => (
                <li
                  key={letter}
                  className={`flex gap-2 rounded-lg px-2 py-1.5 font-question text-base leading-7 ${
                    value.correctChoice === index
                      ? "bg-accent-chip text-accent"
                      : "text-ink"
                  }`}
                >
                  <span className="font-bold">{letter}</span>
                  {value.choices[index]?.trim() ? (
                    <MathText text={value.choices[index]} />
                  ) : (
                    <span className="italic text-muted">Choice {letter}</span>
                  )}
                </li>
              ))}
            </ol>
          )
        }
      >
        <fieldset
          aria-describedby={errors.choices ? `${idPrefix}-choices-error` : undefined}
          className="grid gap-2 sm:grid-cols-2"
        >
          <legend className={compact ? "mb-1 text-sm font-medium text-muted" : "sr-only"}>
            Choices (select the correct one)
          </legend>
          {CHOICE_LETTERS.map((letter, index) => {
            const error = errors[`choices.${index}`];
            return (
              <label
                key={letter}
                className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-[0.9375rem] text-ink"
              >
                <input
                  type="radio"
                  name={`${idPrefix}-correct`}
                  checked={value.correctChoice === index}
                  onChange={() => update("correctChoice", index)}
                  aria-label={`Mark ${letter} as correct`}
                  aria-describedby={
                    errors.correctChoice
                      ? `${idPrefix}-correct-choice-error`
                      : undefined
                  }
                  className="accent-accent"
                />
                <span className="w-4 text-sm font-bold text-muted">{letter}</span>
                <input
                  type="text"
                  value={value.choices[index] ?? ""}
                  maxLength={1000}
                  required
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? `${idPrefix}-choice-${index}-error` : undefined}
                  placeholder={`Choice ${letter}`}
                  onChange={(event) => {
                    const choices = [...value.choices];
                    choices[index] = event.target.value;
                    update("choices", choices);
                  }}
                  className={`${FIELD_CLASS} w-full`}
                />
                <span className="col-span-2" />
                <FieldError id={`${idPrefix}-choice-${index}-error`}>
                  {error}
                </FieldError>
              </label>
            );
          })}
        </fieldset>
        <FieldError id={`${idPrefix}-choices-error`}>
          {errors.choices}
        </FieldError>
        <FieldError id={`${idPrefix}-correct-choice-error`}>
          {errors.correctChoice}
        </FieldError>
      </FormSection>

      <FormSection
        title="Classification"
        description="Choose a domain first, then the existing skill within that domain."
        compact={compact}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-muted">
            Domain
            <select
              value={value.domainId}
              onChange={(event) => {
                const domainId = event.target.value;
                const first = subtopics.find(
                  (subtopic) => subtopic.domainId === domainId,
                );
                onChange({
                  ...value,
                  domainId,
                  subtopicId: first?.id ?? "",
                });
              }}
              className={FIELD_CLASS}
            >
              {domains.length === 0 && <option value="">No domains available</option>}
              {domains.map((domain) => (
                <option key={domain.id} value={domain.id}>
                  {domain.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium text-muted">
            Skill / subtopic
            <select
              value={value.subtopicId}
              onChange={(event) => update("subtopicId", event.target.value)}
              disabled={domainSubtopics.length === 0}
              required
              aria-invalid={Boolean(errors.subtopicId)}
              aria-describedby={
                errors.subtopicId ? `${idPrefix}-subtopic-error` : undefined
              }
              className={FIELD_CLASS}
            >
              {domainSubtopics.length === 0 && (
                <option value="">No skills available</option>
              )}
              {domainSubtopics.map((subtopic) => (
                <option key={subtopic.id} value={subtopic.id}>
                  {subtopic.name}
                </option>
              ))}
            </select>
            <FieldError id={`${idPrefix}-subtopic-error`}>
              {errors.subtopicId}
            </FieldError>
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium text-muted">
            Difficulty
            <select
              value={value.difficulty}
              onChange={(event) =>
                update("difficulty", event.target.value as Difficulty)
              }
              className={FIELD_CLASS}
            >
              {DIFFICULTIES.map((difficulty) => (
                <option key={difficulty} value={difficulty}>
                  {DIFFICULTY_LABELS[difficulty]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </FormSection>

      <FormSection
        title="Explanation"
        description="Explain why the selected answer is correct. LaTeX is stored exactly as entered."
        compact={compact}
        preview={
          compact ? undefined : (
            <PreviewText text={value.explanation} empty="Explanation preview" />
          )
        }
      >
        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          Answer explanation <span className="sr-only">(required)</span>
          <textarea
            value={value.explanation}
            onChange={(event) => update("explanation", event.target.value)}
            rows={compact ? 3 : 5}
            maxLength={4000}
            required
            aria-invalid={Boolean(errors.explanation)}
            aria-describedby={
              errors.explanation ? `${idPrefix}-explanation-error` : undefined
            }
            placeholder="Show the reasoning students should use."
            className={FIELD_CLASS}
          />
          <FieldError id={`${idPrefix}-explanation-error`}>
            {errors.explanation}
          </FieldError>
        </label>
      </FormSection>
    </div>
  );
}
