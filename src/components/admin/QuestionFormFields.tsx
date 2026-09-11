"use client";

import type { ReactNode } from "react";
import { MathText } from "@/components/app/MathText";
import { QuestionContentEditor } from "@/components/admin/QuestionContentEditor";
import { SolutionVideoSelector } from "@/components/admin/SolutionVideoSelector";
import type { AdminVideoOption } from "@/lib/admin/types";
import type { Domain, Subtopic } from "@/lib/learn/types";
import {
  QUESTION_TYPE_LABELS,
  SPR_ANSWER_MODE_LABELS,
  type QuestionType,
  type SprAnswerMode,
} from "@/lib/questions/answers";
import {
  contentBlocksToLegacyPrompt,
  type QuestionContentBlock,
} from "@/lib/questions/content";
import {
  CHOICE_LETTERS,
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  type Difficulty,
} from "@/lib/learn/types";

export type QuestionDraft = {
  prompt: string;
  contentBlocks: QuestionContentBlock[];
  choices: string[];
  correctChoice: number | null;
  questionType: QuestionType;
  sprAnswerMode: SprAnswerMode | null;
  sprAnswers: string[];
  sprTolerance: string | null;
  explanation: string;
  difficulty: Difficulty;
  domainId: string;
  subtopicId: string;
  solutionVideoId: string | null;
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
  questionId,
  value,
  onChange,
  domains,
  subtopics,
  videos,
  errors = {},
  compact = false,
  persistedAssetPaths = [],
}: {
  idPrefix: string;
  questionId: string;
  value: QuestionDraft;
  onChange: (value: QuestionDraft) => void;
  domains: Domain[];
  subtopics: Subtopic[];
  videos: AdminVideoOption[];
  errors?: QuestionFieldErrors;
  compact?: boolean;
  persistedAssetPaths?: string[];
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
        title="Question Content"
        description="Build the question from text, centered equations, diagrams, and tables. Text keeps the existing $...$ inline LaTeX syntax."
        compact={compact}
      >
        <QuestionContentEditor
          questionId={questionId}
          blocks={value.contentBlocks}
          persistedAssetPaths={persistedAssetPaths}
          onChange={(contentBlocks) =>
            onChange({
              ...value,
              contentBlocks,
              prompt: contentBlocksToLegacyPrompt(contentBlocks).slice(0, 4000),
            })
          }
          error={
            errors.contentBlocks ??
            Object.entries(errors).find(([key]) =>
              key.startsWith("contentBlocks."),
            )?.[1] ??
            errors.prompt
          }
        />
      </FormSection>

      <FormSection
        title="Answers"
        description="Choose multiple choice or a numeric SAT-style student-produced response."
        compact={compact}
        preview={
          compact ? undefined : (
            value.questionType === "multiple_choice" ? (
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
            ) : (
              <div className="rounded-xl border border-hairline bg-surface p-3">
                <p className="text-xs font-semibold text-muted">
                  {value.sprAnswerMode
                    ? SPR_ANSWER_MODE_LABELS[value.sprAnswerMode]
                    : "Exact"}
                </p>
                <p className="mt-1 font-question text-lg text-ink">
                  {value.sprAnswers.filter((answer) => answer.trim()).join(" or ") ||
                    "Correct numeric answer"}
                </p>
                {value.sprAnswerMode === "tolerance" && value.sprTolerance && (
                  <p className="mt-1 text-sm text-muted">
                    Tolerance: ±{value.sprTolerance}
                  </p>
                )}
              </div>
            )
          )
        }
      >
        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          Question type
          <select
            value={value.questionType}
            onChange={(event) => {
              const questionType = event.target.value as QuestionType;
              onChange({
                ...value,
                questionType,
                choices:
                  questionType === "multiple_choice"
                    ? value.choices.length === 4
                      ? value.choices
                      : ["", "", "", ""]
                    : [],
                correctChoice:
                  questionType === "multiple_choice"
                    ? value.correctChoice ?? -1
                    : null,
                sprAnswerMode:
                  questionType === "student_produced_response"
                    ? value.sprAnswerMode ?? "exact"
                    : null,
                sprAnswers:
                  questionType === "student_produced_response"
                    ? value.sprAnswers.length > 0
                      ? value.sprAnswers
                      : [""]
                    : [],
                sprTolerance:
                  questionType === "student_produced_response" &&
                  value.sprAnswerMode === "tolerance"
                    ? value.sprTolerance ?? ""
                    : null,
              });
            }}
            className={FIELD_CLASS}
          >
            {Object.entries(QUESTION_TYPE_LABELS).map(([type, label]) => (
              <option key={type} value={type}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {value.questionType === "multiple_choice" ? (
          <>
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
                      aria-describedby={errors.correctChoice ? `${idPrefix}-correct-choice-error` : undefined}
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
            <FieldError id={`${idPrefix}-choices-error`}>{errors.choices}</FieldError>
            <FieldError id={`${idPrefix}-correct-choice-error`}>
              {errors.correctChoice}
            </FieldError>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-muted">
              Answer mode
              <select
                value={value.sprAnswerMode ?? "exact"}
                onChange={(event) => {
                  const sprAnswerMode = event.target.value as SprAnswerMode;
                  onChange({
                    ...value,
                    sprAnswerMode,
                    sprAnswers:
                      sprAnswerMode === "multiple"
                        ? value.sprAnswers.length >= 2
                          ? value.sprAnswers
                          : [value.sprAnswers[0] ?? "", ""]
                        : [value.sprAnswers[0] ?? ""],
                    sprTolerance:
                      sprAnswerMode === "tolerance"
                        ? value.sprTolerance ?? ""
                        : null,
                  });
                }}
                className={FIELD_CLASS}
              >
                {Object.entries(SPR_ANSWER_MODE_LABELS).map(([mode, label]) => (
                  <option key={mode} value={mode}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            {value.sprAnswers.map((answer, index) => (
              <label
                key={index}
                className="flex flex-col gap-1 text-sm font-medium text-muted"
              >
                {value.sprAnswerMode === "multiple"
                  ? `Accepted value ${index + 1}`
                  : "Correct numeric value"}
                <span className="flex gap-2">
                  <input
                    type="text"
                    inputMode="text"
                    value={answer}
                    maxLength={100}
                    required
                    placeholder="e.g. 3.5 or 7/2"
                    onChange={(event) => {
                      const sprAnswers = [...value.sprAnswers];
                      sprAnswers[index] = event.target.value;
                      update("sprAnswers", sprAnswers);
                    }}
                    aria-invalid={Boolean(errors[`sprAnswers.${index}`])}
                    className={`${FIELD_CLASS} min-w-0 flex-1 font-mono`}
                  />
                  {value.sprAnswerMode === "multiple" && value.sprAnswers.length > 2 && (
                    <button
                      type="button"
                      onClick={() =>
                        update(
                          "sprAnswers",
                          value.sprAnswers.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                      className="rounded-xl border border-hairline px-3 text-sm font-semibold text-muted hover:bg-background"
                    >
                      Remove
                    </button>
                  )}
                </span>
                <FieldError id={`${idPrefix}-spr-answer-${index}-error`}>
                  {errors[`sprAnswers.${index}`]}
                </FieldError>
              </label>
            ))}
            <FieldError id={`${idPrefix}-spr-answers-error`}>
              {errors.sprAnswers}
            </FieldError>

            {value.sprAnswerMode === "multiple" && value.sprAnswers.length < 10 && (
              <button
                type="button"
                onClick={() => update("sprAnswers", [...value.sprAnswers, ""])}
                className="self-start rounded-xl border border-hairline px-3 py-2 text-sm font-semibold text-ink hover:bg-background"
              >
                Add accepted value
              </button>
            )}

            {value.sprAnswerMode === "tolerance" && (
              <label className="flex flex-col gap-1 text-sm font-medium text-muted">
                Tolerance
                <input
                  type="text"
                  inputMode="text"
                  value={value.sprTolerance ?? ""}
                  maxLength={100}
                  required
                  placeholder="e.g. 0.005"
                  onChange={(event) => update("sprTolerance", event.target.value)}
                  aria-invalid={Boolean(errors.sprTolerance)}
                  className={`${FIELD_CLASS} font-mono`}
                />
                <span className="text-xs font-normal leading-relaxed">
                  Answers are correct when their exact numeric distance from the
                  correct value is no greater than this amount.
                </span>
                <FieldError id={`${idPrefix}-spr-tolerance-error`}>
                  {errors.sprTolerance}
                </FieldError>
              </label>
            )}
          </div>
        )}
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
            Skill
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
        title="Solution video"
        description="Optionally connect this question to its exact video walkthrough."
        compact={compact}
      >
        <SolutionVideoSelector
          idPrefix={idPrefix}
          videos={videos}
          selectedId={value.solutionVideoId}
          error={errors.solutionVideoId}
          onChange={(solutionVideoId) =>
            update("solutionVideoId", solutionVideoId)
          }
        />
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
