export type QuestionType = "multiple_choice" | "student_produced_response";
export type SprAnswerMode = "exact" | "tolerance" | "multiple";

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice: "Multiple choice",
  student_produced_response: "Student-produced response",
};

export const SPR_ANSWER_MODE_LABELS: Record<SprAnswerMode, string> = {
  exact: "Exact",
  tolerance: "Tolerance",
  multiple: "Multiple accepted values",
};

const MAX_NUMERIC_ANSWER_LENGTH = 100;
const DECIMAL_TOKEN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TEN = BigInt(10);

export type Rational = {
  numerator: bigint;
  denominator: bigint;
};

function gcd(left: bigint, right: bigint): bigint {
  let a = left < ZERO ? -left : left;
  let b = right < ZERO ? -right : right;
  while (b !== ZERO) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function decimalToRational(value: string): Rational | null {
  if (!DECIMAL_TOKEN.test(value)) return null;

  const negative = value.startsWith("-");
  const unsigned = value.replace(/^[+-]/, "");
  const [integerPart, decimalPart = ""] = unsigned.split(".");
  const digits = `${integerPart || "0"}${decimalPart}`;

  try {
    return {
      numerator: BigInt(digits) * (negative ? -ONE : ONE),
      denominator: TEN ** BigInt(decimalPart.length),
    };
  } catch {
    return null;
  }
}

/**
 * Parses the exact subset accepted by the database: integers, decimals, and
 * one fraction slash. No exponent notation, thousands separators, or text is
 * accepted. Decimals are converted to rational integers before comparison.
 */
export function parseNumericAnswer(input: string): Rational | null {
  const value = input.trim();
  if (value.length === 0 || value.length > MAX_NUMERIC_ANSWER_LENGTH) {
    return null;
  }

  const parts = value.split("/");
  if (parts.length > 2) return null;

  const left = decimalToRational(parts[0]);
  const right = parts.length === 2 ? decimalToRational(parts[1]) : null;
  if (!left || (parts.length === 2 && !right)) return null;

  let numerator = left.numerator;
  let denominator = left.denominator;
  if (right) {
    if (right.numerator === ZERO) return null;
    numerator *= right.denominator;
    denominator *= right.numerator;
  }

  if (denominator < ZERO) {
    numerator = -numerator;
    denominator = -denominator;
  }
  if (numerator === ZERO) return { numerator: ZERO, denominator: ONE };

  const divisor = gcd(numerator, denominator);
  return {
    numerator: numerator / divisor,
    denominator: denominator / divisor,
  };
}

export function normalizeNumericAnswer(input: string): string | null {
  const parsed = parseNumericAnswer(input);
  if (!parsed) return null;
  return parsed.denominator === ONE
    ? parsed.numerator.toString()
    : `${parsed.numerator}/${parsed.denominator}`;
}

export function isValidNumericAnswer(input: string): boolean {
  return parseNumericAnswer(input) !== null;
}

export function numericAnswersEquivalent(left: string, right: string): boolean {
  const a = parseNumericAnswer(left);
  const b = parseNumericAnswer(right);
  return Boolean(
    a &&
      b &&
      a.numerator === b.numerator &&
      a.denominator === b.denominator,
  );
}

export function isNonnegativeNumericAnswer(input: string): boolean {
  const value = parseNumericAnswer(input);
  return Boolean(value && value.numerator >= ZERO);
}

export function hasAnswer(value: string | undefined | null): boolean {
  return typeof value === "string" && value.trim() !== "";
}
