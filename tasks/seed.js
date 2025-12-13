// tasks/seed.js
// Seed script that pulls 4 open-data datasets (stations, elevators, APS, curb ramps),
// cleans them, and writes them into MongoDB.
//
// Key improvements:
// - Elevator docs reliably include location so /explore can plot them.
// - Elevators include a simple riskScore derived from availabilityPct (null if availability is missing).
// - Stations include hasNearbyAPS, precomputed at seed time (default radius 250m).

import fetch from 'node-fetch';
import { parse as parseCsv } from 'csv-parse/sync';
import { getDb, closeConnection } from '../config/mongoConnection.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);

// -----------------------------------------------------------------------------
// Public CSV endpoints for the 4 datasets.
// -----------------------------------------------------------------------------
const DATA_URLS = {
  stations: 'https://data.ny.gov/api/views/39hk-dx4f/rows.csv?accessType=DOWNLOAD',
  elevators: 'https://data.ny.gov/api/views/rc78-7x78/rows.csv?accessType=DOWNLOAD',
  aps: 'https://data.cityofnewyork.us/api/views/de3m-c5p4/rows.csv?accessType=DOWNLOAD',
  curbRamps: 'https://data.cityofnewyork.us/api/views/ufzp-rrqu/rows.csv?accessType=DOWNLOAD'
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
async function fetchCsvRows(url, label) {
  console.log(`Fetching ${label} from ${url} ...`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch ${label}: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  const rows = parseCsv(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  console.log(`${label}: fetched ${rows.length} rows`);
  return rows;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Converts availability percentage into a simple risk score in [0, 100].
// Higher availability => lower risk.
// Example: availability 95% -> riskScore 5.
function computeRiskScoreFromAvailability(availabilityPct) {
  const pct = Number(availabilityPct);
  if (!Number.isFinite(pct)) return null;

  const clamped = Math.max(0, Math.min(100, pct));
  return Math.round(100 - clamped);
}

const toRad = (deg) => (deg * Math.PI) / 180;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Sets station.hasNearbyAPS = true if any APS point is within radiusMeters.
function annotateStationsHasNearbyAPS(stationDocs, apsDocs, radiusMeters = 250) {
  const apsPoints = apsDocs
    .map((a) => ({
      lat: Number(a?.location?.lat),
      lng: Number(a?.location?.lng)
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  for (const s of stationDocs) {
    const lat = Number(s?.location?.lat);
    const lng = Number(s?.location?.lng);

    s.hasNearbyAPS = false;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    for (const p of apsPoints) {
      if (haversineMeters(lat, lng, p.lat, p.lng) <= radiusMeters) {
        s.hasNearbyAPS = true;
        break;
      }
    }
  }
}

// Case-insensitive + trim header matching
function pickFieldCI(row, candidates = []) {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const target = String(cand).trim().toLowerCase();
    const key = keys.find((k) => String(k).trim().toLowerCase() === target);
    if (key && row[key] !== undefined && row[key] !== '') return row[key];
  }
  return null;
}

// Extract latitude/longitude from a row, optionally parsing POINT (lon lat).
function extractLatLng(row, options = {}) {
  const { latKeys = [], lngKeys = [], geoKey = null } = options;
  const allKeys = Object.keys(row);

  function pickNumberByKeys(candidates, fallbackRegex) {
    for (const cand of candidates) {
      const key = allKeys.find((k) => k.toLowerCase() === String(cand).toLowerCase());
      if (key && row[key] !== undefined && row[key] !== '') {
        const v = toNumber(row[key]);
        if (v !== null) return v;
      }
    }
    if (fallbackRegex) {
      const key = allKeys.find((k) => fallbackRegex.test(k.toLowerCase()));
      if (key && row[key] !== undefined && row[key] !== '') {
        const v = toNumber(row[key]);
        if (v !== null) return v;
      }
    }
    return null;
  }

  let lat = pickNumberByKeys(latKeys, /lat/);
  let lng = pickNumberByKeys(lngKeys, /(lon|lng|long)/);

  if ((lat === null || lng === null) && geoKey && row[geoKey]) {
    const m = String(row[geoKey]).match(/POINT\s*\(([-0-9.]+)\s+([-0-9.]+)\)/i);
    if (m) {
      lng = toNumber(m[1]);
      lat = toNumber(m[2]);
    }
  }

  if (lat === null || lng === null) return null;
  return { lat, lng };
}

function dedupeByKey(docs, keyFn) {
  const seen = new Set();
  const out = [];
  let dropped = 0;

  for (const d of docs) {
    const k = keyFn(d);
    if (!k) continue;
    if (seen.has(k)) {
      dropped++;
      continue;
    }
    seen.add(k);
    out.push(d);
  }

  return { docs: out, dropped };
}

function normStr(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function cleanStationName(name) {
  return String(name || '')
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .trim();
}

function normStationKey(name) {
  return cleanStationName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normBorough(b) {
  const x = normStr(b);
  if (!x) return '';

  if (x === 'm' || x === 'mn' || x.startsWith('manh')) return 'manhattan';
  if (x === 'bk' || x.startsWith('brook')) return 'brooklyn';
  if (x === 'bx' || x.startsWith('bronx')) return 'bronx';
  if (x === 'q' || x === 'qn' || x.startsWith('que')) return 'queens';
  if (x === 'si' || x.startsWith('stat')) return 'staten island';

  return x;
}

// -----------------------------------------------------------------------------
// Stations mapping
// -----------------------------------------------------------------------------
function mapAdaStatus(rawAda) {
  const n = Number(rawAda);
  if (n === 1) return 'accessible';
  if (n === 2) return 'partiallyAccessible';
  return 'notAccessible';
}

function buildStationDocs(csvRows) {
  return csvRows
    .map((row) => {
      const stationId = pickFieldCI(row, ['Station ID']);
      const division = pickFieldCI(row, ['Division']);
      const line = pickFieldCI(row, ['Line']);
      const stationName = pickFieldCI(row, ['Stop Name']);
      const borough = pickFieldCI(row, ['Borough']);

      const loc = extractLatLng(row, {
        latKeys: ['GTFS Latitude', 'Station Latitude', 'Latitude'],
        lngKeys: ['GTFS Longitude', 'Station Longitude', 'Longitude']
      });

      const adaStatus = mapAdaStatus(pickFieldCI(row, ['ADA']));

      const routesString = pickFieldCI(row, ['Daytime Routes']) || '';
      const daytimeRoutes = String(routesString)
        .split(/\s+/)
        .map((r) => r.trim())
        .filter((r) => r.length > 0);

      if (!stationId || !loc) return null;

      return {
        stationId: String(stationId).trim(),
        division: division || null,
        line: line || null,
        stationName: stationName || null,
        daytimeRoutes,
        location: loc,
        adaStatus,
        borough: borough || null,
        hasNearbyAPS: false
      };
    })
    .filter(Boolean);
}

function buildStationLookups(stationDocs) {
  const byStationId = new Map();
  const byNameBorough = new Map();
  const byNameOnly = new Map();

  for (const s of stationDocs) {
    if (s?.stationId && s?.location) {
      byStationId.set(String(s.stationId), s);
    }

    const nameKey = normStationKey(s?.stationName);
    const boro = normBorough(s?.borough);

    if (nameKey) {
      if (!byNameOnly.has(nameKey)) byNameOnly.set(nameKey, s);
      if (boro) {
        const key = `${nameKey}|${boro}`;
        if (!byNameBorough.has(key)) byNameBorough.set(key, s);
      }
    }
  }

  return { byStationId, byNameBorough, byNameOnly };
}

// -----------------------------------------------------------------------------
// Elevators mapping (with reliable location backfill)
// -----------------------------------------------------------------------------
function buildElevatorDocs(csvRows, stationLookups) {
  const { byStationId, byNameBorough, byNameOnly } = stationLookups;

  const bestByEquipment = new Map();

  let mappedDirect = 0;
  let mappedByStationId = 0;
  let mappedByNameBorough = 0;
  let mappedByNameOnly = 0;
  let skippedNoLoc = 0;

  for (const row of csvRows) {
    const cols = Object.keys(row);

    const equipmentId =
      pickFieldCI(row, ['Equipment Code', 'equipment_code', 'Equipment ID', 'equipment_id', 'Equipment', 'equipment']) ??
      null;

    const borough = pickFieldCI(row, ['Borough', 'borough', 'Boro', 'boro']);
    const monthRaw = pickFieldCI(row, ['Month Beginning', 'month_beginning', 'Month', 'month']);

    // Keep ONLY elevators (drop escalators) if the column exists.
    const equipmentType = pickFieldCI(row, ['Equipment Type', 'equipment_type']);
    if (equipmentType && String(equipmentType).trim().toLowerCase() !== 'elevator') {
      continue;
    }

    // rc78-7x78 uses Station MRN; stations dataset's "Station ID" is MRN.
    const stationMrn = pickFieldCI(row, ['Station MRN', 'station_mrn']);

    const stationName = pickFieldCI(row, ['Station Name', 'station_name', 'Station', 'Stop Name', 'stop_name']);

    if (!equipmentId || !monthRaw) continue;

    const monthDate = new Date(monthRaw);
    if (Number.isNaN(monthDate.getTime())) continue;

    let availabilityPct = toNumber(
      pickFieldCI(row, [
        '24-Hour Availability',
        '24_hour_availability',
        'AM Peak Availability',
        'am_peak_availability',
        'Percent Availability',
        '% Availability',
        'Percent of time in service',
        'percent_of_time_in_service'
      ])
    );

    // Normalize: if the source provides 0-1, convert to percent.
    if (availabilityPct !== null && availabilityPct <= 1) availabilityPct *= 100;

    const availabilityMissing = availabilityPct === null;

    // Use a fallback ONLY for status derivation (do not store fake 100% when missing).
    const availabilityForStatus = availabilityMissing ? 100 : availabilityPct;

    // Only compute riskScore when availability exists in source.
    const riskScore = availabilityMissing ? null : computeRiskScoreFromAvailability(availabilityPct);

    // 1) direct lat/lng if present (rare in this dataset, but keep)
    let loc = extractLatLng(row, {
      latKeys: ['GTFS Latitude', 'Latitude', 'lat', 'LAT'],
      lngKeys: ['GTFS Longitude', 'Longitude', 'lon', 'lng', 'LON'],
      geoKey: cols.find((k) => k.toLowerCase().includes('geom')) || null
    });

    let matchedStation = null;
    if (loc) mappedDirect++;

    // 2) Station MRN -> stations.stationId
    if (!loc && stationMrn) {
      const sid = String(stationMrn).trim();
      matchedStation = byStationId.get(sid) || null;
      loc = matchedStation?.location || null;
      if (loc) mappedByStationId++;
    }

    // 3) stationName + borough
    const nameKey = stationName ? normStationKey(stationName) : '';
    const boroKey = borough ? normBorough(borough) : '';

    if (!loc && nameKey && boroKey) {
      matchedStation = byNameBorough.get(`${nameKey}|${boroKey}`) || null;
      loc = matchedStation?.location || null;
      if (loc) mappedByNameBorough++;
    }

    // 4) stationName-only
    if (!loc && nameKey) {
      matchedStation = byNameOnly.get(nameKey) || null;
      loc = matchedStation?.location || null;
      if (loc) mappedByNameOnly++;
    }

    if (!loc || loc.lat == null || loc.lng == null) {
      skippedNoLoc++;
      continue;
    }

    const isoDate = monthDate.toISOString();
    const status = availabilityForStatus >= 95 ? 'inService' : 'outOfService';

    const equip = String(equipmentId).trim();

    const doc = {
      elevatorId: equip, // one equipment => one map point
      equipmentId: equip,
      borough: borough || null,
      stationId: stationMrn ? String(stationMrn).trim() : matchedStation?.stationId || null,
      stationName: stationName ? String(stationName).trim() : matchedStation?.stationName || null,
      status,
      lastUpdated: isoDate,
      availabilityPct: availabilityMissing ? null : availabilityPct,
      riskScore,
      location: { lat: loc.lat, lng: loc.lng },
      _monthDate: monthDate // internal for choosing latest
    };

    const prev = bestByEquipment.get(equip);
    if (!prev || doc._monthDate > prev._monthDate) {
      bestByEquipment.set(equip, doc);
    }
  }

  const docs = Array.from(bestByEquipment.values()).map(({ _monthDate, ...d }) => d);

  console.log(
    `Elevators mapping summary: direct=${mappedDirect}, stationId=${mappedByStationId}, nameBorough=${mappedByNameBorough}, nameOnly=${mappedByNameOnly}, skippedNoLoc=${skippedNoLoc}, insertedUnique=${docs.length}`
  );

  return docs;
}

// -----------------------------------------------------------------------------
// APS mapping
// -----------------------------------------------------------------------------
function buildApsDocs(csvRows) {
  return csvRows
    .map((row, index) => {
      const cols = Object.keys(row);

      const idKey =
        cols.find((k) => k.toLowerCase().includes('aps') && k.toLowerCase().includes('id')) ||
        cols.find((k) => k.toLowerCase().endsWith('id')) ||
        null;

      const apsIdRaw = idKey ? row[idKey] : `APS-${index + 1}`;

      const latLng = extractLatLng(row, {
        latKeys: ['Latitude', 'LAT', 'Lat', 'lat'],
        lngKeys: ['Longitude', 'LON', 'Lon', 'Long', 'lng'],
        geoKey: 'the_geom'
      });
      if (!latLng) return null;

      const boroughKey =
        cols.find((k) => k.toLowerCase().includes('borough') || k.toLowerCase().includes('boro')) || null;
      const borough = boroughKey ? row[boroughKey] : null;

      const addrKey =
        cols.find(
          (k) =>
            k.toLowerCase().includes('street') ||
            k.toLowerCase().includes('address') ||
            k.toLowerCase().includes('location')
        ) || null;
      const address = addrKey ? row[addrKey] : null;

      const installKey = cols.find((k) => k.toLowerCase().includes('install')) || null;
      const installDate = installKey ? row[installKey] : null;

      return {
        apsId: String(apsIdRaw).trim(),
        location: {
          lat: latLng.lat,
          lng: latLng.lng,
          address: address || null,
          borough: borough || null
        },
        installDate: installDate || null
      };
    })
    .filter(Boolean);
}

// -----------------------------------------------------------------------------
// Curb ramps mapping
// -----------------------------------------------------------------------------
function buildCurbRampDocs(csvRows) {
  return csvRows
    .map((row, index) => {
      const cols = Object.keys(row);

      const idKey =
        cols.find((k) => k.toLowerCase().includes('ramp') && k.toLowerCase().includes('id')) ||
        cols.find((k) => k.toLowerCase().endsWith('id')) ||
        null;

      const rampIdRaw = idKey ? row[idKey] : `RAMP-${index + 1}`;

      const latLng = extractLatLng(row, {
        latKeys: ['Latitude', 'LAT', 'Lat', 'lat', 'Y'],
        lngKeys: ['Longitude', 'LON', 'Lon', 'Long', 'lng', 'X'],
        geoKey: 'the_geom'
      });
      if (!latLng) return null;

      const boroughKey =
        cols.find((k) => k.toLowerCase().includes('borough') || k.toLowerCase().includes('boro')) || null;
      const borough = boroughKey ? row[boroughKey] : null;

      const streetKey =
        cols.find(
          (k) =>
            k.toLowerCase().includes('street') ||
            k.toLowerCase().includes('stname') ||
            k.toLowerCase().includes('st_name')
        ) || null;
      const streetName = streetKey ? row[streetKey] : null;

      function pickField(preferredKeys = [], includeTokens = []) {
        for (const cand of preferredKeys) {
          const key = cols.find((k) => k.toLowerCase() === cand.toLowerCase());
          if (key && row[key] !== undefined && row[key] !== '') return row[key];
        }
        if (includeTokens.length > 0) {
          const key = cols.find((k) => {
            const lower = k.toLowerCase();
            return includeTokens.every((tok) => lower.includes(tok.toLowerCase()));
          });
          if (key && row[key] !== undefined && row[key] !== '') return row[key];
        }
        return null;
      }

      function pickNumber(preferredKeys = [], includeTokens = []) {
        const raw = pickField(preferredKeys, includeTokens);
        if (raw == null) return null;
        return toNumber(raw);
      }

      const attributes = {
        curbReveal: pickNumber(['CURB_REVEAL'], ['curb', 'reveal']),
        rampRun: pickNumber(['RAMP_RUNNING_SLOPE_TOTAL'], ['ramp', 'running', 'slope']),
        downSlopeCondition: pickField(['DWS_CONDITIONS'], ['dws', 'conditions']),
        gutterSlope: pickNumber(['GUTTER_SLOPE'], ['gutter', 'slope']),
        landingWidth: pickNumber(['LND_WIDTH'], ['lnd', 'width']),
        landingLength: pickNumber(['LND_LENGTH'], ['lnd', 'length']),
        landingCrossSlope: pickNumber(['LND_CROSS_SLOPE'], ['lnd', 'cross', 'slope']),
        counterSlope: pickNumber(['COUNTER_SLOPE'], ['counter', 'slope']),
        rampWidth: pickNumber(['RAMP_WIDTH'], ['ramp', 'width']),
        rampRise: pickNumber([], ['ramp', 'rise']),
        rampLength: pickNumber(['RAMP_LENGTH'], ['ramp', 'length']),
        rampCrossSlope: pickNumber(['RAMP_CROSS_SLOPE'], ['ramp', 'cross', 'slope']),
        ponding: pickField(['PONDING'], ['ponding']),
        obstacle: pickField(['OBSTACLES_RAMP'], ['obstacles', 'ramp']),
        obstaclesLanding: pickField(['OBSTACLES_LANDING'], ['obstacles', 'landing']),
        rampRightFlare: pickNumber(['RAMP_RIGHT_FLARE'], ['right', 'flare']),
        rampLeftFlare: pickNumber(['RAMP_LEFT_FLARE'], ['left', 'flare'])
      };

      for (const key of Object.keys(attributes)) {
        if (attributes[key] === undefined) attributes[key] = null;
      }

      return {
        rampId: String(rampIdRaw),
        location: { lat: latLng.lat, lng: latLng.lng },
        borough: borough || null,
        streetName: streetName || null,
        attributes
      };
    })
    .filter(Boolean);
}

// -----------------------------------------------------------------------------
// Main seeding function
// -----------------------------------------------------------------------------
export const seedAll = async () => {
  const db = await getDb();

  const stationsCol = db.collection('stations');
  const elevatorsCol = db.collection('elevators');
  const apsCol = db.collection('aps_locations');
  const rampsCol = db.collection('curb_ramps');

  console.log('Clearing old data...');
  await stationsCol.deleteMany({});
  await elevatorsCol.deleteMany({});
  await apsCol.deleteMany({});
  await rampsCol.deleteMany({});

  // 1) Stations (build docs first; insert after APS-based annotation)
  const stationRows = await fetchCsvRows(DATA_URLS.stations, 'stations');
  let stationDocs = buildStationDocs(stationRows);

  const dedupStations = dedupeByKey(stationDocs, (d) => d.stationId);
  stationDocs = dedupStations.docs;
  if (dedupStations.dropped > 0) {
    console.warn(`Stations: dropped ${dedupStations.dropped} duplicate stationId rows`);
  }

  const stationLookups = buildStationLookups(stationDocs);

  // 2) APS (needed to annotate stations with hasNearbyAPS)
  const apsRows = await fetchCsvRows(DATA_URLS.aps, 'APS');
  let apsDocs = buildApsDocs(apsRows);

  const dedupAps = dedupeByKey(apsDocs, (d) => d.apsId);
  apsDocs = dedupAps.docs;
  if (dedupAps.dropped > 0) {
    console.warn(`APS: dropped ${dedupAps.dropped} duplicate apsId rows`);
  }

  console.log('Annotating stations with hasNearbyAPS (radius=250m)...');
  annotateStationsHasNearbyAPS(stationDocs, apsDocs, 250);

  console.log(`Inserting ${stationDocs.length} station documents...`);
  if (stationDocs.length > 0) {
    await stationsCol.insertMany(stationDocs);
  }

  // 3) Elevators
  const elevatorRows = await fetchCsvRows(DATA_URLS.elevators, 'elevators');
  let elevatorDocs = buildElevatorDocs(elevatorRows, stationLookups);

  const dedupElevators = dedupeByKey(elevatorDocs, (d) => d.elevatorId);
  elevatorDocs = dedupElevators.docs;
  if (dedupElevators.dropped > 0) {
    console.warn(`Elevators: dropped ${dedupElevators.dropped} duplicate elevatorId rows`);
  }

  console.log(`Inserting ${elevatorDocs.length} elevator documents...`);
  if (elevatorDocs.length > 0) {
    await elevatorsCol.insertMany(elevatorDocs);
  } else {
    console.warn('Elevators: 0 docs inserted (no mappable locations found).');
  }

  console.log(`Inserting ${apsDocs.length} APS documents...`);
  if (apsDocs.length > 0) {
    await apsCol.insertMany(apsDocs);
  }

  // 4) Curb ramps
  const rampRows = await fetchCsvRows(DATA_URLS.curbRamps, 'curb ramps');
  let rampDocs = buildCurbRampDocs(rampRows);

  const dedupRamps = dedupeByKey(rampDocs, (d) => d.rampId);
  rampDocs = dedupRamps.docs;
  if (dedupRamps.dropped > 0) {
    console.warn(`Curb ramps: dropped ${dedupRamps.dropped} duplicate rampId rows`);
  }

  console.log(`Inserting ${rampDocs.length} curb ramp documents...`);
  if (rampDocs.length > 0) {
    await rampsCol.insertMany(rampDocs);
  }

  console.log('Seeding complete!');
};

// -----------------------------------------------------------------------------
// Direct execution entry point
// -----------------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  seedAll()
    .catch((err) => {
      console.error('Error during seeding:', err);
    })
    .finally(async () => {
      await closeConnection();
    });
}
