#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  ACTION_PAYLOAD_BASE,
  GatewayClient,
  ensureArray,
  loadDotEnv,
  normalizeLong,
  prepareOutputDir,
  resolveDimensionEntry,
  safeId,
  writeJson,
} from "./test-actions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadDotEnv(path.join(__dirname, ".env"));

const HOST = process.env.PROVIDER_HOST || "127.0.0.1";
const PORT = Number(process.env.PROVIDER_PORT || "28545");
const TOKEN = process.env.PROVIDER_TOKEN || "change-me";
const DIMENSION = process.env.PROVIDER_MTR_DIMENSION || "minecraft:overworld";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || "15000");
const ROUTES_OUTPUT_DIR = path.resolve(
  process.env.ROUTES_OUTPUT_DIR || path.join(__dirname, "output", "routes")
);

async function main() {
  console.log(`Connecting to ${HOST}:${PORT} (routes dump)...`);
  await prepareOutputDir(ROUTES_OUTPUT_DIR);
  const client = new GatewayClient({ host: HOST, port: PORT, token: TOKEN, timeoutMs: REQUEST_TIMEOUT_MS });
  try {
    await client.connect();
    const overview = await client.request("mtr:list_network_overview", {});
    const dimensionEntry = resolveDimensionEntry(overview, DIMENSION);
    const resolvedDimension = dimensionEntry?.dimension || DIMENSION || "";
    const routes = ensureArray(dimensionEntry?.routes);
    if (!routes.length) {
      throw new Error(`No routes found for dimension ${resolvedDimension || "(empty)"}`);
    }
    console.log(`Resolved dimension ${resolvedDimension} with ${routes.length} routes; dumping...`);
    const summary = [];
    let processed = 0;
    for (const route of routes) {
      const routeId = normalizeLong(route?.routeId);
      if (!routeId) {
        continue;
      }
      const detailFile = path.join(
        ROUTES_OUTPUT_DIR,
        `mtr_route_${safeId(routeId, routeId, "route")}_detail.json`
      );
      const trainsFile = path.join(
        ROUTES_OUTPUT_DIR,
        `mtr_route_${safeId(routeId, routeId, "route")}_trains.json`
      );
      const payload = {
        ...ACTION_PAYLOAD_BASE(resolvedDimension),
        routeId,
      };
      const detail = await client.request("mtr:get_route_detail", payload);
      await writeJson(detailFile, detail);
      if (detail?.result !== "OK") {
        console.warn(`Route ${routeId} detail responded with ${detail?.result}`);
      }
      const trains = await client.request("mtr:get_route_trains", payload);
      await writeJson(trainsFile, trains);
      if (trains?.result !== "OK") {
        console.warn(`Route ${routeId} trains responded with ${trains?.result}`);
      }
      summary.push({
        routeId,
        name: route?.name || null,
        detailFile: path.relative(ROUTES_OUTPUT_DIR, detailFile),
        trainsFile: path.relative(ROUTES_OUTPUT_DIR, trainsFile),
      });
      processed += 1;
    }
    await writeJson(path.join(ROUTES_OUTPUT_DIR, "routes_index.json"), {
      dimension: resolvedDimension,
      total: processed,
      routes: summary,
    });
    console.log(`Done. ${processed} route pages dumped to ${ROUTES_OUTPUT_DIR}`);
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
