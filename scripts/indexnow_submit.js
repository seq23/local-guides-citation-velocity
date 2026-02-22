/**
 * IndexNow submitter for theindustryguides.com (velocity site).
 * - No deps (Node 18+).
 * - Reads key from ./indexnow.txt
 * - Collects URLs from:
 *   (a) ./sitemaps/sitemap_all.xml
 *   (b) ./medium-articles/<any>/index.html (not currently in sitemap_all.xml)
 * - Submits in chunks of 200 URLs/request to Bing IndexNow endpoint.
 *
 * Behavior:
 * - Exit 0 even if Bing errors (warn-only), so Daily Release never breaks.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

const HOST = process.env.INDEXNOW_HOST || "theindustryguides.com";
const KEY_PATH = process.env.INDEXNOW_KEY_PATH || path.join(process.cwd(), "indexnow.txt");
const SITEMAP_ALL = process.env.INDEXNOW_SITEMAP || path.join(process.cwd(), "sitemaps", "sitemap_all.xml");
const MEDIUM_DIR = process.env.INDEXNOW_MEDIUM_DIR || path.join(process.cwd(), "medium-articles");
const DRY_RUN = /^(1|true|yes|y|on)$/i.test(String(process.env.INDEXNOW_DRY_RUN || process.env.INDEXNOW_DRY || ""));
const ENDPOINT = process.env.INDEXNOW_ENDPOINT || "https://www.bing.com/indexnow";
const MODE = String(process.env.INDEXNOW_MODE || "full").toLowerCase();

function readText(p) {
  return fs.readFileSync(p, "utf8");
}

function fileExists(p) {
  try { fs.accessSync(p, fs.constants.F_OK); return true; } catch { return false; }
}

function walk(dir) {
  const out = [];
  if (!fileExists(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function parseSitemapLocs(xml) {
  // Minimal parser: extract <loc>...</loc>
  const re = /<loc>([^<]+)<\/loc>/g;
  const urls = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    const u = (m[1] || "").trim();
    if (u) urls.push(u);
  }
  return urls;
}


function urlsFromChangedFiles(files) {
  // Convert changed repo file paths into public URLs.
  // Rules:
  // - */index.html -> trailing-slash URL
  // - *.html -> keep filename
  // - sitemap*.xml, feed.xml, feed.json -> include as-is
  const out = [];
  for (const fp of files) {
    const f = String(fp || "").trim().replace(/\\/g, "/");
    if (!f) continue;
    if (f.startsWith(".git/")) continue;

    // Only routable artifacts
    const isHtml = f.endsWith(".html");
    const isSitemap = /^(sitemap\.xml|sitemaps\/.+\.xml)$/i.test(f);
    const isFeed = /^(feed\.xml|feed\.json)$/i.test(f);
    const isRobots = f == "robots.txt";
            const isText = f.endsWith(".txt"); // includes indexnow + key file
    // (We'll filter host/path later)

    if (!(isHtml || isSitemap || isFeed || isRobots || isText)) continue;

    if (f.endsWith("/index.html")) {
      const urlPath = "/" + f.replace(/\/index\.html$/i, "/");
      out.push(`https://${HOST}${urlPath}`);
    } else if (isHtml || isSitemap || isFeed || isRobots || isText) {
      out.push(`https://${HOST}/` + f.replace(/^\/+/, ""));
    }
  }
  return out;
}

