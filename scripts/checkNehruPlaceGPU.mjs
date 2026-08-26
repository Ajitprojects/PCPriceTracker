import * as cheerio from "cheerio";

const URL =
  "https://www.nehruplacemarket.com/price-list/graphicscard-price-list.html";

async function checkPrices() {
  console.log("Fetching Nehru Place GPU prices...");

  const response = await fetch(URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const matches = [];

  $("tr").each((_, row) => {
    const cells = $(row)
      .find("td")
      .map((_, cell) =>
        $(cell).text().replace(/\s+/g, " ").trim()
      )
      .get();

    if (cells.length < 4) return;

    const rowText = cells.join(" ").toLowerCase();

    if (
      rowText.includes("5070") ||
      rowText.includes("5060")
    ) {
      matches.push(cells);
    }
  });

  console.log(`Found ${matches.length} matching rows\n`);

  for (const row of matches) {
    console.log("-------------------------");
    console.log(row);
  }
}

checkPrices().catch((error) => {
  console.error("Failed ❌");
  console.error(error);
});