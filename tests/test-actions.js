#!/usr/bin/env node
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadDotEnv(path.join(__dirname, ".env"));

const HOST = process.env.PROVIDER_HOST || "127.0.0.1";
const PORT = Number(process.env.PROVIDER_PORT || "28545");
const TOKEN = process.env.PROVIDER_TOKEN || "change-me";
const DIMENSION = process.env.PROVIDER_MTR_DIMENSION || "minecraft:overworld";
const ROUTE_ID = envLong("PROVIDER_ROUTE_ID");
const STATION_ID = envLong("PROVIDER_STATION_ID");
const PLATFORM_ID = envLong("PROVIDER_PLATFORM_ID");
const DEPOT_ID = envLong("PROVIDER_DEPOT_ID");
const NODE_LIMIT = Number(process.env.NODE_LIMIT || "512");
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || "15000");
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, "output"));
const SAMPLE_LIMIT = Number(process.env.SAMPLE_LIMIT || "5");

const ACTION_PAYLOAD_BASE = (dimension) => (dimension ? { dimension } : {});

async function main() {
  console.log(`Connecting to ${HOST}:${PORT} ...`);
  await prepareOutputDir(OUTPUT_DIR);
  const client = new GatewayClient({ host: HOST, port: PORT, token: TOKEN, timeoutMs: REQUEST_TIMEOUT_MS });
  try {
    await client.connect();

    await captureJson("beacon_ping.json", client.request("beacon:ping", { echo: "tests" }));

    const overview = await captureJson(
      "mtr_network_overview.json",
      client.request("mtr:list_network_overview", {})
    );

    const dimensionEntry = resolveDimensionEntry(overview, DIMENSION);
    const resolvedDimension = dimensionEntry?.dimension || DIMENSION || "";

    const stations = await captureJson(
      "mtr_stations.json",
      client.request("mtr:list_stations", ACTION_PAYLOAD_BASE(resolvedDimension))
    );

    const depots = await captureJson(
      "mtr_depots.json",
      client.request("mtr:list_depots", ACTION_PAYLOAD_BASE(resolvedDimension))
    );

    await captureJson(
      "mtr_fare_areas.json",
      client.request("mtr:list_fare_areas", ACTION_PAYLOAD_BASE(resolvedDimension))
    );

    const mergedDepots = mergeDepots(depots?.payload?.depots, dimensionEntry?.depots);

    await dumpNodes(client, resolvedDimension, NODE_LIMIT, OUTPUT_DIR);
    await dumpAllRouteData(client, resolvedDimension, ensureArray(dimensionEntry?.routes), OUTPUT_DIR);
    await dumpAllStationTimetablesFull(
      client,
      resolvedDimension,
      ensureArray(stations?.payload?.stations),
      OUTPUT_DIR
    );
    await dumpAllDepotTrainsFull(client, resolvedDimension, mergedDepots, OUTPUT_DIR);

    const autoSelection = selectTargets({
      dimension: resolvedDimension,
      overview,
      stations,
      depots,
      dimensionEntry,
      explicitRouteId: ROUTE_ID,
      explicitStationId: STATION_ID,
      explicitPlatformId: PLATFORM_ID,
      explicitDepotId: DEPOT_ID,
    });
    await writeJson(path.join(OUTPUT_DIR, "mtr_target_selection.json"), autoSelection.summary);

    if (autoSelection.routeId) {
      const routeDetail = await client.request("mtr:get_route_detail", {
        ...ACTION_PAYLOAD_BASE(resolvedDimension),
        routeId: autoSelection.routeId,
      });
      const routeDetailId = safeId(
        routeDetail?.payload?.routeId,
        autoSelection.routeId,
        "route"
      );
      await writeJson(
        path.join(OUTPUT_DIR, `mtr_route_${routeDetailId}_detail.json`),
        routeDetail
      );

      const routeTrains = await client.request("mtr:get_route_trains", {
        ...ACTION_PAYLOAD_BASE(resolvedDimension),
        routeId: autoSelection.routeId,
      });
      const routeTrainsId = safeId(
        routeTrains?.payload?.routeId,
        autoSelection.routeId,
        "route"
      );
      await writeJson(
        path.join(OUTPUT_DIR, `mtr_route_${routeTrainsId}_trains.json`),
        routeTrains
      );
    } else {
      console.warn("Skip route detail/trains: no routeId resolved.");
    }

    if (autoSelection.stationId) {
      const payload = {
        ...ACTION_PAYLOAD_BASE(resolvedDimension),
        stationId: autoSelection.stationId,
      };
      if (autoSelection.platformId) {
        payload.platformId = autoSelection.platformId;
      }
      const timetable = await client.request("mtr:get_station_timetable", payload);
      const stationIdForFile = safeId(
        timetable?.payload?.stationId,
        autoSelection.stationId,
        "station"
      );
      await writeJson(
        path.join(
          OUTPUT_DIR,
          `mtr_station_${stationIdForFile}_timetable.json`
        ),
        timetable
      );
    } else {
      console.warn("Skip station timetable: no stationId resolved.");
    }

    if (autoSelection.depotId) {
      const depotTrains = await client.request("mtr:get_depot_trains", {
        ...ACTION_PAYLOAD_BASE(resolvedDimension),
        depotId: autoSelection.depotId,
      });
      const depotIdForFile = safeId(
        depotTrains?.payload?.depotId,
        autoSelection.depotId,
        "depot"
      );
      await writeJson(
        path.join(OUTPUT_DIR, `mtr_depot_${depotIdForFile}_trains.json`),
        depotTrains
      );
    } else {
      console.warn("Skip depot trains: no depotId resolved.");
    }

    console.log(`Done. Files written to ${OUTPUT_DIR}`);
  } catch (err) {
    console.error("Test run failed:", err.message);
    process.exitCode = 1;
  } finally {
    client.close();
  }
}

