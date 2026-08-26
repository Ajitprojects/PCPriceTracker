import "dotenv/config";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL;

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "❌ Missing SUPABASE_URL/EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const SUPPORTED_DOMAINS = [
  "mdcomputers.in",
  "vedantcomputers.com",
  "primeabgb.com",
  "computechstore.in",
];

function cleanMoney(value) {
  if (value === null || value === undefined) return null;

  const text = String(value);

  const matches = [
    ...text.matchAll(
      /(?:₹|Rs\.?|INR)?\s*([\d]{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d{3,7}(?:\.\d{1,2})?)/gi
    ),
  ];

  for (const match of matches) {
    const raw = match[1];
    if (!raw) continue;

    const price = Number(raw.replace(/,/g, ""));

    if (
      Number.isFinite(price) &&
      price >= 500 &&
      price <= 1_000_000
    ) {
      return Math.round(price);
    }
  }

  return null;
}

function normalizeSku(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function getHostname(url) {
  try {
    return new URL(url)
      .hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isSupportedUrl(url) {
  const hostname = getHostname(url);

  return SUPPORTED_DOMAINS.some(
    (domain) =>
      hostname === domain ||
      hostname.endsWith(`.${domain}`)
  );
}

function skuAppearsExactly({ sku, text, html }) {
  const wanted = normalizeSku(sku);

  if (!wanted) return false;

  const visibleText = normalizeSku(text);
  const pageHtml = normalizeSku(html);

  return (
    visibleText.includes(wanted) ||
    pageHtml.includes(wanted)
  );
}

function detectStock(text, html) {
  const all = `${text}\n${html}`.toLowerCase();

  if (
    /availability\s*:\s*in stock/i.test(text) ||
    /availability\s+in stock/i.test(text)
  ) {
    return true;
  }

  if (
    /availability\s*:\s*out of stock/i.test(text) ||
    /availability\s+out of stock/i.test(text)
  ) {
    return false;
  }

  const strongInSignals = [
    "add to cart",
    "buy now",
    "in stock",
  ];

  if (
    strongInSignals.some((signal) =>
      all.includes(signal)
    )
  ) {
    return true;
  }

  const strongOutSignals = [
    "out of stock",
    "sold out",
    "currently unavailable",
    "notify me when available",
  ];

  if (
    strongOutSignals.some((signal) =>
      all.includes(signal)
    )
  ) {
    return false;
  }

  return false;
}

function isChallengePage(title, text) {
  const titleLower = String(title || "").toLowerCase();
  const textLower = String(text || "").toLowerCase();

  return (
    titleLower.includes("attention required") ||
    titleLower.includes("just a moment") ||
    textLower.includes("verify you are human") ||
    textLower.includes("checking your browser") ||
    (
      textLower.includes("cloudflare") &&
      (
        titleLower.includes("attention") ||
        titleLower.includes("challenge")
      )
    )
  );
}

async function getStructuredPrice(page) {
  const candidates = await page.evaluate(() => {
    const values = [];

    const push = (value) => {
      if (
        value !== null &&
        value !== undefined &&
        String(value).trim() !== ""
      ) {
        values.push(String(value));
      }
    };

    const metaSelectors = [
      'meta[property="product:price:amount"]',
      'meta[property="og:price:amount"]',
      'meta[itemprop="price"]',
      'meta[name="twitter:data1"]',
    ];

    for (const selector of metaSelectors) {
      document
        .querySelectorAll(selector)
        .forEach((node) => {
          push(node.getAttribute("content"));
        });
    }

    document
      .querySelectorAll(
        'script[type="application/ld+json"]'
      )
      .forEach((script) => {
        try {
          const parsed = JSON.parse(
            script.textContent || "null"
          );

          const walk = (obj) => {
            if (
              !obj ||
              typeof obj !== "object"
            ) {
              return;
            }

            if (obj.price !== undefined) {
              push(obj.price);
            }

            if (obj.lowPrice !== undefined) {
              push(obj.lowPrice);
            }

            if (Array.isArray(obj)) {
              obj.forEach(walk);
            } else {
              Object.values(obj).forEach(walk);
            }
          };

          walk(parsed);
        } catch {
          // Invalid JSON-LD is ignored.
        }
      });

    return values;
  });

  for (const candidate of candidates) {
    const price = cleanMoney(candidate);

    if (price !== null) {
      return price;
    }
  }

  return null;
}

async function getSelectorPrice(page, hostname) {
  const selectorMap = {
    "mdcomputers.in": [
      ".product-price-new",
      ".price-new",
      ".special-price",
      ".product-price",
      "[itemprop='price']",
      ".price",
    ],

    "vedantcomputers.com": [
      ".product-price-new",
      ".price-new",
      ".special",
      ".price",
      "[itemprop='price']",
    ],

    "primeabgb.com": [
      ".woocommerce-Price-amount",
      ".price ins .woocommerce-Price-amount",
      ".summary .price",
      ".product-price",
      "[itemprop='price']",
    ],

    "computechstore.in": [
      ".woocommerce-Price-amount",
      ".price ins .woocommerce-Price-amount",
      ".summary .price",
      ".price",
      "[itemprop='price']",
    ],
  };

  const selectors =
    selectorMap[hostname] || [
      "[itemprop='price']",
      ".price",
    ];

  for (const selector of selectors) {
    try {
      const values = await page
        .locator(selector)
        .allTextContents();

      for (const value of values) {
        const price = cleanMoney(value);

        if (price !== null) {
          return price;
        }
      }
    } catch {
      // Continue to next selector.
    }
  }

  return null;
}

async function getTextPatternPrice(page, hostname) {
  const text = (
    await page.locator("body").innerText()
  ).replace(/\s+/g, " ");

  const patterns =
    hostname === "mdcomputers.in"
      ? [
          /Offer Price\s*₹\s*([\d,]+(?:\.\d{1,2})?)/i,
          /Offer Price[\s\S]{0,40}?₹\s*([\d,]+(?:\.\d{1,2})?)/i,
          /Special Price\s*₹\s*([\d,]+(?:\.\d{1,2})?)/i,
          /Our Price\s*₹\s*([\d,]+(?:\.\d{1,2})?)/i,
          /Selling Price\s*₹\s*([\d,]+(?:\.\d{1,2})?)/i,
        ]

      : hostname === "vedantcomputers.com"
      ? [
          /Special Price\s*₹?\s*([\d,]+(?:\.\d{1,2})?)/i,
          /₹\s*([\d,]+(?:\.\d{1,2})?)\s*(?:Add to Cart|Buy Now)/i,
        ]

      : hostname === "primeabgb.com"
      ? [
          /₹\s*([\d,]+(?:\.\d{1,2})?)\s*(?:Add to cart|Buy now)/i,
        ]

      : hostname === "computechstore.in"
      ? [
          /₹\s*([\d,]+(?:\.\d{1,2})?)\s*(?:Add to cart|Buy now|Save Extra)/i,
        ]

      : [];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match?.[1]) {
      const price = cleanMoney(match[1]);

      if (price !== null) {
        return price;
      }
    }
  }

  return null;
}

async function detectSafePrice(page, hostname) {
  const structured =
    await getStructuredPrice(page);

  if (structured !== null) {
    return structured;
  }

  const selectorPrice =
    await getSelectorPrice(
      page,
      hostname
    );

  if (selectorPrice !== null) {
    return selectorPrice;
  }

  return getTextPatternPrice(
    page,
    hostname
  );
}

async function loadTrackedSources() {
  const {
    data: links,
    error: linksError,
  } = await supabase
    .from("product_sources")
    .select(
      "id, product_id, source_id, product_url, store_sku, active"
    )
    .eq("active", true)
    .order("id", {
      ascending: true,
    });

  if (linksError) {
    throw linksError;
  }

  const {
    data: products,
    error: productsError,
  } = await supabase
    .from("products")
    .select(
      "id, name, brand, model, category, product_role"
    );

  if (productsError) {
    throw productsError;
  }

  const {
    data: sources,
    error: sourcesError,
  } = await supabase
    .from("sources")
    .select(
      "id, name, source_type, active"
    );

  if (sourcesError) {
    throw sourcesError;
  }

  const productMap = new Map(
    (products || []).map((p) => [
      p.id,
      p,
    ])
  );

  const sourceMap = new Map(
    (sources || []).map((s) => [
      s.id,
      s,
    ])
  );

  return (links || [])
    .map((link) => ({
      ...link,
      product:
        productMap.get(
          link.product_id
        ) || null,
      source:
        sourceMap.get(
          link.source_id
        ) || null,
    }))
    .filter(
      (item) =>
        item.product &&
        item.source
    );
}

async function recordSourceHealth(
  productSourceId,
  {
    status,
    errorMessage = null,
    price,
    inStock,
    success = false,
  }
) {
  const now = new Date().toISOString();

  const payload = {
    last_checked_at: now,
    last_status: status,
    last_error: errorMessage,
  };

  if (success) {
    payload.last_success_at = now;
    payload.last_price = price;
    payload.last_in_stock = inStock;
    payload.last_error = null;
  }

  const { error } = await supabase
    .from("product_sources")
    .update(payload)
    .eq("id", productSourceId);

  if (error) {
    console.log(
      `⚠️ Could not update source health for product_sources.id=${productSourceId}: ${error.message}`
    );
  }
}

async function savePriceIfChanged({
  productId,
  sourceId,
  sourceName,
  price,
  inStock,
}) {
  const { data: latestRows, error: latestError } = await supabase
    .from("price_history")
    .select("id, price, in_stock, captured_at")
    .eq("product_id", productId)
    .eq("source_type", "online")
    .eq("source_id", sourceId)
    .order("captured_at", { ascending: false })
    .limit(1);

  if (latestError) {
    throw latestError;
  }

  const latest = latestRows?.[0] || null;

  const latestPrice =
    latest
      ? Number(latest.price)
      : null;

  const latestStock =
    latest
      ? Boolean(latest.in_stock)
      : null;

  const priceChanged =
    latestPrice === null ||
    latestPrice !== Number(price);

  const stockChanged =
    latestStock === null ||
    latestStock !== Boolean(inStock);

  if (!priceChanged && !stockChanged) {
    return {
      inserted: false,
      reason: "unchanged",
      latest,
    };
  }

  const { error } = await supabase
    .from("price_history")
    .insert({
      product_id: productId,
      source_type: "online",
      source_name: sourceName,
      source_id: sourceId,
      price,
      in_stock: inStock,
      match_confidence: "exact_sku",
    });

  if (error) {
    throw error;
  }

  return {
    inserted: true,
    reason:
      latest
        ? "changed"
        : "first_observation",
    latest,
  };
}

async function collectOne(page, item) {
  const url = item.product_url;
  const hostname = getHostname(url);

  const expectedSku =
    item.store_sku ||
    item.product.model;

  console.log(
    "\n────────────────────────────────────"
  );

  console.log(
    `🔎 ${item.product.name}`
  );

  console.log(
    `🏪 ${item.source.name}`
  );

  console.log(
    `🔗 ${url}`
  );

  console.log(
    `🏷️ Expected SKU: ${
      expectedSku || "MISSING"
    }`
  );

  if (!isSupportedUrl(url)) {
    await recordSourceHealth(
      item.id,
      {
        status: "unsupported_domain",
        errorMessage:
          "Unsupported store domain",
      }
    );

    console.log(
      "⏭️ SKIP: unsupported domain."
    );

    return {
      status: "skipped",
    };
  }

  if (!expectedSku) {
    await recordSourceHealth(
      item.id,
      {
        status: "error",
        errorMessage:
          "Missing exact SKU/model",
      }
    );

    console.log(
      "⏭️ SKIP: exact SKU/model missing."
    );

    return {
      status: "skipped",
    };
  }

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });

    await page.waitForTimeout(5000);

    if (hostname === "mdcomputers.in") {
      await page
        .waitForFunction(
          () =>
            document.body.innerText.includes(
              "Offer Price"
            ) ||
            document.body.innerText.includes(
              "Availability"
            ),
          {
            timeout: 10_000,
          }
        )
        .catch(() => {});
    }

    const title =
      await page
        .title()
        .catch(() => "");

    const text =
      await page
        .locator("body")
        .innerText()
        .catch(() => "");

    const html =
      await page.content();

    if (isChallengePage(title, text)) {
      await recordSourceHealth(
        item.id,
        {
          status:
            "cloudflare_blocked",
          errorMessage:
            `Challenge page: ${
              title || "Cloudflare"
            }`,
        }
      );

      console.log(
        "🛑 SKIP: store blocked collector with Cloudflare/challenge page."
      );

      return {
        status: "skipped",
      };
    }

    if (
      !skuAppearsExactly({
        sku: expectedSku,
        text,
        html,
      })
    ) {
      await recordSourceHealth(
        item.id,
        {
          status: "sku_mismatch",
          errorMessage:
            `Exact SKU ${expectedSku} not found on loaded page`,
        }
      );

      console.log(
        "🛑 SKIP: exact SKU not found on loaded page."
      );

      console.log(
        `Page title: ${title}`
      );

      return {
        status: "skipped",
      };
    }

    const price =
      await detectSafePrice(
        page,
        hostname
      );

    const inStock =
      detectStock(
        text,
        html
      );

    if (price === null) {
      await recordSourceHealth(
        item.id,
        {
          status:
            "price_not_detected",
          errorMessage:
            "Exact SKU verified but price was not safely detected",
        }
      );

      console.log(
        "⚠️ SKIP WRITE: SKU verified, price not safely detected."
      );

      return {
        status: "skipped",
      };
    }

    const historyResult =
      await savePriceIfChanged({
        productId:
          item.product_id,

        sourceId:
          item.source_id,

        sourceName:
          item.source.name,

        price,

        inStock,
      });

    await recordSourceHealth(
      item.id,
      {
        status: "success",
        success: true,
        price,
        inStock,
      }
    );

    if (historyResult.inserted) {
      console.log(
        `✅ HISTORY SAVED: ₹${price.toLocaleString(
          "en-IN"
        )} • ${
          inStock
            ? "In stock"
            : "Out/unclear"
        } • ${
          historyResult.reason ===
          "first_observation"
            ? "first observation"
            : "price/stock changed"
        }`
      );

      return {
        status: "saved",
      };
    }

    console.log(
      `🟰 UNCHANGED: ₹${price.toLocaleString(
        "en-IN"
      )} • ${
        inStock
          ? "In stock"
          : "Out/unclear"
      } • health refreshed, history not duplicated`
    );

    return {
      status: "unchanged",
    };
  } catch (error) {
    const message =
      error?.message ||
      String(error);

    await recordSourceHealth(
      item.id,
      {
        status: "error",
        errorMessage:
          message.slice(
            0,
            1000
          ),
      }
    );

    console.log(
      `❌ ERROR: ${message}`
    );

    return {
      status: "error",
    };
  }
}

