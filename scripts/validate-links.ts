/**
 * Validate Amazon product links conservatively.
 *
 * Safety policy:
 * - report-only by default
 * - "currently unavailable" is NOT a dead link
 * - a destructive dead verdict requires independent missing-page results from
 *   two Amazon product URL forms
 * - blocked/captcha/error responses never become dead
 * - database deletion requires the explicit --delete-confirmed flag
 * - --dry-run always disables deletion
 *
 * Usage:
 *   npx tsx scripts/validate-links.ts
 *   npx tsx scripts/validate-links.ts --limit 200
 *   npx tsx scripts/validate-links.ts --dry-run
 *   npx tsx scripts/validate-links.ts --delete-confirmed
 */
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
const FORCE_DRY_RUN = args.includes("--dry-run");
const DELETE_CONFIRMED = args.includes("--delete-confirmed") && !FORCE_DRY_RUN;
const limitIdx = args.indexOf("--limit");
const parsedLimit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Number.POSITIVE_INFINITY;
const LIMIT = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : Number.POSITIVE_INFINITY;
const CONCURRENCY = 4;
const TIMEOUT_MS = 15_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

type Verdict = "ok" | "unavailable" | "dead" | "blocked" | "error";
type ProbeResult = { verdict: Verdict; status: number; finalUrl: string };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function productUrls(asin: string) {
  return [
    `https://www.amazon.com/dp/${asin}`,
    `https://www.amazon.com/gp/aw/d/${asin}`,
  ];
}

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function classifyHtml(status: number, html: string, finalUrl: string): Verdict {
  const head = html.slice(0, 8000);
  if (/captcha|robot check|automated access/i.test(head)) return "blocked";

  const explicitMissing =
    status === 404 ||
    /page not found|looking for something that isn.t here|sorry!\s*we couldn|dogs of amazon|not a functioning page|we couldn't find that page/i.test(
      html,
    );
  if (explicitMissing) return "dead";

  const unavailable =
    /currently unavailable|temporarily out of stock|we don't know when or if this item will be back in stock|this item is no longer available from the seller/i.test(
      html,
    );

  const hasProductIdentity =
    /id="productTitle"|property="og:title"|name="title"|data-asin=|"asin"\s*:/i.test(html) &&
    !/page not found/i.test(head);

  if (unavailable && hasProductIdentity) return "unavailable";
  if (hasProductIdentity && status >= 200 && status < 400) return "ok";

  // Amazon can return consent/interstitial pages with 200. Those are ambiguous,
  // not proof that a listing is dead.
  if (status >= 200 && status < 500 && /amazon\.com/i.test(finalUrl)) return "blocked";
  return "error";
}

async function checkUrl(url: string): Promise<ProbeResult> {
  try {
    const res = await fetchWithTimeout(url);
    const html = await res.text();
    return {
      verdict: classifyHtml(res.status, html, res.url || url),
      status: res.status,
      finalUrl: res.url || url,
    };
  } catch {
    return { verdict: "error", status: 0, finalUrl: url };
  }
}

/**
 * A confirmed dead listing must independently look missing at both the desktop
 * /dp URL and the alternate /gp/aw/d URL. Any unavailable, blocked, or healthy
 * result wins over deletion.
 */
async function verifyAsin(asin: string): Promise<Verdict> {
  const [desktopUrl, alternateUrl] = productUrls(asin);
  const first = await checkUrl(desktopUrl);

  if (first.verdict === "ok" || first.verdict === "unavailable") return first.verdict;
  if (first.verdict === "blocked" || first.verdict === "error") {
    await sleep(1200 + Math.random() * 1200);
    const retry = await checkUrl(desktopUrl);
    if (retry.verdict === "ok" || retry.verdict === "unavailable") return retry.verdict;
    if (retry.verdict !== "dead") return retry.verdict;
  }

  await sleep(1500 + Math.random() * 1500);
  const second = await checkUrl(alternateUrl);
  if (second.verdict === "ok" || second.verdict === "unavailable") return second.verdict;
  return second.verdict === "dead" ? "dead" : second.verdict;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return out;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.product.findMany({
      where: { retailer: "amazon", asin: { not: null } },
      select: { id: true, asin: true, title: true },
      orderBy: [{ clickCount: "desc" }, { viewCount: "desc" }, { createdAt: "asc" }],
    });
    const list = rows.filter((r) => r.asin).slice(0, LIMIT);
    const mode = DELETE_CONFIRMED ? "delete-confirmed" : "report-only";
    console.log(`Checking ${list.length} Amazon products (concurrency ${CONCURRENCY}) [${mode}]…`);

    const dead: string[] = [];
    let ok = 0;
    let unavailable = 0;
    let blocked = 0;
    let errors = 0;
    let done = 0;

    await mapPool(list, CONCURRENCY, async (row) => {
      const asin = row.asin!;
      const verdict = await verifyAsin(asin);
      done++;

      if (verdict === "ok") ok++;
      else if (verdict === "unavailable") unavailable++;
      else if (verdict === "dead") {
        dead.push(asin);
        console.log(`CONFIRMED DEAD  ${asin}  ${row.title.slice(0, 70)}`);
      } else if (verdict === "blocked") blocked++;
      else errors++;

      if (done % 100 === 0) {
        console.log(
          `… ${done}/${list.length} ok=${ok} unavailable=${unavailable} dead=${dead.length} blocked=${blocked} errors=${errors}`,
        );
      }
      await sleep(250 + Math.random() * 350);
    });

    if (dead.length && DELETE_CONFIRMED) {
      const result = await prisma.product.deleteMany({
        where: { retailer: "amazon", asin: { in: dead } },
      });
      console.log(`\nDeleted ${result.count} independently confirmed-dead products from DB`);
      await prisma.cacheEntry.deleteMany({
        where: { OR: [{ key: { startsWith: "products:" } }, { key: { startsWith: "categories:" } }] },
      });
    } else if (dead.length) {
      console.log(
        "\nReport only: no products were deleted. Re-run with --delete-confirmed only after reviewing the confirmed-dead list.",
      );
    }

    console.log("\n=== Results ===");
    console.log(`ok             : ${ok}`);
    console.log(`unavailable    : ${unavailable} (listing exists; retained)`);
    console.log(
      `confirmed dead : ${dead.length}${dead.length ? ` — ${dead.slice(0, 20).join(", ")}${dead.length > 20 ? "…" : ""}` : ""}`,
    );
    console.log(`blocked        : ${blocked} (ambiguous; retained)`);
    console.log(`errors         : ${errors} (ambiguous; retained)`);
    const remaining = await prisma.product.count();
    console.log(`products in DB : ${remaining}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
