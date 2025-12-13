// routes/explore.js
// GeoJSON + Leaflet Explore routes.
//
// GET  /explore
//   - Renders the Explore page (filters + map + list)
//   - Passes `q` through to prefill the sidebar search input
//
// GET  /explore/api
//   - Accepts boolean layer toggles + optional station filters + optional `q`
//   - Returns GeoJSON FeatureCollection filtered by the request
//
// New optional params:
//   - onlyLowRisk=true|false
//   - maxRiskScore=0..100 (only read when onlyLowRisk=true)
//   - onlyHasNearbyAPS=true|false

import express from 'express';
const router = express.Router();

import * as stationData from '../data/stations.js';
import * as elevatorData from '../data/elevators.js';
import * as locationData from '../data/locations.js';

import { getUserById } from '../data/users.js';

const MAX_Q_LEN = 80;

const MAX_ELEVATORS = 1500;
const MAX_APS = 2000;
const MAX_RAMPS = 1500;

const DEFAULT_LOW_RISK_MAX = 5;

function readBoolParam(query, name) {
  const raw = query[name];

  if (raw == null) {
    const err = new Error(`Missing parameter: ${name}.`);
    err.status = 400;
    throw err;
  }
  if (Array.isArray(raw)) {
    const err = new Error(`${name} must only appear once.`);
    err.status = 400;
    throw err;
  }
  if (raw !== 'true' && raw !== 'false') {
    const err = new Error(`${name} must be true or false.`);
    err.status = 400;
    throw err;
  }
  return raw === 'true';
}

function readOptionalBoolParam(query, name, defaultValue = false) {
  const raw = query[name];
  if (raw == null) return defaultValue;

  if (Array.isArray(raw)) {
    const err = new Error(`${name} must only appear once.`);
    err.status = 400;
    throw err;
  }
  if (raw !== 'true' && raw !== 'false') {
    const err = new Error(`${name} must be true or false.`);
    err.status = 400;
    throw err;
  }
  return raw === 'true';
}

function readOptionalIntParam(
  query,
  name,
  defaultValue,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY
) {
  const raw = query[name];
  if (raw == null || raw === '') return defaultValue;

  if (Array.isArray(raw)) {
    const err = new Error(`${name} must only appear once.`);
    err.status = 400;
    throw err;
  }

  const n = Number(raw);
  if (!Number.isFinite(n)) {
    const err = new Error(`${name} must be a finite number.`);
    err.status = 400;
    throw err;
  }

  const rounded = Math.round(n);
  if (rounded < min || rounded > max) {
    const err = new Error(`${name} must be between ${min} and ${max}.`);
    err.status = 400;
    throw err;
  }

  return rounded;
}

function readOptionalStringParam(query, name, maxLen = MAX_Q_LEN) {
  const raw = query[name];
  if (raw == null) return '';

  if (Array.isArray(raw)) {
    const err = new Error(`${name} must only appear once.`);
    err.status = 400;
    throw err;
  }

  const s = String(raw).replace(/\s+/g, ' ').trim();
  if (s.length > maxLen) {
    const err = new Error(`${name} is too long (max ${maxLen} characters).`);
    err.status = 400;
    throw err;
  }
  return s;
}

function toFiniteNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function norm(v) {
  return String(v ?? '').trim();
}

function eqIgnoreCase(v, qLower) {
  const s = norm(v).toLowerCase();
  return Boolean(s) && s === qLower;
}

function includesIgnoreCase(v, qLower) {
  const s = String(v ?? '').toLowerCase();
  return Boolean(s) && s.includes(qLower);
}

// GET /explore
router.get('/', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');

    const q = readOptionalStringParam(req.query, 'q', MAX_Q_LEN);

    let bookmarksJson = '[]';
    if (req.session?.user?._id) {
      try {
        const u = await getUserById(String(req.session.user._id));
        // Prevent "</script>" injection when rendered into the page.
        bookmarksJson = JSON.stringify(u?.bookmarks || []).replace(/</g, '\\u003c');
      } catch {
        bookmarksJson = '[]';
      }
    }

    return res.render('explore', {
      title: 'Explore CommuteAble NYC',
      bookmarksJson,
      q
    });
  } catch (err) {
    return next(err);
  }
});