async function main() {
  console.log(
    "🚀 PC Market Tracker — Generic Collector + Source Health"
  );

  console.log(
    "Rule: exact SKU first; wrong price is worse than missing price.\n"
  );

  const items =
    await loadTrackedSources();

  if (items.length === 0) {
    console.log(
      "No active product_sources found."
    );

    return;
  }

  console.log(
    `Found ${items.length} active product source link(s).`
  );

  const browser =
    await chromium.launch({
      headless: true,
    });

  const context =
    await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36",

      viewport: {
        width: 1440,
        height: 1000,
      },

      locale: "en-IN",
    });

  const page =
    await context.newPage();

  const summary = {
    saved: 0,
    unchanged: 0,
    skipped: 0,
    error: 0,
  };

  try {
    for (const item of items) {
      const result =
        await collectOne(
          page,
          item
        );

      summary[result.status] += 1;

      await page.waitForTimeout(
        1200
      );
    }
  } finally {
    await browser.close();
  }

  console.log(
    "\n========================================"
  );

  console.log(
    "📊 Collector Summary"
  );

  console.log(
    `✅ History rows saved: ${summary.saved}`
  );

  console.log(
    `🟰 Unchanged (health only): ${summary.unchanged}`
  );

  console.log(
    `⏭️ Skipped: ${summary.skipped}`
  );

  console.log(
    `❌ Errors: ${summary.error}`
  );

  console.log(
    "========================================"
  );
}

main().catch((error) => {
  console.error(
    "\n💥 Fatal collector error:"
  );

  console.error(error);

  process.exit(1);
});