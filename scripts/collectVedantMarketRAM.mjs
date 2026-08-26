import "dotenv/config";
import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";

const PRODUCT_ID = 2;
const EXPECTED_MODEL = "CMK32GX5M2E6000C36";

const PRODUCT_URL =
  "https://www.vedantcomputers.com/index.php?pc_builder_component_id=10&product_id=6894&route=extension%2Fpc_builder%2Fpc_builder_product";
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
  console.log("Fetching Vedant Market RAM...");

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
      `Wrong RAM page. Expected SKU: ${EXPECTED_MODEL}`
    );
  }

const priceMatches = [
  ...bodyText.matchAll(
    /₹\s*([\d,]+(?:\.\d{2})?)/g
  ),
].map((match) =>
  Number(match[1].replace(/,/g, ""))
);

// Valid RAM-price range only
const validPrices = priceMatches.filter(
  (price) => price >= 2000 && price <= 100000
);

if (validPrices.length === 0) {
  throw new Error(
    "Vedant RAM price not found"
  );
}

console.log(
  "Vedant prices found:",
  validPrices
);

const mainProductPrices = validPrices.slice(0, 2);

if (mainProductPrices.length < 2) {
  throw new Error(
    `Could not identify Vedant main product prices: ${validPrices}`
  );
}

console.log(
  "Main product prices:",
  mainProductPrices
);

const price = Math.min(...mainProductPrices);


  if (price < 2000 || price > 100000) {
    throw new Error(
      `Suspicious Vedant RAM price: ${price}`
    );
  }

  const lowerText = bodyText.toLowerCase();

  const inStock =
    !lowerText.includes("out of stock") &&
    (
      lowerText.includes("in stock") ||
      lowerText.includes("add to cart")
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