function mediumUrlsFromFs(mediumRoot) {
  // Expect files like medium-articles/**/index.html
  const files = walk(mediumRoot).filter(p => p.endsWith(path.sep + "index.html") || p.endsWith("/index.html"));
  return files.map(fp => {
    const rel = path.relative(process.cwd(), fp).replace(/\\/g, "/"); // windows-safe
    // rel like "medium-articles/pi/brain-injury/index.html" -> URL path "/medium-articles/pi/brain-injury/"
    const urlPath = "/" + rel
      .replace(/index\.html$/i, "")
      .replace(/\/+$/g, "/"); // ensure trailing slash
    return `https://${HOST}${urlPath}`;
  });
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = Buffer.from(JSON.stringify(body), "utf8");

    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        path: u.pathname + (u.search || ""),
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": data.length,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

(async function main() {
  try {
    if (!fileExists(KEY_PATH)) {
      console.log(`[IndexNow] SKIP: key file missing at ${KEY_PATH}`);
      process.exit(0);
    }
    const key = readText(KEY_PATH).trim();
    if (!key) {
      console.log("[IndexNow] SKIP: key is empty");
      process.exit(0);
    }

    let urls = [];
    if (fileExists(SITEMAP_ALL)) {
      const xml = readText(SITEMAP_ALL);
      urls.push(...parseSitemapLocs(xml));
    } else {
      console.log(`[IndexNow] NOTE: sitemap_all missing at ${SITEMAP_ALL}`);
    }

    urls.push(...mediumUrlsFromFs(MEDIUM_DIR));

    // Delta mode: submit only changed, staged files from this workflow run.
    // Requires workflow step: `git add -A` before running this script.
    if (MODE === "delta") {
      try {
        const changed = String(execSync("git diff --cached --name-only --diff-filter=AM", { encoding: "utf8" }) || "")
          .split("\n").map(x => x.trim()).filter(Boolean);

        const deltaUrls = urlsFromChangedFiles(changed);
        urls = uniq(deltaUrls).filter(u => u.startsWith(`https://${HOST}/`));

        console.log(`[IndexNow] MODE=delta staged_files=${changed.length} urls=${urls.length}`);
      } catch (e) {
        console.log("[IndexNow] MODE=delta NOTE: unable to read staged diff; falling back to full collection (warn-only)");
      }
    } else {

        }

    urls = uniq(urls).filter(u => u.startsWith(`https://${HOST}/`));

    if (urls.length === 0) {
      console.log("[IndexNow] SKIP: no URLs found to submit");
      process.exit(0);
    }

    const batches = chunk(urls, 200);
    console.log(`[IndexNow] Host=${HOST} URLs=${urls.length} Batches=${batches.length} Endpoint=${ENDPOINT}`);

    let ok = 0;
    let fail = 0;

    for (let i = 0; i < batches.length; i++) {
      const urlList = batches[i];
      const payload = { host: HOST, key, urlList };

      if (DRY_RUN) {
        ok++;
        console.log("[IndexNow] Batch " + (i + 1) + "/" + batches.length + ": DRY_RUN (skip POST) urls=" + urlList.length);
        continue;
      }

      try {
        const resp = await postJson(ENDPOINT, payload);
        const sc = resp.statusCode || 0;
        if (sc >= 200 && sc < 300) {
          ok++;
          console.log(`[IndexNow] Batch ${i + 1}/${batches.length}: OK (HTTP ${sc}) urls=${urlList.length}`);
        } else {
          fail++;
          console.log(`[IndexNow] Batch ${i + 1}/${batches.length}: FAIL (HTTP ${sc}) urls=${urlList.length}`);
          if (resp.body && resp.body.trim()) {
            console.log(`[IndexNow] Response body (truncated 500): ${resp.body.trim().slice(0, 500)}`);
          }
        }
      } catch (e) {
        fail++;
        console.log(`[IndexNow] Batch ${i + 1}/${batches.length}: ERROR urls=${urlList.length}`);
        console.log(`[IndexNow] ${String(e && e.stack ? e.stack : e)}`);
      }
    }

    console.log(`[IndexNow] Done. OK=${ok} FAIL=${fail} (warn-only)`);
    process.exit(0);
  } catch (e) {
    console.log("[IndexNow] Fatal error (warn-only):");
    console.log(String(e && e.stack ? e.stack : e));
    process.exit(0);
  }
})();
