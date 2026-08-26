import "dotenv/config";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const PRODUCT_ID = 1;

const PRODUCT_URL =
  "https://mdcomputers.in/product/gigabyte-windforce-oc-graphics-card-gv-n5070wf3oc-12gd";

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
  console.log("Opening MDComputers...");

  const browser = await chromium.launch({
    headless: true,
  });

  const page = await browser.newPage({
    viewport: {
      width: 1366,
      height: 900,
    },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
  });

  try {
    await page.goto(PRODUCT_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(4000);

    const bodyText = (
      await page.locator("body").innerText()
    ).replace(/\s+/g, " ");

    const offerMatch = bodyText.match(
      /Offer Price\s*₹\s*([\d,]+(?:\.\d{2})?)/i
    );

    if (!offerMatch) {
      throw new Error(
        "MDComputers Offer Price not found"
      );
    }

    const price = Number(
      offerMatch[1].replace(/,/g, "")
    );

    if (price < 10000 || price > 300000) {
      throw new Error(
        `Suspicious MDComputers price: ${price}`
      );
    }

    const inStock =
      bodyText.toLowerCase().includes("in stock") &&
      !bodyText.toLowerCase().includes("out of stock");

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