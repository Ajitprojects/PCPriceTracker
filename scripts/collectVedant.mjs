import "dotenv/config";
import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";

const PRODUCT_ID = 1;

const PRODUCT_URL =
  "https://www.vedantcomputers.com/gigabyte-rtx-5070-gv-n5070wf3oc-12gd";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Supabase environment variables missing");
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function collectPrice() {
  console.log("Fetching Vedant...");

  const response = await fetch(PRODUCT_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
      Accept: "text/html",
    },
  });

  if (!response.ok) {
    throw new Error(`Vedant request failed: ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const pageText = $("body")
    .text()
    .replace(/\s+/g, " ");

  const priceText = $(".product-price-new")
    .first()
    .text()
    .trim();

  const match = priceText.match(
    /₹\s*([\d,]+(?:\.\d{2})?)/
  );

  if (!match) {
    throw new Error("Vedant main product price not found");
  }

  const price = Number(
    match[1].replace(/,/g, "")
  );

  if (price < 10000 || price > 300000) {
    throw new Error(`Suspicious Vedant price: ${price}`);
  }

  const inStock =
    pageText.toLowerCase().includes("in stock") &&
    !pageText.toLowerCase().includes("out of stock");

  console.log("Price found:", price);
  console.log("In stock:", inStock);

  // TEST ONLY FOR NOW
  // Do not save until price is verified.


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