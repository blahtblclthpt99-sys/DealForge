const ASINS = ["B01BA54YGO", "B0FD8D9NJF", "B0CRH74TD6", "B0DYLG399L", "B0DZM1WVCS"];

async function tryFetch(asin: string, url: string, headers: Record<string, string>) {
  try {
    const r = await fetch(url, { headers, redirect: "follow" });
    const html = await r.text();
    const blocked = /captcha|robot check|automated access/i.test(html.slice(0, 5000));
    const title =
      html.match(/<span id="productTitle"[^>]*>\s*([^<]+)/)?.[1] ||
      html.match(/property="og:title" content="([^"]+)/i)?.[1];
    const img =
      html.match(/property="og:image" content="([^"]+)/i)?.[1] ||
      html.match(/"hiRes":"(https:[^"]+)/)?.[1];
    const price =
      html.match(/"priceAmount":\s*([0-9.]+)/)?.[1] ||
      html.match(/class="a-offscreen">\$([0-9.,]+)/)?.[1];
    console.log(
      JSON.stringify({
        asin,
        path: url.replace("https://www.amazon.com", ""),
        status: r.status,
        blocked,
        title: title?.slice(0, 55),
        img: img?.slice(0, 70),
        price,
      }),
    );
  } catch (e) {
    console.log(asin, (e as Error).message);
  }
}

const desktop = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};
const mobile = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  "Accept-Language": "en-US,en;q=0.9",
};

(async () => {
  for (const asin of ASINS) {
    await tryFetch(asin, `https://www.amazon.com/dp/${asin}`, desktop);
    await new Promise((r) => setTimeout(r, 4000));
    await tryFetch(asin, `https://www.amazon.com/gp/aw/d/${asin}`, mobile);
    await new Promise((r) => setTimeout(r, 4000));
  }
})();
