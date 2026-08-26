import { spawn } from "node:child_process";

const scripts = [
  "scripts/collectVedant.mjs",
  "scripts/collectMDComputers.mjs",
  "scripts/collectMDComputers5060.mjs",
  "scripts/collectComputech5060.mjs",
  "scripts/collectNehruPlace5070.mjs",

  "scripts/collectMDComputersMarketRAM.mjs",
  "scripts/collectVedantMarketRAM.mjs",
  "scripts/collectMDComputersSN7100.mjs",
"scripts/collectVedantSN7100.mjs",
];

function runScript(script) {
  return new Promise((resolve, reject) => {
    console.log(`\nRunning ${script}...`);

    const child = spawn(
      process.execPath,
      [script],
      {
        stdio: "inherit",
        shell: false,
      }
    );

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(`${script} exited with code ${code}`)
        );
      }
    });

    child.on("error", reject);
  });
}

async function main() {
  console.log("=== PC Market Price Collection Started ===");

  for (const script of scripts) {
    try {
      await runScript(script);
    } catch (error) {
      console.error(
        `Failed: ${script}`,
        error
      );
    }
  }

  console.log("\n=== Collection Finished ===");
}

main();