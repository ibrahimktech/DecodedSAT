/** A non-error form status announced politely by screen readers. */
export function FormSuccess({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className="rounded-xl border border-accent bg-accent-chip px-4 py-3 text-[0.9375rem] font-medium text-accent"
    >
      {children}
    </p>
  );
}
