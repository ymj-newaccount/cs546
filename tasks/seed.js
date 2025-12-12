// tasks/seed.js
// Seed script that pulls 4 real open-data datasets (stations, elevators,
// APS, curb ramps), cleans them, and writes them into MongoDB.

import fetch from 'node-fetch';
import { parse as parseCsv } from 'csv-parse/sync';
import { getDb, closeConnection } from '../config/mongoConnection.js';
import { fileURLToPath } from 'url';
import path from 'path'; 

// Absolute path of this file, used to detect "run directly" vs "imported".
const __filename = fileURLToPath(import.meta.url);

// -----------------------------------------------------------------------------
// Public CSV endpoints for the 4 datasets (official portals).
// -----------------------------------------------------------------------------
const DATA_URLS = {
  // MTA Subway Stations (station metadata + ADA + routes)
  stations:
    'https://data.ny.gov/api/views/39hk-dx4f/rows.csv?accessType=DOWNLOAD',

  // MTA NYCT Subway Elevator and Escalator Availability (monthly availability)
  elevators:
    'https://data.ny.gov/api/views/rc78-7x78/rows.csv?accessType=DOWNLOAD',

  // NYC DOT Accessible Pedestrian Signals (APS)
  aps: 'https://data.cityofnewyork.us/api/views/de3m-c5p4/rows.csv?accessType=DOWNLOAD',

  // NYC Pedestrian Ramp Locations (curb ramps)
  curbRamps:
    'https://data.cityofnewyork.us/api/views/ufzp-rrqu/rows.csv?accessType=DOWNLOAD'
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

// Download a CSV URL and parse it into an array of row objects.
async function fetchCsvRows(url, label) {
  console.log(`Fetching ${label} from ${url} ...`);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${label}: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();

  const rows = parseCsv(text, {
    columns: true, // use first line as header
    skip_empty_lines: true,
    trim: true
  });

  console.log(`${label}: fetched ${rows.length} rows`);
  // For debugging the first time, you can temporarily uncomment:
  // console.log(`${label} columns:`, Object.keys(rows[0]));
  return rows;
}

// Safe numeric conversion (returns null on NaN).
function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Extract latitude/longitude from a row.
// It tries a list of candidate column names and (optionally) a "POINT (lon lat)" column.
function extractLatLng(row, options = {}) {
  const { latKeys = [], lngKeys = [], geoKey = null } = options;
  const allKeys = Object.keys(row);

  function pickNumberByKeys(candidates, fallbackRegex) {
    // First try exact matches against the candidate list (case-insensitive).
    for (const cand of candidates) {
      const key = allKeys.find(
        (k) => k.toLowerCase() === String(cand).toLowerCase()
      );
      if (key && row[key] !== undefined && row[key] !== '') {
        const v = toNumber(row[key]);
        if (v !== null) return v;
      }
    }
    // Then fall back to a fuzzy match: any column name matching the regex
    // (for example, containing "lat" or "lon").
    if (fallbackRegex) {
      const key = allKeys.find((k) => fallbackRegex.test(k.toLowerCase()));
      if (key && row[key] !== undefined && row[key] !== '') {
        const v = toNumber(row[key]);
        if (v !== null) return v;
      }
    }
    return null;
  }

  // Any column whose name contains "lat" is a candidate for latitude.
  let lat = pickNumberByKeys(latKeys, /lat/);
  // Any column whose name contains "lon", "lng", or "long" is a candidate for longitude.
  let lng = pickNumberByKeys(lngKeys, /(lon|lng|long)/);

  // Fallback: if lat/lng are still missing, try to parse a geometry column
  // like "POINT (lon lat)" from a field such as "the_geom".
  if ((lat === null || lng === null) && geoKey && row[geoKey]) {
    const m = String(row[geoKey]).match(
      /POINT\s*\(([-0-9.]+)\s+([-0-9.]+)\)/i
    );
    if (m) {
      lng = toNumber(m[1]);
      lat = toNumber(m[2]);
    }
  }

  if (lat === null || lng === null) return null;
  return { lat, lng };
}

// -----------------------------------------------------------------------------
// Stations mapping
// -----------------------------------------------------------------------------

// Map ADA field to your internal adaStatus enum.
// According to MTA docs: 0 = not accessible, 1 = accessible, 2 = partially accessible.
function mapAdaStatus(rawAda) {
  const n = Number(rawAda);
  if (n === 1) return 'accessible';
  if (n === 2) return 'partiallyAccessible';
  return 'notAccessible';
}

// Convert the MTA Subway Stations CSV rows into station documents
// that match your "stations" collection schema.
function buildStationDocs(csvRows) {
  return csvRows
    .map((row) => {
      // Header names are taken from the MTA Subway Stations data dictionary.
      // Typical columns:
      // - "Station ID"
      // - "Division"
      // - "Line"
      // - "Stop Name"
      // - "Borough"
      // - "Daytime Routes"
      // - "GTFS Latitude"
      // - "GTFS Longitude"
      // - "ADA"
      const stationId = row['Station ID'];
      const division = row['Division'];
      const line = row['Line'];
      const stationName = row['Stop Name'];
      const borough = row['Borough'];

      const loc = extractLatLng(row, {
        latKeys: ['GTFS Latitude', 'Station Latitude', 'Latitude'],
        lngKeys: ['GTFS Longitude', 'Station Longitude', 'Longitude']
      });

      const adaStatus = mapAdaStatus(row['ADA']);

      // "Daytime Routes" is something like "A C E" → split on whitespace.
      const routesString = row['Daytime Routes'] || '';
      const daytimeRoutes = routesString
        .split(/\s+/)
        .map((r) => r.trim())
        .filter((r) => r.length > 0);

      if (!stationId || !loc) {
        // Skip rows without an ID or coordinates.
        return null;
      }

      return {
        stationId: String(stationId),
        division: division || null,
        line: line || null,
        stationName: stationName || null,
        daytimeRoutes,
        location: loc,
        adaStatus,
        borough: borough || null
      };
    })
    .filter(Boolean);
}

// -----------------------------------------------------------------------------
// Elevators mapping
// -----------------------------------------------------------------------------

// Convert the Elevator Availability CSV rows into elevator documents.
// This is intentionally coarse: we care mainly about a stable elevatorId,
// station linkage, and a simple status + lastUpdated timestamp.
// -----------------------------------------------------------------------------
// Elevators mapping (revised)
// -----------------------------------------------------------------------------
function buildElevatorDocs(csvRows) {
  return csvRows
    .map((row) => {
      // 1. Equipment ID: pick from Equipment Code / equipment_code / etc.
      const equipmentId =
        row['Equipment Code'] ??
        row['equipment_code'] ??
        row['Equipment ID'] ??
        row['Equipment'] ??
        row['equipment'] ??
        null;

      // 2. Borough: usually stored in borough / Borough
      const borough = row['Borough'] ?? row['borough'] ?? row['Boro'] ?? null;

      // 3. Month: column is Month / month (rc78-7x78 dataset has a month field)
      const monthRaw =
        row['Month Beginning'] ?? row['Month'] ?? row['month'] ?? null;

      // Note: this dataset does not reliably provide station_id,
      // so we do not require it to be present.
      const stationId = row['Station ID'] ?? row['station_id'] ?? null;

      // Skip rows without an equipment ID or a month
      if (!equipmentId || !monthRaw) {
        return null;
      }

      const date = new Date(monthRaw);
      if (Number.isNaN(date.getTime())) {
        // Skip rows where the date cannot be parsed
        return null;
      }

      const isoDate = date.toISOString();
      const ym = isoDate.slice(0, 7); // "YYYY-MM"

      // 4. Availability: try several possible columns
      //    (some are stored as 01 fractions, some as percentages).
      let availabilityPct =
        toNumber(
          row['24-Hour Availability'] ??
            row['24_hour_availability'] ??
            row['AM Peak Availability'] ??
            row['am_peak_availability'] ??
            row['Percent Availability'] ??
            row['% Availability'] ??
            row['Percent of time in service']
        );

      // If it looks like a 01 fraction, convert to a percentage
      if (availabilityPct !== null && availabilityPct <= 1) {
        availabilityPct = availabilityPct * 100;
      }

      // Default to 100% (optimistic) if we cannot parse anything
      if (availabilityPct === null) availabilityPct = 100;

      const status =
        availabilityPct >= 95 ? 'inService' : 'outOfService';

      return {
        // Stable ID, e.g. "ELEV1234-2025-10"
        elevatorId: `${equipmentId}-${ym}`,
        equipmentId: String(equipmentId),
        borough,
        // Most stationId values will be null; we can backfill later
        // if we build an Equipment  Station mapping.
        stationId: stationId ? String(stationId) : null,
        status,
        lastUpdated: isoDate
      };
    })
    .filter(Boolean);
}

// -----------------------------------------------------------------------------
// APS (Accessible Pedestrian Signals) mapping
// -----------------------------------------------------------------------------

// Convert APS CSV rows into documents for the aps_locations collection.
function buildApsDocs(csvRows) {
  return csvRows
    .map((row, index) => {
      const cols = Object.keys(row);

      // Try to find a reasonable unique ID column.
      const idKey =
        cols.find(
          (k) =>
            k.toLowerCase().includes('aps') &&
            k.toLowerCase().includes('id')
        ) ||
        cols.find((k) => k.toLowerCase().endsWith('id')) ||
        null;

      const apsIdRaw = idKey ? row[idKey] : `APS-${index + 1}`;

      // Lat/lng: dataset usually has explicit latitude/longitude columns
      // plus a geometry column "the_geom".
      const latLng = extractLatLng(row, {
        latKeys: ['Latitude', 'LAT', 'Lat', 'lat'],
        lngKeys: ['Longitude', 'LON', 'Lon', 'Long', 'lng'],
        geoKey: 'the_geom'
      });
      if (!latLng) return null;

      // Borough and address: look for obvious text columns.
      const boroughKey =
        cols.find(
          (k) =>
            k.toLowerCase().includes('borough') ||
            k.toLowerCase().includes('boro')
        ) || null;
      const borough = boroughKey ? row[boroughKey] : null;

      const addrKey =
        cols.find(
          (k) =>
            k.toLowerCase().includes('street') ||
            k.toLowerCase().includes('address') ||
            k.toLowerCase().includes('location')
        ) || null;
      const address = addrKey ? row[addrKey] : null;

      const installKey =
        cols.find((k) => k.toLowerCase().includes('install')) || null;
      const installDate = installKey ? row[installKey] : null;

      return {
        apsId: String(apsIdRaw),
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
// Curb ramps mapping (with normalized attributes schema)
// -----------------------------------------------------------------------------
function buildCurbRampDocs(csvRows) {
  return csvRows
    .map((row, index) => {
      const cols = Object.keys(row);

      // --------- Basic id / location / street info (same as before) ---------
      const idKey =
        cols.find(
          (k) =>
            k.toLowerCase().includes('ramp') &&
            k.toLowerCase().includes('id')
        ) ||
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
        cols.find(
          (k) =>
            k.toLowerCase().includes('borough') ||
            k.toLowerCase().includes('boro')
        ) || null;
      const borough = boroughKey ? row[boroughKey] : null;

      const streetKey =
        cols.find(
          (k) =>
            k.toLowerCase().includes('street') ||
            k.toLowerCase().includes('stname') ||
            k.toLowerCase().includes('st_name')
        ) || null;
      const streetName = streetKey ? row[streetKey] : null;

      // --------- Helper: pick a field by column name / keyword tokens ---------
      function pickField(preferredKeys = [], includeTokens = []) {
        // 1) Prefer exact header name matches (case-insensitive)
        for (const cand of preferredKeys) {
          const key = cols.find(
            (k) => k.toLowerCase() === cand.toLowerCase()
          );
          if (key && row[key] !== undefined && row[key] !== '') {
            return row[key];
          }
        }
        // 2) Fallback: any header whose name contains all given tokens
        if (includeTokens.length > 0) {
          const key = cols.find((k) => {
            const lower = k.toLowerCase();
            return includeTokens.every((tok) =>
              lower.includes(tok.toLowerCase())
            );
          });
          if (key && row[key] !== undefined && row[key] !== '') {
            return row[key];
          }
        }
        return null;
      }

      function pickNumber(preferredKeys = [], includeTokens = []) {
        const raw = pickField(preferredKeys, includeTokens);
        if (raw == null) return null;
        return toNumber(raw);
      }

      // --------- Rename raw CSV columns into the normalized attributes schema ---------
      const attributes = {
        // Exact mapping from raw CSV column names to normalized keys:

        // CURB_REVEAL → curbReveal
        curbReveal: pickNumber(['CURB_REVEAL'], ['curb', 'reveal']),

        // RAMP_RUNNING_SLOPE_TOTAL → rampRun (overall running slope)
        rampRun: pickNumber(
          ['RAMP_RUNNING_SLOPE_TOTAL'],
          ['ramp', 'running', 'slope']
        ),

        // DWS_CONDITIONS → downSlopeCondition (down-slope conditions)
        downSlopeCondition: pickField(
          ['DWS_CONDITIONS'],
          ['dws', 'conditions']
        ),

        // GUTTER_SLOPE → gutterSlope
        gutterSlope: pickNumber(['GUTTER_SLOPE'], ['gutter', 'slope']),

        // LND_WIDTH / LND_LENGTH / LND_CROSS_SLOPE → landing*
        landingWidth: pickNumber(['LND_WIDTH'], ['lnd', 'width']),
        landingLength: pickNumber(['LND_LENGTH'], ['lnd', 'length']),
        landingCrossSlope: pickNumber(
          ['LND_CROSS_SLOPE'],
          ['lnd', 'cross', 'slope']
        ),

        // COUNTER_SLOPE → counterSlope
        counterSlope: pickNumber(['COUNTER_SLOPE'], ['counter', 'slope']),

        // RAMP_WIDTH → rampWidth
        rampWidth: pickNumber(['RAMP_WIDTH'], ['ramp', 'width']),

        // Dataset has no explicit "ramp rise" column; keep this slot in the schema as null
        rampRise: pickNumber([], ['ramp', 'rise']),

        // RAMP_LENGTH / RAMP_CROSS_SLOPE → rampLength / rampCrossSlope
        rampLength: pickNumber(['RAMP_LENGTH'], ['ramp', 'length']),
        rampCrossSlope: pickNumber(
          ['RAMP_CROSS_SLOPE'],
          ['ramp', 'cross', 'slope']
        ),

        // PONDING → ponding
        ponding: pickField(['PONDING'], ['ponding']),

        // OBSTACLES_RAMP / OBSTACLES_LANDING → obstacle / obstaclesLanding
        obstacle: pickField(['OBSTACLES_RAMP'], ['obstacles', 'ramp']),
        obstaclesLanding: pickField(
          ['OBSTACLES_LANDING'],
          ['obstacles', 'landing']
        ),

        // Extra: keep left/right flare in attributes in case we want to use them later
        rampRightFlare: pickNumber(
          ['RAMP_RIGHT_FLARE'],
          ['right', 'flare']
        ),
        rampLeftFlare: pickNumber(
          ['RAMP_LEFT_FLARE'],
          ['left', 'flare']
        )
      };

      // Normalize undefined to null so consumers can rely on null checks
      for (const key of Object.keys(attributes)) {
        if (attributes[key] === undefined) {
          attributes[key] = null;
        }
      }

      return {
        rampId: String(rampIdRaw),
        location: {
          lat: latLng.lat,
          lng: latLng.lng
        },
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

// This function performs a full refresh:
// 1) Fetch CSVs for the 4 datasets.
// 2) Map them into your internal schemas.
// 3) Wipe the collections and insert new documents.
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

  // 1) Stations
  const stationRows = await fetchCsvRows(DATA_URLS.stations, 'stations');
  const stationDocs = buildStationDocs(stationRows);
  console.log(`Inserting ${stationDocs.length} station documents...`);
  if (stationDocs.length > 0) {
    await stationsCol.insertMany(stationDocs);
  }

  // 2) Elevators
  const elevatorRows = await fetchCsvRows(DATA_URLS.elevators, 'elevators');
  const elevatorDocs = buildElevatorDocs(elevatorRows);
  console.log(`Inserting ${elevatorDocs.length} elevator documents...`);
  if (elevatorDocs.length > 0) {
    await elevatorsCol.insertMany(elevatorDocs);
  }

  // 3) APS
  const apsRows = await fetchCsvRows(DATA_URLS.aps, 'APS');
  const apsDocs = buildApsDocs(apsRows);
  console.log(`Inserting ${apsDocs.length} APS documents...`);
  if (apsDocs.length > 0) {
    await apsCol.insertMany(apsDocs);
  }

  // 4) Curb ramps
  const rampRows = await fetchCsvRows(DATA_URLS.curbRamps, 'curb ramps');
  const rampDocs = buildCurbRampDocs(rampRows);
  console.log(`Inserting ${rampDocs.length} curb ramp documents...`);
  if (rampDocs.length > 0) {
    await rampsCol.insertMany(rampDocs);
  }

  console.log('Seeding complete!');
};

// -----------------------------------------------------------------------------
// Direct execution entry point
// -----------------------------------------------------------------------------

// If this file is executed directly (e.g. `node tasks/seed.js` or `npm run seed`),
// run the seedAll() function and close the DB connection afterwards.
// If the file is imported (e.g. from an /admin route), seedAll() will not
// run automatically; the caller can invoke it manually.
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  seedAll()
    .catch((err) => {
      console.error('Error during seeding:', err);
    })
    .finally(async () => {
      await closeConnection();
    });
}
