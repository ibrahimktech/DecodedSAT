/**
 * The banner an auth form shows after a failed submission.
 *
 * `role="alert"` so screen readers announce it without the person having to go
 * hunting for what changed after they pressed the button.
 */
export function FormMessage({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-xl border border-miss-hairline bg-miss-surface px-4 py-3 text-[0.9375rem] text-miss-ink"
    >
      {children}
    </p>
  );
}
