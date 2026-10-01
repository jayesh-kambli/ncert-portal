// OpenAI has no API that returns the prepaid credit balance, so it's
// derived: credits purchased (OPENAI_CREDIT_TOTAL, copied by hand from the
// Billing page) minus what the organization Costs API reports as spent since
// the first top-up (OPENAI_CREDIT_SINCE). Without those two, only spend for
// the current month is available. The Costs API lags a few hours and doesn't know about grant
// expiry, so treat the result as an estimate, not the billing page's figure.
//
// Requires an Admin API key (sk-admin-...), which can manage the whole
// organization — this module must only ever run server-side, and only the
// computed totals may be sent to the browser.

const COSTS_URL = "https://api.openai.com/v1/organization/costs";
const MAX_BUCKETS_PER_PAGE = 180; // API maximum for 1d buckets
// Costs only update every few hours; caching keeps every dashboard visit
// from hitting the API with the org admin key.
const CACHE_MS = 10 * 60_000;

export interface CreditSummary {
  /** null when OPENAI_CREDIT_TOTAL/OPENAI_CREDIT_SINCE aren't configured. */
  creditTotal: number | null;
  remaining: number | null;
  since: string; // YYYY-MM-DD, start of the spend window
  spent: number;
  byLineItem: { lineItem: string; amount: number }[];
  byDay: { date: string; amount: number }[];
  fetchedAt: string;
}

interface CostsPage {
  data: {
    start_time: number;
    results: { amount: { value: number | string }; line_item: string | null }[];
  }[];
  has_more: boolean;
  next_page: string | null;
}

export class CreditsConfigError extends Error {}

function readConfig() {
  const adminKey = process.env.OPENAI_ADMIN_KEY;
  if (!adminKey) throw new CreditsConfigError("OPENAI_ADMIN_KEY is not set");

  const total = Number(process.env.OPENAI_CREDIT_TOTAL);
  const since = process.env.OPENAI_CREDIT_SINCE ?? "";
  if (total > 0 && /^\d{4}-\d{2}-\d{2}$/.test(since)) {
    return { adminKey, total, since };
  }
  // No balance configured: fall back to spend for the current month.
  return { adminKey, total: null, since: new Date().toISOString().slice(0, 8) + "01" };
}

async function fetchAllBuckets(adminKey: string, startTime: number) {
  const buckets: CostsPage["data"] = [];
  let page: string | null = null;

  do {
    const params = new URLSearchParams({
      start_time: String(startTime),
      bucket_width: "1d",
      limit: String(MAX_BUCKETS_PER_PAGE),
      group_by: "line_item",
    });
    if (page) params.set("page", page);

    const res = await fetch(`${COSTS_URL}?${params}`, {
      headers: { Authorization: `Bearer ${adminKey}` },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`OpenAI Costs API: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    }
    const body = (await res.json()) as CostsPage;
    buckets.push(...body.data);
    page = body.has_more ? body.next_page : null;
  } while (page);

  return buckets;
}

let cached: { at: number; summary: CreditSummary } | null = null;

export async function getCreditSummary(): Promise<CreditSummary> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.summary;

  const { adminKey, total, since } = readConfig();
  const startTime = Math.floor(Date.parse(`${since}T00:00:00Z`) / 1000);
  const buckets = await fetchAllBuckets(adminKey, startTime);

  const byLineItem = new Map<string, number>();
  const byDay: CreditSummary["byDay"] = [];
  let spent = 0;

  for (const bucket of buckets) {
    let dayTotal = 0;
    for (const r of bucket.results) {
      const value = Number(r.amount.value);
      dayTotal += value;
      const key = r.line_item ?? "(other)";
      byLineItem.set(key, (byLineItem.get(key) ?? 0) + value);
    }
    spent += dayTotal;
    if (dayTotal > 0) {
      byDay.push({
        date: new Date(bucket.start_time * 1000).toISOString().slice(0, 10),
        amount: dayTotal,
      });
    }
  }

  const summary: CreditSummary = {
    creditTotal: total,
    since,
    spent,
    remaining: total === null ? null : total - spent,
    byLineItem: [...byLineItem]
      .map(([lineItem, amount]) => ({ lineItem, amount }))
      .filter((r) => r.amount > 0)
      .sort((a, b) => b.amount - a.amount),
    byDay: byDay.sort((a, b) => b.date.localeCompare(a.date)),
    fetchedAt: new Date().toISOString(),
  };
  cached = { at: Date.now(), summary };
  return summary;
}
