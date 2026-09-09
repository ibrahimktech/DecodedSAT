import type { Metadata } from "next";
import { PopupAdmin } from "@/components/admin/PopupAdmin";
import { listAdminPopups } from "@/lib/admin/data";
import { requireAdmin } from "@/lib/auth/admin";

export const metadata: Metadata = {
  title: "Popups",
};

export default async function AdminPopupsPage() {
  const { supabase } = await requireAdmin();
  const popups = await listAdminPopups(supabase);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="font-display text-3xl font-extrabold text-ink">
        Popups
      </h1>
      <p className="mt-2 max-w-3xl text-[0.9375rem] leading-relaxed text-muted">
        Create short in-app announcements and optionally limit them by answered
        questions or account age. Eligibility is checked when a student enters
        the app.
      </p>

      <PopupAdmin popups={popups} />
    </div>
  );
}
