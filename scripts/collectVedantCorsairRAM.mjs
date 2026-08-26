import "dotenv/config";
import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";

const PRODUCT_ID = 2;
const EXPECTED_MODEL = "CMH32GX5M2B6000C30";

const PRODUCT_URL =
  "https://www.vedantcomputers.com/corsair-vengeance-rgb-32gb-ddr5-6000mhz-cmh32gx5m2b6000c30";

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
  console.log("Fetching Vedant Corsair RAM...");

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

  const priceText = $(".product-price-new")
    .first()
    .text()
    .trim();

  const match = priceText.match(
    /₹\s*([\d,]+(?:\.\d{2})?)/
  );

  if (!match) {
    throw new Error(
      "Vedant RAM price not found"
    );
  }

  const price = Number(
    match[1].replace(/,/g, "")
  );

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