/**
 * Validate Amazon product links. Removes dead ASINs (Page Not Found).
 *
 * Usage:
 *   npx tsx scripts/validate-links.ts           # scan all, delete dead
 *   npx tsx scripts/validate-links.ts --limit 200
 *   npx tsx scripts/validate-links.ts --dry-run
 */
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
const CONCURRENCY = 6;
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

type Verdict = "ok" | "dead" | "blocked" | "error";

async function checkAsin(asin: string): Promise<Verdict> {
  try {
    const res = await fetch(`https://www.amazon.com/gp/aw/d/${asin}`, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
      redirect: "follow",
    });
    const html = await res.text();
    const head = html.slice(0, 6000);
    if (/captcha|robot check|automated access/i.test(head)) return "blocked";
    if (
      /page not found|looking for something that isn.t here|Sorry!\s*We couldn|dogs of Amazon|not a functioning page|We couldn't find that page/i.test(
        html,
      )
    ) {
      return "dead";
    }
    if (
      /currently unavailable\.?\s*we don't know when|this item is no longer available/i.test(html) ||
      (/currently unavailable/i.test(html) &&
        !/name="submit\.add-to-cart"|id="add-to-cart-button"|add to cart/i.test(html))
    ) {
      return "dead";
    }
    // Mobile pages sometimes omit productTitle — accept og:title / price / image as alive
    const hasProduct =
      /id="productTitle"|property="og:title"|og:image|"priceAmount"|data-asin=/i.test(html) &&
      !/Page Not Found/i.test(html.slice(0, 500));
    if (res.status === 404 || !hasProduct) return "dead";
    return "ok";
  } catch {
    return "error";
  }
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
  const rows = await prisma.product.findMany({
    where: { retailer: "amazon", asin: { not: null } },
    select: { id: true, asin: true, title: true },
    orderBy: { createdAt: "asc" },
  });
  const list = rows.filter((r) => r.asin).slice(0, LIMIT);
  console.log(`Checking ${list.length} Amazon products (concurrency ${CONCURRENCY})${DRY ? " [dry-run]" : ""}…`);

  const dead: string[] = [];
  const blocked: string[] = [];
  let ok = 0;
  let errors = 0;
  let done = 0;

  await mapPool(list, CONCURRENCY, async (row) => {
    const asin = row.asin!;
    let verdict = await checkAsin(asin);
    if (verdict === "blocked" || verdict === "error") {
      await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
      verdict = await checkAsin(asin);
    }
    done++;
    if (verdict === "ok") ok++;
    else if (verdict === "dead") {
      dead.push(asin);
      console.log(`DEAD  ${asin}  ${row.title.slice(0, 55)}`);
    } else if (verdict === "blocked") {
      blocked.push(asin);
    } else {
      errors++;
    }
    if (done % 100 === 0) {
      console.log(`… ${done}/${list.length}  ok=${ok} dead=${dead.length} blocked=${blocked.length}`);
    }
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
  });

  // Retry blocked once more slowly
  if (blocked.length) {
    console.log(`\nRetrying ${blocked.length} blocked ASINs slowly…`);
    const stillBlocked: string[] = [];
    for (const asin of blocked) {
      await new Promise((r) => setTimeout(r, 2500));
      const v = await checkAsin(asin);
      if (v === "dead") {
        dead.push(asin);
        console.log(`DEAD  ${asin} (on retry)`);
      } else if (v === "ok") ok++;
      else stillBlocked.push(asin);
    }
    blocked.length = 0;
    blocked.push(...stillBlocked);
  }

  if (dead.length && !DRY) {
    const result = await prisma.product.deleteMany({ where: { asin: { in: dead } } });
    console.log(`\nDeleted ${result.count} dead products from DB`);
  }

  console.log("\n=== Results ===");
  console.log(`ok      : ${ok}`);
  console.log(`dead    : ${dead.length}${dead.length ? ` — ${dead.slice(0, 20).join(", ")}${dead.length > 20 ? "…" : ""}` : ""}`);
  console.log(`blocked : ${blocked.length} (could not verify)`);
  console.log(`errors  : ${errors}`);
  const remaining = await prisma.product.count();
  console.log(`products left in DB: ${remaining}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