// GET /explore/api
router.get('/api', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');

    // Required layer toggles (existing behavior)
    const showStations = readBoolParam(req.query, 'showStations');
    const onlyAccessible = readBoolParam(req.query, 'onlyAccessible');
    const showElevators = readBoolParam(req.query, 'showElevators');
    const showAPS = readBoolParam(req.query, 'showAPS');
    const showRamps = readBoolParam(req.query, 'showRamps');

    // Optional station filters (new behavior)
    const onlyLowRisk = readOptionalBoolParam(req.query, 'onlyLowRisk', false);
    const onlyHasNearbyAPS = readOptionalBoolParam(req.query, 'onlyHasNearbyAPS', false);

    const maxRiskScore = onlyLowRisk
      ? readOptionalIntParam(req.query, 'maxRiskScore', DEFAULT_LOW_RISK_MAX, 0, 100)
      : DEFAULT_LOW_RISK_MAX;

    const q = readOptionalStringParam(req.query, 'q', MAX_Q_LEN);
    const hasQ = Boolean(q);
    const qLower = hasQ ? q.toLowerCase() : '';

    // Load datasets
    let stations = [];
    const needStations = showStations || onlyAccessible || onlyLowRisk || onlyHasNearbyAPS;
    if (needStations) {
      stations = onlyAccessible
        ? await stationData.getAccessibleStations()
        : await stationData.getAllStations();
    }

    // Optimization: if user wants onlyLowRisk elevators, query only those from Mongo
    let elevatorList = [];
    if (showElevators) {
      elevatorList = onlyLowRisk
        ? await elevatorData.getLowRiskElevators(maxRiskScore)
        : await elevatorData.getAllElevators();
    }

    let apsList = [];
    if (showAPS) {
      apsList = await locationData.getAllAPS();
    }

    let rampList = [];
    if (showRamps) {
      rampList = await locationData.getAllCurbRamps();
    }

    // Apply low-risk filter (stations + elevators)
    if (onlyLowRisk) {
      // elevatorList is already low-risk if showElevators==true (because of query down-push),
      // but keep a defensive filter in case of unexpected data drift.
      const isLowRisk = (ev) => {
        const r = Number(ev?.riskScore);
        return Number.isFinite(r) && r <= maxRiskScore;
      };

      if (elevatorList.length) {
        elevatorList = elevatorList.filter(isLowRisk);
      }

      if (stations.length) {
        let stationIdSet;

        if (showElevators) {
          stationIdSet = new Set(
            elevatorList
              .map((ev) => (ev?.stationId == null ? '' : String(ev.stationId)))
              .filter(Boolean)
          );
        } else {
          const ids = await elevatorData.getStationIdsWithLowRiskElevators(maxRiskScore);
          stationIdSet = new Set(ids.map((x) => String(x)));
        }

        stations = stations.filter((s) => stationIdSet.has(String(s.stationId)));
      }
    }

    // Apply "has nearby APS" filter (stations only; uses precomputed field)
    if (onlyHasNearbyAPS && stations.length) {
      stations = stations.filter((s) => s.hasNearbyAPS === true);
    }

    // Filter by q (before caps)
    if (hasQ) {
      if (stations.length) {
        stations = stations.filter((s) => {
          return eqIgnoreCase(s.stationId, qLower) || includesIgnoreCase(s.stationName, qLower);
        });
      }

      if (elevatorList.length) {
        elevatorList = elevatorList.filter((ev) => {
          return (
            eqIgnoreCase(ev.elevatorId, qLower) ||
            includesIgnoreCase(ev.equipmentId, qLower) ||
            includesIgnoreCase(ev.borough, qLower) ||
            includesIgnoreCase(ev.stationId, qLower) ||
            includesIgnoreCase(ev.stationName, qLower)
          );
        });
      }

      if (apsList.length) {
        apsList = apsList.filter((a) => {
          const intersectionOrAddress = a?.location?.intersection ?? a?.location?.address ?? '';
          return (
            eqIgnoreCase(a.apsId, qLower) ||
            includesIgnoreCase(intersectionOrAddress, qLower) ||
            includesIgnoreCase(a.location?.borough, qLower)
          );
        });
      }

      if (rampList.length) {
        rampList = rampList.filter((r) => {
          return (
            eqIgnoreCase(r.rampId, qLower) ||
            includesIgnoreCase(r.streetName, qLower) ||
            includesIgnoreCase(r.borough, qLower)
          );
        });
      }
    }

    // Caps (after filtering)
    if (elevatorList.length > MAX_ELEVATORS) elevatorList = elevatorList.slice(0, MAX_ELEVATORS);
    if (apsList.length > MAX_APS) apsList = apsList.slice(0, MAX_APS);
    if (rampList.length > MAX_RAMPS) rampList = rampList.slice(0, MAX_RAMPS);

    // Build GeoJSON FeatureCollection
    const features = [];

    // Stations
    for (let i = 0; i < stations.length; i++) {
      const s = stations[i];
      if (!s?.location) continue;

      const lat = toFiniteNumber(s.location.lat);
      const lng = toFiniteNumber(s.location.lng);
      if (lat == null || lng == null) continue;

      const stationId = norm(s.stationId);
      if (!stationId) continue;

      const routes = s.routes || s.daytimeRoutes || [];

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [lng, lat]
        },
        properties: {
          kind: 'station',
          stationId,
          name: s.stationName,
          adaStatus: s.adaStatus,
          routes,
          hasNearbyAPS: Boolean(s.hasNearbyAPS)
        }
      });
    }

    // Elevators
    for (let i = 0; i < elevatorList.length; i++) {
      const ev = elevatorList[i];
      if (!ev?.location) continue;

      const lat = toFiniteNumber(ev.location.lat);
      const lng = toFiniteNumber(ev.location.lng);
      if (lat == null || lng == null) continue;

      const elevatorId = norm(ev.elevatorId);
      if (!elevatorId) continue;

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [lng, lat]
        },
        properties: {
          kind: 'elevator',
          elevatorId,
          equipmentId: ev.equipmentId,
          stationId: ev.stationId ?? null,
          stationName: ev.stationName ?? null,
          borough: ev.borough,
          status: ev.status,
          lastUpdated: ev.lastUpdated,
          riskScore: ev.riskScore ?? null,
          availabilityPct: ev.availabilityPct ?? null
        }
      });
    }

    // APS
    for (let i = 0; i < apsList.length; i++) {
      const aps = apsList[i];
      if (!aps?.location) continue;

      const lat = toFiniteNumber(aps.location.lat);
      const lng = toFiniteNumber(aps.location.lng);
      if (lat == null || lng == null) continue;

      const apsId = norm(aps.apsId);
      if (!apsId) continue;

      const intersection = aps.location.intersection ?? null;
      const address = aps.location.address ?? null;
      const borough = aps.location.borough ?? null;

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [lng, lat]
        },
        properties: {
          kind: 'aps',
          apsId,
          intersection: intersection || address || 'Not available',
          borough: borough || 'Not available'
        }
      });
    }

    // Curb Ramps
    for (let i = 0; i < rampList.length; i++) {
      const ramp = rampList[i];
      if (!ramp?.location) continue;

      const lat = toFiniteNumber(ramp.location.lat);
      const lng = toFiniteNumber(ramp.location.lng);
      if (lat == null || lng == null) continue;

      const rampId = norm(ramp.rampId);
      if (!rampId) continue;

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [lng, lat]
        },
        properties: {
          kind: 'ramp',
          rampId,
          streetName: ramp.streetName,
          borough: ramp.borough || 'Not available'
        }
      });
    }

    return res.json({ type: 'FeatureCollection', features });
  } catch (err) {
    return next(err);
  }
});

export default router;
