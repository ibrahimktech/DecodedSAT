import { MathText } from "@/components/app/MathText";
import { CHOICE_LETTERS } from "@/lib/learn/types";
import type { QuestionType } from "@/lib/questions/answers";

export function QuestionAnswerReview({
  questionType,
  choices,
  selectedAnswer,
  selectedChoice,
  correctChoice,
  correctAnswers,
  correctAnswerTolerance,
}: {
  questionType: QuestionType;
  choices: string[];
  selectedAnswer: string | null;
  selectedChoice: number | null;
  correctChoice: number | null;
  correctAnswers: string[];
  correctAnswerTolerance: string | null;
}) {
  if (questionType === "student_produced_response") {
    return (
      <dl className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-hairline bg-background px-4 py-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Your answer
          </dt>
          <dd className="mt-1 font-question text-lg text-ink">
            {selectedAnswer ?? "Not answered"}
          </dd>
        </div>
        <div className="rounded-xl border border-accent bg-accent-chip px-4 py-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-accent">
            Accepted answer{correctAnswers.length === 1 ? "" : "s"}
          </dt>
          <dd className="mt-1 font-question text-lg text-ink">
            {correctAnswers.join(" or ")}
            {correctAnswerTolerance && ` (± ${correctAnswerTolerance})`}
          </dd>
        </div>
      </dl>
    );
  }

  return (
    <ul className="mt-4 flex flex-col gap-2">
      {choices.map((choice, choiceIndex) => {
        const isCorrectChoice = choiceIndex === correctChoice;
        const isPicked = choiceIndex === selectedChoice;
        return (
          <li
            key={choiceIndex}
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 font-question text-[1.0625rem] leading-7 ${
              isCorrectChoice
                ? "border-accent bg-accent-chip text-ink"
                : isPicked
                  ? "border-miss-hairline bg-miss-surface text-miss-ink"
                  : "border-hairline bg-surface text-muted"
            }`}
          >
            <span className="font-question font-bold">
              {CHOICE_LETTERS[choiceIndex]}
            </span>
            <MathText text={choice} />
            {isCorrectChoice && (
              <span className="ml-auto shrink-0 text-xs font-semibold text-accent">
                correct answer
              </span>
            )}
            {isPicked && !isCorrectChoice && (
              <span className="ml-auto shrink-0 text-xs font-semibold">
                your answer
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
