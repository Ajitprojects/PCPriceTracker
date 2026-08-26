import "dotenv/config";
import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";

const PRODUCT_ID = 1;
const SOURCE_ID = 8;

const URL =
  "https://www.nehruplacemarket.com/price-list/graphicscard-price-list.html";

const EXPECTED_NAME = "Gigabyte 5070 Windforce OC SFF";

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
  console.log("Fetching Nehru Place RTX 5070...");

  const response = await fetch(URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Nehru Place HTTP error: ${response.status}`
    );
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  let found = null;
  let lastSeller = null;

  $("tr").each((_, row) => {
    const cells = $(row)
      .find("td")
      .map((_, cell) =>
        $(cell).text().replace(/\s+/g, " ").trim()
      )
      .get();

    if (cells.length < 5) return;

    const name = cells[1];
    const description = cells[2];
    const priceText = cells[3];
    const sellerText = cells[4];

    if (
      sellerText &&
      sellerText !== '"'
    ) {
      lastSeller = sellerText;
    }

    const combined =
      `${name} ${description}`.toLowerCase();

    if (
      combined.includes(
        EXPECTED_NAME.toLowerCase()
      )
    ) {
      found = {
        name,
        description,
        price: Number(
          priceText.replace(/,/g, "")
        ),
        seller:
          sellerText === '"'
            ? lastSeller
            : sellerText,
      };
    }
  });

  if (!found) {
    throw new Error(
      `Exact model-name match not found: ${EXPECTED_NAME}`
    );
  }

  if (
    !Number.isFinite(found.price) ||
    found.price < 20000 ||
    found.price > 200000
  ) {
    throw new Error(
      `Suspicious local price: ${found.price}`
    );
  }

  console.log("Matched:", found.name);
  console.log("Price found:", found.price);
  console.log("Seller:", found.seller);

  const { error: insertError } =
    await supabase
      .from("price_history")
      .insert({
        product_id: PRODUCT_ID,
        source_type: "local",
        source_name: "Avika Retails",
        source_id: SOURCE_ID,
        price: found.price,
        in_stock: true,
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