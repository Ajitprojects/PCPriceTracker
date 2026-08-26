import "dotenv/config";
import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";

const PRODUCT_ID = 3;
const EXPECTED_MODEL = "WDS200T4X0E";

const PRODUCT_URL =
  "https://www.vedantcomputers.com/wd-black-sn7100-2tb-wds200t4x0e";

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
  console.log("Fetching Vedant SN7100 2TB...");

  const response = await fetch(PRODUCT_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Vedant HTTP error: ${response.status}`
    );
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const bodyText = $("body")
    .text()
    .replace(/\s+/g, " ");

  if (
    !bodyText
      .toLowerCase()
      .includes(EXPECTED_MODEL.toLowerCase())
  ) {
    throw new Error(
      `Wrong SSD page. Expected SKU: ${EXPECTED_MODEL}`
    );
  }

  let price = null;

  // Preferred selector first
  const selectorPrice = $(".product-price-new")
    .first()
    .text()
    .trim();

  const selectorMatch = selectorPrice.match(
    /₹\s*([\d,]+(?:\.\d{2})?)/
  );

  if (selectorMatch) {
    price = Number(
      selectorMatch[1].replace(/,/g, "")
    );
  }

  // Fallback: page text
  if (price === null) {
    const priceMatches = [
      ...bodyText.matchAll(
        /₹\s*([\d,]+(?:\.\d{2})?)/g
      ),
    ].map((match) =>
      Number(match[1].replace(/,/g, ""))
    );

    const validPrices = priceMatches.filter(
      (value) =>
        value >= 10000 &&
        value <= 100000
    );

    console.log(
      "Vedant prices found:",
      validPrices
    );

    if (validPrices.length === 0) {
      throw new Error(
        "Vedant SSD price not found"
      );
    }

    // Main product normally appears first with MRP + selling price.
    const mainProductPrices =
      validPrices.slice(0, 2);

    if (mainProductPrices.length < 2) {
      throw new Error(
        `Could not identify main SSD prices: ${validPrices}`
      );
    }

    console.log(
      "Main product prices:",
      mainProductPrices
    );

    price = Math.min(
      ...mainProductPrices
    );
  }

  if (
    price < 10000 ||
    price > 100000
  ) {
    throw new Error(
      `Suspicious Vedant SSD price: ${price}`
    );
  }

  const lowerText = bodyText.toLowerCase();

  const inStock =
    !lowerText.includes("out of stock") &&
    (
      lowerText.includes("in stock") ||
      lowerText.includes("add to cart")
    );

  console.log(
    "SKU verified:",
    EXPECTED_MODEL
  );
  console.log("Price found:", price);
  console.log("In stock:", inStock);

  const { data: source, error: sourceError } =
    await supabase
      .from("sources")
      .select("id")
      .eq("name", "Vedant Computers")
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
        source_name: "Vedant Computers",
        source_id: source.id,
        price,
        in_stock: inStock,
        match_confidence: "exact_sku",
      });

  if (insertError) {
    throw insertError;
  }

  console.log("Saved to Supabase ✅");
}

collectPrice().catch((error) => {
  console.error("Collector failed ❌");
  console.error(error);
  process.exit(1);
});