class GatewayClient {
  constructor({ host, port, token, timeoutMs }) {
    this.host = host;
    this.port = port;
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.clientId = `beacon-tests-${process.pid}`;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ host: this.host, port: this.port }, () => {
        this._sendEnvelope("handshake", {
          protocolVersion: 1,
          clientId: this.clientId,
          token: this.token,
          capabilities: ["actions"],
        }, false);
      });

      this.socket.on("data", (chunk) => this._onData(chunk));
      this.socket.on("error", (err) => {
        if (!this.handshakeCompleted && !this.handshakeRejected) {
          reject(err);
          this.handshakeRejected = true;
        } else {
          console.error("Gateway socket error:", err.message);
        }
      });
      this.socket.on("close", () => {
        if (!this.handshakeCompleted && !this.handshakeRejected) {
          reject(new Error("Connection closed before handshake"));
          this.handshakeRejected = true;
        }
        for (const { reject } of this.pending.values()) {
          reject(new Error("Connection closed"));
        }
        this.pending.clear();
      });
      this.socket.setNoDelay(true);

      this.handshakeResolve = (info) => {
        this.handshakeCompleted = true;
        console.log(
          `Handshake OK (connectionId=${info.connectionId}, server=${info.serverName}, version=${info.modVersion})`
        );
        resolve();
      };
      this.handshakeReject = (err) => {
        if (!this.handshakeRejected) {
          this.handshakeRejected = true;
          reject(err);
        }
      };
    });
  }

  close() {
    if (this.socket) {
      this.socket.end();
      this.socket = undefined;
    }
  }

  request(action, payload = {}) {
    if (!this.connectionId) {
      throw new Error("Gateway handshake not completed");
    }
    const requestId = randomRequestId();
    const body = {
      protocolVersion: 1,
      requestId,
      action,
      payload,
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${action} (${requestId}) timed out`));
      }, this.timeoutMs);
      this.pending.set(requestId, {
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this._sendEnvelope("request", body, true);
    });
  }

  _sendEnvelope(type, body, attachConnection = true) {
    const envelope = {
      type,
      timestamp: Date.now(),
      body: body || {},
    };
    if (attachConnection && this.connectionId) {
      envelope.connectionId = this.connectionId;
    }
    const json = JSON.stringify(envelope);
    const frame = Buffer.alloc(4 + Buffer.byteLength(json));
    frame.writeUInt32BE(Buffer.byteLength(json), 0);
    frame.write(json, 4, "utf8");
    this.socket.write(frame);
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + length) {
        break;
      }
      const frame = this.buffer.slice(4, 4 + length);
      this.buffer = this.buffer.slice(4 + length);
      this._handleFrame(frame);
    }
  }

  _handleFrame(frameBuffer) {
    let envelope;
    try {
      envelope = JSON.parse(frameBuffer.toString("utf8"));
    } catch (err) {
      console.error("Invalid frame JSON:", err.message);
      return;
    }
    const { type, body } = envelope;
    if (type === "handshake_ack") {
      this.connectionId = body?.connectionId;
      this.handshakeCompleted = true;
      this.handshakeResolve?.(body || {});
      return;
    }
    if (type === "error") {
      const message = body?.message || "Unknown gateway error";
      console.warn(`Gateway error: ${body?.errorCode || "ERROR"} - ${message}`);
      if (!this.connectionId) {
        this.handshakeReject?.(new Error(message));
      }
      return;
    }
    if (type === "response") {
      const requestId = body?.requestId;
      if (requestId && this.pending.has(requestId)) {
        const pending = this.pending.get(requestId);
        this.pending.delete(requestId);
        pending.resolve(body);
      } else {
        console.warn(`Received response for unknown requestId: ${requestId}`);
      }
      return;
    }
    if (type === "pong") {
      return;
    }
  }
}

async function dumpNodes(client, dimension, limit, outDir) {
  let cursor;
  let page = 1;
  while (true) {
    const payload = {
      ...(dimension ? { dimension } : {}),
      ...(limit ? { limit } : {}),
      ...(cursor ? { cursor } : {}),
    };
    const response = await client.request("mtr:list_nodes_paginated", payload);
    const fileName = `mtr_nodes_page_${String(page).padStart(3, "0")}.json`;
    await writeJson(path.join(outDir, fileName), response);
    const nextCursor = response?.payload?.nextCursor;
    const hasMore = Boolean(response?.payload?.hasMore);
    if (!nextCursor || !hasMore || page >= SAMPLE_LIMIT) {
      break;
    }
    cursor = nextCursor;
    page += 1;
  }
}

async function dumpAllRouteData(client, dimension, routes, outDir) {
  let count = 0;
  for (const route of ensureArray(routes)) {
    const routeId = normalizeLong(route?.routeId);
    if (!routeId) {
      continue;
    }
    const detailTarget = path.join(outDir, `mtr_route_${routeId}_detail.json`);
    const detail = await client.request("mtr:get_route_detail", {
      ...ACTION_PAYLOAD_BASE(dimension),
      routeId,
    });
    await writeJson(detailTarget, detail);

    const trainsTarget = path.join(outDir, `mtr_route_${routeId}_trains.json`);
    const trains = await client.request("mtr:get_route_trains", {
      ...ACTION_PAYLOAD_BASE(dimension),
      routeId,
    });
    await writeJson(trainsTarget, trains);
    count += 1;
    if (count >= SAMPLE_LIMIT) {
      break;
    }
  }
}

async function dumpAllStationTimetablesFull(client, dimension, stations, outDir) {
  let count = 0;
  for (const station of ensureArray(stations)) {
    const stationId = normalizeLong(station?.stationId);
    if (!stationId) {
      continue;
    }
    const platforms = ensureArray(station?.platforms);
    if (platforms.length === 0) {
      const fileName = `mtr_station_${stationId}_timetable.json`;
      const res = await client.request("mtr:get_station_timetable", {
        ...ACTION_PAYLOAD_BASE(dimension),
        stationId,
      });
      await writeJson(path.join(outDir, fileName), res);
      count += 1;
      if (count >= SAMPLE_LIMIT) {
        break;
      }
      continue;
    }
    for (const platform of platforms) {
      const platformId = normalizeLong(platform?.platformId);
      if (!platformId) {
        continue;
      }
      const fileName = `mtr_station_${stationId}_platform_${platformId}_timetable.json`;
      const res = await client.request("mtr:get_station_timetable", {
        ...ACTION_PAYLOAD_BASE(dimension),
        stationId,
        platformId,
      });
      await writeJson(path.join(outDir, fileName), res);
      count += 1;
      if (count >= SAMPLE_LIMIT) {
        break;
      }
    }
    if (count >= SAMPLE_LIMIT) {
      break;
    }
  }
}

async function dumpAllDepotTrainsFull(client, dimension, depots, outDir) {
  let count = 0;
  for (const depot of ensureArray(depots)) {
    const depotId = normalizeLong(depot?.depotId);
    if (!depotId) {
      continue;
    }
    const fileName = `mtr_depot_${depotId}_trains.json`;
    const res = await client.request("mtr:get_depot_trains", {
      ...ACTION_PAYLOAD_BASE(dimension),
      depotId,
    });
    await writeJson(path.join(outDir, fileName), res);
    count += 1;
    if (count >= SAMPLE_LIMIT) {
      break;
    }
  }
}

function selectTargets({
  dimension,
  overview,
  stations,
  depots,
  dimensionEntry,
  explicitRouteId,
  explicitStationId,
  explicitPlatformId,
  explicitDepotId,
}) {
  const resolvedEntry = dimensionEntry || resolveDimensionEntry(overview, dimension);

  const routeId = normalizeLong(explicitRouteId) ?? pickRouteId(resolvedEntry);
  const stationInfo = pickStationInfo(stations?.payload?.stations, routeId);
  const depotId =
    normalizeLong(explicitDepotId) ??
    pickDepotId(depots?.payload?.depots, resolvedEntry?.depots, routeId);

  return {
    summary: {
      dimensionRequested: dimension,
      dimensionResolved: resolvedEntry?.dimension || null,
      routeId: routeId || null,
      stationId: normalizeLong(explicitStationId) ?? stationInfo.stationId ?? null,
      platformId: normalizeLong(explicitPlatformId) ?? stationInfo.platformId ?? null,
      depotId: depotId || null,
    },
    routeId,
    stationId: normalizeLong(explicitStationId) ?? stationInfo.stationId,
    platformId: normalizeLong(explicitPlatformId) ?? stationInfo.platformId,
    depotId,
  };
}

function pickRouteId(dimensionEntry) {
  const routes = ensureArray(dimensionEntry?.routes);
  if (!routes.length) {
    return undefined;
  }
  const visible = routes.find((route) => route && route.hidden === false);
  return normalizeLong((visible || routes[0])?.routeId);
}

function pickStationInfo(stations, preferredRouteId) {
  const list = ensureArray(stations);
  if (!list.length) {
    return { stationId: undefined, platformId: undefined };
  }
  if (preferredRouteId) {
    for (const station of list) {
      const platform = pickPlatformForRoute(station, preferredRouteId);
      if (platform) {
        return {
          stationId: normalizeLong(station.stationId),
          platformId: normalizeLong(platform.platformId),
        };
      }
    }
  }
  const first = list.find((station) => ensureArray(station.platforms).length > 0) || list[0];
  const fallbackPlatform = ensureArray(first.platforms)[0];
  return {
    stationId: normalizeLong(first?.stationId),
    platformId: normalizeLong(fallbackPlatform?.platformId),
  };
}

function pickPlatformForRoute(station, preferredRouteId) {
  const platforms = ensureArray(station?.platforms);
  if (!platforms.length) {
    return undefined;
  }
  const matched = platforms.find((platform) =>
    ensureArray(platform?.routeIds).some(
      (routeId) => normalizeLong(routeId) === normalizeLong(preferredRouteId)
    )
  );
  return matched || platforms[0];
}

function pickDepotId(primaryDepots, secondaryDepots, preferredRouteId) {
  const merged = mergeDepots(primaryDepots, secondaryDepots);
  if (!merged.length) {
    return undefined;
  }
  if (preferredRouteId) {
    const match = merged.find((depot) =>
      ensureArray(depot?.routeIds).some(
        (routeId) => normalizeLong(routeId) === normalizeLong(preferredRouteId)
      )
    );
    if (match) {
      return match.depotId;
    }
  }
  return merged[0]?.depotId;
}

function mergeDepots(primary, secondary) {
  const merged = [];
  const seen = new Set();
  for (const candidate of [...ensureArray(primary), ...ensureArray(secondary)]) {
    if (!candidate) {
      continue;
    }
    const depotId = normalizeLong(candidate.depotId);
    if (depotId === undefined || seen.has(depotId)) {
      continue;
    }
    seen.add(depotId);
    merged.push({ ...candidate, depotId });
  }
  return merged;
}

function safeId(preferredValue, fallbackValue, label) {
  const raw =
    preferredValue !== undefined && preferredValue !== null && preferredValue !== ""
      ? preferredValue
      : fallbackValue;
  if (raw === undefined || raw === null || raw === "") {
    return `${label || "unknown"}`;
  }
  return String(raw).replace(/[^0-9A-Za-z_\-]/g, "_");
}

function normalizeLong(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function resolveDimensionEntry(overview, dimension) {
  const dimensions = ensureArray(overview?.payload?.dimensions);
  return (
    dimensions.find((entry) => !dimension || entry?.dimension === dimension) ||
    dimensions[0] ||
    {}
  );
}

async function captureJson(fileName, promise) {
  const data = await promise;
  await writeJson(path.join(OUTPUT_DIR, fileName), data);
  return data;
}

async function prepareOutputDir(dir) {
  if (fs.existsSync(dir)) {
    const entries = await fs.promises.readdir(dir);
    await Promise.all(entries.map((entry) => fs.promises.rm(path.join(dir, entry), { recursive: true, force: true })));
  } else {
    await fs.promises.mkdir(dir, { recursive: true });
  }
}

async function writeJson(target, data) {
  const payload = {
    timestamp: new Date().toISOString(),
    data: data === undefined ? null : data,
  };
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`Wrote ${target}`);
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function randomRequestId() {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.randomBytes(12);
  let result = "";
  for (let i = 0; i < 12; i += 1) {
    result += alphabet[bytes[i] % alphabet.length];
  }
  return result;
}

function envLong(name) {
  const value = process.env[name];
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be numeric`);
  }
  return parsed;
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith("#")) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = value;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
