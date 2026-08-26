import "dotenv/config";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const PRODUCT_ID = 3;
const EXPECTED_MODEL = "WDS200T4X0E";

const PRODUCT_URL =
  "https://mdcomputers.in/product/storage/ssd-drive/gen4-ssd/wd-black-sn7100-2tb-nvme-ssd-wds200t4x0e?limit=75";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Supabase environment variables missing");
}

const supabase = createClient(
  supabaseUrl,
  supabaseKey
);

async function collectPrice() {
  console.log("Opening MDComputers SN7100 2TB...");

  const browser = await chromium.launch({
    headless: true,
  });

  try {
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
    });

    await page.goto(PRODUCT_URL, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    await page.waitForSelector("body", {
      timeout: 15000,
    });

    const bodyText = (
      await page.locator("body").innerText()
    ).replace(/\s+/g, " ");

    if (
      !bodyText
        .toLowerCase()
        .includes(EXPECTED_MODEL.toLowerCase())
    ) {
      throw new Error(
        `Wrong SSD page. Expected SKU: ${EXPECTED_MODEL}`
      );
    }

    const offerMatch = bodyText.match(
      /Offer Price\s*₹\s*([\d,]+(?:\.\d{2})?)/i
    );

    if (!offerMatch) {
      throw new Error(
        "MDComputers SSD Offer Price not found"
      );
    }

    const price = Number(
      offerMatch[1].replace(/,/g, "")
    );

    if (price < 10000 || price > 100000) {
      throw new Error(
        `Suspicious SSD price: ${price}`
      );
    }

    const lowerText = bodyText.toLowerCase();

    const inStock =
      lowerText.includes("availability: in stock") ||
      lowerText.includes("add to cart");

    console.log("SKU verified:", EXPECTED_MODEL);
    console.log("Price found:", price);
    console.log("In stock:", inStock);

    const { data: source, error: sourceError } =
      await supabase
        .from("sources")
        .select("id")
        .eq("name", "MDComputers")
        .single();

    if (sourceError) {
      throw sourceError;
    }

    const { error: insertError } =
      await supabase
        .from("price_history")
        .insert({
          product_id: PRODUCT_ID,
          source_type: "online",
          source_name: "MDComputers",
          source_id: source.id,
          price,
          in_stock: inStock,
          match_confidence: "exact_sku",
        });

    if (insertError) {
      throw insertError;
    }

    console.log("Saved to Supabase ✅");
  } finally {
    await browser.close();
  }
}

collectPrice().catch((error) => {
  console.error("Collector failed ❌");
  console.error(error);
  process.exit(1);
});