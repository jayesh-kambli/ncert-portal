import { CreditsConfigError, getCreditSummary } from "@/lib/openai-credits";

export const dynamic = "force-dynamic";

// Public: only the computed totals leave the server — never the admin key or
// the per-model breakdown. getCreditSummary caches for 10 minutes, so page
// loads don't each hit OpenAI.
export async function GET() {
  try {
    const { creditTotal, remaining, spent, since, fetchedAt } = await getCreditSummary();
    return Response.json(
      { creditTotal, remaining, spent, since, fetchedAt },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    if (!(err instanceof CreditsConfigError)) console.error("[api/credits]", err);
    // The dashboard just hides the badge when credits are unavailable.
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
