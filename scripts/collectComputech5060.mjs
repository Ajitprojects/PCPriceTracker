import "dotenv/config";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const PRODUCT_ID = 5;
const EXPECTED_MODEL = "G5060-8GC";

const PRODUCT_URL =
  "https://computechstore.in/product/msi-rtx-5060-gaming-oc-8gb/";

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
  console.log("Opening Computech...");

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
 let loaded = false;

for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    console.log(`Computech load attempt ${attempt}...`);

    await page.goto(PRODUCT_URL, {
      waitUntil: "commit",
      timeout: 30000,
    });

    await page.waitForTimeout(5000);

    loaded = true;
    break;
  } catch (error) {
    console.log(
      `Computech load attempt ${attempt} failed:`,
      error.message
    );

    if (attempt < 3) {
      await page.waitForTimeout(3000);
    }
  }
}

if (!loaded) {
  throw new Error(
    "Computech page failed to load after 3 attempts"
  );
}

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
        `Wrong product page. Expected SKU: ${EXPECTED_MODEL}`
      );
    }

    const match = bodyText.match(
      /₹\s*([\d,]+(?:\.\d{2})?)\s*Save Extra/i
    );

    if (!match) {
      throw new Error(
        "Computech current product price not found"
      );
    }

    const price = Number(
      match[1].replace(/,/g, "")
    );

    if (price < 10000 || price > 300000) {
      throw new Error(
        `Suspicious Computech price: ${price}`
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
        .eq("name", "Computech Store")
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
          source_name: "Computech Store",
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