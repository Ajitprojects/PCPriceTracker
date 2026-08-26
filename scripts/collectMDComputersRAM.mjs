import "dotenv/config";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const PRODUCT_ID = 2;

const PRODUCT_URL =
  "https://mdcomputers.in/product/teamgroup-ram-t-force-delta-rgb-ff3d532g6000hc38a01";

const EXPECTED_MODEL = "FF3D532G6000HC38A01";

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
  console.log("Opening MDComputers RAM...");

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

    if (
      !bodyText
        .toLowerCase()
        .includes(EXPECTED_MODEL.toLowerCase())
    ) {
      throw new Error(
        `Wrong RAM product page. Expected model: ${EXPECTED_MODEL}`
      );
    }

    const offerMatch = bodyText.match(
      /Offer Price\s*₹\s*([\d,]+(?:\.\d{2})?)/i
    );

    if (!offerMatch) {
      throw new Error(
        "MDComputers RAM Offer Price not found"
      );
    }

    const price = Number(
      offerMatch[1].replace(/,/g, "")
    );

    if (price < 1000 || price > 100000) {
      throw new Error(
        `Suspicious RAM price: ${price}`
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