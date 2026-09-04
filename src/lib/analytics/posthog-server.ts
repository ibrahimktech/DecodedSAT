import "server-only";

type PostHogConfig = {
  projectId: string;
  personalApiKey: string;
  apiHost: string;
};

function config(): PostHogConfig | null {
  const projectId = process.env.POSTHOG_PROJECT_ID || "";
  const personalApiKey = process.env.POSTHOG_PERSONAL_API_KEY || "";
  const apiHost = (process.env.POSTHOG_API_HOST || "https://us.posthog.com").replace(/\/+$/, "");
  return projectId && personalApiKey ? { projectId, personalApiKey, apiHost } : null;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const settings = config();
  if (!settings) throw new Error("PostHog management API is not configured.");
  return fetch(`${settings.apiHost}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${settings.personalApiKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
}

export function isPostHogManagementConfigured(): boolean {
  return config() !== null;
}

export async function queryPostHog<T = unknown>(query: string): Promise<T> {
  const settings = config();
  if (!settings) throw new Error("PostHog management API is not configured.");
  const response = await request(`/api/projects/${settings.projectId}/query/`, {
    method: "POST",
    body: JSON.stringify({
      query: { kind: "HogQLQuery", query },
      name: "DecodedSAT admin analytics",
    }),
  });
  if (!response.ok) throw new Error(`PostHog query failed (${response.status}).`);
  return (await response.json()) as T;
}

export async function deletePostHogPerson(
  distinctId: string,
): Promise<"deleted" | "not_found" | "not_configured"> {
  const settings = config();
  if (!settings) return "not_configured";
  const deletion = await request(
    `/api/projects/${settings.projectId}/persons/bulk_delete/`,
    {
      method: "POST",
      body: JSON.stringify({
        distinct_ids: [distinctId],
        delete_events: true,
        delete_recordings: true,
        keep_person: false,
      }),
    },
  );
  if (!deletion.ok) {
    throw new Error(`PostHog person deletion failed (${deletion.status}).`);
  }
  const body = (await deletion.json()) as { persons_found?: number };
  return body.persons_found === 0 ? "not_found" : "deleted";
}
