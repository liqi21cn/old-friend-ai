/**
 * Multi-source portrait lookup for real characters.
 *
 * Pipeline (first hit wins):
 *  1. Baidu Baike <meta property="og:image"> — works from mainland-China
 *     servers (which can't reach wikipedia.org). Handles Chinese + English
 *     names (Baidu auto-redirects "Steve Jobs" → 史蒂夫·乔布斯).
 *  2. zh.wikipedia REST summary → thumbnail.source
 *  3. en.wikipedia REST summary → thumbnail.source
 *  4. Wikidata: entity by label, then P18 (image) → commons URL
 *  5. Bing image search (if BING_IMAGE_API_KEY env set)
 *  6. null  (UI falls back to deterministic gradient avatar)
 *
 * All sources are fetched server-side, never exposed to the client.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

export interface AvatarResult {
  url: string | null;
  source: string | null;
}

/**
 * Scrape Baidu Baike's lemma page and pull the og:image meta. Baidu auto-
 * redirects English / alt-name queries to the canonical Chinese lemma.
 *
 *   GET /item/<name> → 200 with HTML containing
 *   <meta property="og:image" content="https://bkimg.cdn.bcebos.com/.../...">
 *
 * Reachable from mainland China without proxying, unlike wikipedia.
 */
async function fetchBaiduBaike(name: string): Promise<string | null> {
  try {
    const url = `https://baike.baidu.com/item/${encodeURIComponent(name)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    // og:image meta — every Baidu lemma page has one
    const m = html.match(
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    );
    if (!m) return null;
    const imgUrl = m[1].trim();
    // Baidu sometimes returns a default site logo if the lemma is missing.
    // Filter that out: real lemma images come from bkimg.cdn.bcebos.com
    if (!/bkimg\.cdn\.bcebos\.com|baidu\.com\/img/.test(imgUrl)) return null;
    return imgUrl;
  } catch {
    return null;
  }
}

async function fetchSummary(lang: "zh" | "en", title: string): Promise<string | null> {
  try {
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Prefer originalimage for higher quality; fall back to thumbnail
    const img =
      data?.originalimage?.source ||
      data?.thumbnail?.source ||
      null;
    return img;
  } catch {
    return null;
  }
}

async function fetchWikidataImage(name: string): Promise<string | null> {
  try {
    // Find entity by label
    const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
      name,
    )}&language=zh&format=json&limit=1&type=item&origin=*`;
    const sr = await fetch(searchUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!sr.ok) return null;
    const sd = await sr.json();
    const qid = sd?.search?.[0]?.id;
    if (!qid) return null;

    const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json&origin=*`;
    const er = await fetch(entityUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!er.ok) return null;
    const ed = await er.json();
    const claims = ed?.entities?.[qid]?.claims?.P18;
    const filename = claims?.[0]?.mainsnak?.datavalue?.value;
    if (!filename) return null;
    // Commons returns the actual image when you hit Special:FilePath
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
      filename,
    )}?width=400`;
  } catch {
    return null;
  }
}

async function fetchBing(name: string): Promise<string | null> {
  const key = process.env.BING_IMAGE_API_KEY;
  if (!key) return null;
  try {
    const url = `https://api.bing.microsoft.com/v7.0/images/search?q=${encodeURIComponent(
      name + " portrait",
    )}&count=1&safeSearch=Strict&imageType=Photo&size=Medium`;
    const res = await fetch(url, {
      headers: { "Ocp-Apim-Subscription-Key": key, "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.value?.[0]?.contentUrl || null;
  } catch {
    return null;
  }
}

/**
 * Download a remote avatar to local disk so we no longer depend on the upstream
 * (e.g. bkimg.cdn.bcebos.com) staying available, and so users don't hit cross-
 * origin Referer/hotlink restrictions.
 *
 * Target dir:
 *   - $AVATARS_DIR if set
 *   - else `<cwd>/public/avatars` — under Next.js standard static dir, served
 *     at `/avatars/<file>` without extra route handlers.
 *
 * Returns the public path (e.g. `/avatars/jobs.jpg`) suitable for <img src>,
 * or null on failure (caller should fall back to keeping the remote URL).
 */
export async function downloadAvatarLocally(
  remoteUrl: string,
  id: string,
): Promise<string | null> {
  try {
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const res = await fetch(remoteUrl, {
      headers: {
        "User-Agent": UA,
        // Baidu CDN sometimes serves a tiny watermark if Referer is empty —
        // pretend we're navigating from the lemma page.
        Referer: "https://baike.baidu.com/",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    const ext = extFromContentType(ct, remoteUrl);
    if (!ext) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024) return null; // tiny == placeholder / error img
    const dir = process.env.AVATARS_DIR
      ? process.env.AVATARS_DIR
      : path.join(process.cwd(), "public", "avatars");
    await fs.mkdir(dir, { recursive: true });
    // sanitize id to filename-safe chars (drop dots too — they confuse the
    // /api/avatars/[file] regex that gates traversal)
    const safe = id.replace(/[^a-zA-Z0-9_\-]/g, "_");
    const file = path.join(dir, `${safe}.${ext}`);
    await fs.writeFile(file, buf);
    // Route via the API handler instead of the static /avatars/ path because
    // Next.js's static handler doesn't see files added after startup. See
    // app/api/avatars/[file]/route.ts for the long-form reasoning.
    return `/api/avatars/${safe}.${ext}`;
  } catch {
    return null;
  }
}

function extFromContentType(ct: string, url: string): string | null {
  const lower = ct.toLowerCase();
  if (lower.includes("jpeg") || lower.includes("jpg")) return "jpg";
  if (lower.includes("png")) return "png";
  if (lower.includes("webp")) return "webp";
  if (lower.includes("gif")) return "gif";
  if (lower.includes("svg")) return "svg";
  // Fallback: sniff from URL path (strip query string first)
  const path = url.split("?")[0].toLowerCase();
  if (/\.jpe?g$/.test(path)) return "jpg";
  if (/\.png$/.test(path)) return "png";
  if (/\.webp$/.test(path)) return "webp";
  if (/\.gif$/.test(path)) return "gif";
  // Baidu's bkimg often omits extension and returns image/jpeg by default
  if (lower.startsWith("image/")) return "jpg";
  return null;
}

export async function resolveAvatar(name: string): Promise<AvatarResult> {
  const candidates: Array<[string, () => Promise<string | null>]> = [
    // Baidu first — reachable from mainland-China deployments where the
    // wikimedia domains are blocked. Outside China this is still fine,
    // just slower than wikipedia.
    ["baidu-baike", () => fetchBaiduBaike(name)],
    ["wikipedia-zh", () => fetchSummary("zh", name)],
    ["wikipedia-en", () => fetchSummary("en", name)],
    ["wikidata", () => fetchWikidataImage(name)],
    ["bing", () => fetchBing(name)],
  ];

  for (const [source, fn] of candidates) {
    const url = await fn();
    if (url) return { url, source };
  }
  return { url: null, source: null };
}
