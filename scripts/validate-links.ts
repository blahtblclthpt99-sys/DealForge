/**
 * Validate Amazon product links conservatively.
 *
 * Safety policy:
 * - report-only by default
 * - a listing must be classified dead twice before it is considered confirmed dead
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
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
const CONCURRENCY = 6;
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

type Verdict = "ok" | "dead" | "blocked" | "error";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

    const hasProduct =
      /id="productTitle"|property="og:title"|og:image|"priceAmount"|data-asin=/i.test(html) &&
      !/Page Not Found/i.test(html.slice(0, 500));

    if (res.status === 404 || !hasProduct) return "dead";
    return "ok";
  } catch {
    return "error";
  }
}

/**
 * A destructive verdict requires two independent dead responses.
 * Blocked/error responses are retried but never promoted to dead without confirmation.
 */
async function verifyAsin(asin: string): Promise<Verdict> {
  let verdict = await checkAsin(asin);

  if (verdict === "blocked" || verdict === "error") {
    await sleep(1500 + Math.random() * 1500);
    verdict = await checkAsin(asin);
  }

  if (verdict !== "dead") return verdict;

  await sleep(1800 + Math.random() * 1800);
  const confirmation = await checkAsin(asin);
  return confirmation === "dead" ? "dead" : confirmation;
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
  const mode = DELETE_CONFIRMED ? "delete-confirmed" : "report-only";
  console.log(`Checking ${list.length} Amazon products (concurrency ${CONCURRENCY}) [${mode}]…`);

  const dead: string[] = [];
  const blocked: string[] = [];
  let ok = 0;
  let errors = 0;
  let done = 0;

  await mapPool(list, CONCURRENCY, async (row) => {
    const asin = row.asin!;
    const verdict = await verifyAsin(asin);
    done++;

    if (verdict === "ok") ok++;
    else if (verdict === "dead") {
      dead.push(asin);
      console.log(`CONFIRMED DEAD  ${asin}  ${row.title.slice(0, 55)}`);
    } else if (verdict === "blocked") {
      blocked.push(asin);
    } else {
      errors++;
    }

    if (done % 100 === 0) {
      console.log(`… ${done}/${list.length}  ok=${ok} dead=${dead.length} blocked=${blocked.length}`);
    }
    await sleep(200 + Math.random() * 300);
  });

  // Give blocked listings one final slower verification pass. Ambiguous results remain untouched.
  if (blocked.length) {
    console.log(`\nRetrying ${blocked.length} blocked ASINs slowly…`);
    const stillBlocked: string[] = [];
    for (const asin of blocked) {
      await sleep(2500);
      const verdict = await verifyAsin(asin);
      if (verdict === "dead") {
        dead.push(asin);
        console.log(`CONFIRMED DEAD  ${asin} (slow retry)`);
      } else if (verdict === "ok") {
        ok++;
      } else if (verdict === "blocked") {
        stillBlocked.push(asin);
      } else {
        errors++;
      }
    }
    blocked.length = 0;
    blocked.push(...stillBlocked);
  }

  if (dead.length && DELETE_CONFIRMED) {
    const result = await prisma.product.deleteMany({ where: { asin: { in: dead } } });
    console.log(`\nDeleted ${result.count} confirmed-dead products from DB`);
  } else if (dead.length) {
    console.log("\nReport only: no products were deleted. Re-run with --delete-confirmed to remove confirmed-dead listings.");
  }

  console.log("\n=== Results ===");
  console.log(`ok             : ${ok}`);
  console.log(
    `confirmed dead : ${dead.length}${dead.length ? ` — ${dead.slice(0, 20).join(", ")}${dead.length > 20 ? "…" : ""}` : ""}`,
  );
  console.log(`blocked        : ${blocked.length} (could not verify; left untouched)`);
  console.log(`errors         : ${errors} (left untouched)`);
  const remaining = await prisma.product.count();
  console.log(`products in DB : ${remaining}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
