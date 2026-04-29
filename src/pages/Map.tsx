import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Polygon, Polyline, Marker, useMap } from 'react-leaflet';
import { getCurrentUser, updateUser, saveTerritoryToFirebase, subscribeToTerritories } from '../utils/storage';
import { User } from '../types';
import BottomNavigation from '../components/BottomNavigation';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

L.Marker.prototype.options.icon = L.icon({
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

const BOT_COLORS: Record<string, string> = { bot1: '#00C6FF', bot2: '#FF6B6B', bot3: '#C77DFF' };
const PLAYER_COLOR = '#00FF87';
const CAMPUS_CENTER: [number, number] = [18.4926, 74.0255];
const BBOX = '18.488,74.018,18.500,74.032';

interface RoadWay { id: number; coords: [number, number][] }
interface Territory { id: string; owner: string; ownerName: string; polygon: [number, number][]; color: string; }
interface RoadGraph {
  nodes: Record<string, [number, number]>;
  edges: Record<string, string[]>;
}

// ─── GEOMETRY ────────────────────────────────────────────────────────────────

/**
 * Returns the intersection point [lat,lng] of segments p1→p2 and p3→p4,
 * or null if they don't cross (with a small epsilon buffer at endpoints).
 */
const getIntersectionPoint = (
  p1: [number, number], p2: [number, number],
  p3: [number, number], p4: [number, number]
): [number, number] | null => {
  const d1 = [p2[0] - p1[0], p2[1] - p1[1]];
  const d2 = [p4[0] - p3[0], p4[1] - p3[1]];
  const cross = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(cross) < 1e-12) return null; // parallel
  const t = ((p3[0] - p1[0]) * d2[1] - (p3[1] - p1[1]) * d2[0]) / cross;
  const u = ((p3[0] - p1[0]) * d1[1] - (p3[1] - p1[1]) * d1[0]) / cross;
  // Use 0.02 / 0.98 — tighter endpoints to avoid corner-touch false positives
  if (t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98) {
    return [p1[0] + t * d1[0], p1[1] + t * d1[1]];
  }
  return null;
};

/**
 * Scans the last `window` points of the path for a self-intersection.
 * Returns { idx, point } where idx is the earlier segment index and
 * point is the exact crossing coordinate — or null.
 */
const findLoop = (
  path: [number, number][],
  window = 120
): { idx: number; point: [number, number] } | null => {
  if (path.length < 8) return null;
  const slice = path.slice(-window);
  const last = slice[slice.length - 1];
  const prev = slice[slice.length - 2];
  // Check new segment against all earlier segments except the 4 adjacent ones
  for (let i = 0; i < slice.length - 5; i++) {
    const pt = getIntersectionPoint(prev, last, slice[i], slice[i + 1]);
    if (pt) return { idx: path.length - window + i, point: pt };
  }
  return null;
};

/** Haversine distance in metres between two lat/lng points */
const haversine = (a: [number, number], b: [number, number]): number => {
  const R = 6371000;
  const dLat = (b[0] - a[0]) * Math.PI / 180;
  const dLon = (b[1] - a[1]) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

/** Polygon area in m² via Shoelace (on lat/lng, approximate) */
const polygonArea = (pts: [number, number][]): number => {
  if (pts.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i][1] * pts[j][0];
    area -= pts[j][1] * pts[i][0];
  }
  // Convert degree² → m²  (1° lat ≈ 111 000 m)
  return Math.abs(area / 2) * 111000 * 111000;
};

const toKey = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`;

// ─── FALLBACK GRID ────────────────────────────────────────────────────────────

function buildDenseGrid(): { nodes: Record<string, [number, number]>; edges: Record<string, string[]>; ways: RoadWay[] } {
  const nodes: Record<string, [number, number]> = {};
  const edges: Record<string, string[]> = {};
  const ways: RoadWay[] = [];
  const steps = 40;
  const latStart = 18.489, lngStart = 74.019;
  const latEnd = 18.499, lngEnd = 74.031;
  const latStep = (latEnd - latStart) / steps;
  const lngStep = (lngEnd - lngStart) / steps;

  for (let i = 0; i <= steps; i++) {
    const lat = latStart + i * latStep;
    const coords: [number, number][] = [];
    for (let j = 0; j <= steps; j++) {
      const lng = lngStart + j * lngStep;
      const key = toKey(lat, lng);
      nodes[key] = [lat, lng];
      if (!edges[key]) edges[key] = [];
      coords.push([lat, lng]);
      if (j > 0) {
        const prevKey = toKey(lat, lngStart + (j - 1) * lngStep);
        if (!edges[prevKey]) edges[prevKey] = [];
        if (!edges[key].includes(prevKey)) edges[key].push(prevKey);
        if (!edges[prevKey].includes(key)) edges[prevKey].push(key);
      }
    }
    ways.push({ id: i, coords });
  }

  for (let j = 0; j <= steps; j++) {
    const lng = lngStart + j * lngStep;
    const coords: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const lat = latStart + i * latStep;
      const key = toKey(lat, lng);
      coords.push([lat, lng]);
      if (i > 0) {
        const prevKey = toKey(latStart + (i - 1) * latStep, lng);
        if (!edges[key]) edges[key] = [];
        if (!edges[prevKey]) edges[prevKey] = [];
        if (!edges[key].includes(prevKey)) edges[key].push(prevKey);
        if (!edges[prevKey].includes(key)) edges[prevKey].push(key);
      }
    }
    ways.push({ id: steps + j + 1, coords });
  }

  return { nodes, edges, ways };
}

// ─── BOT STATE ────────────────────────────────────────────────────────────────

interface BotState {
  currentNode: string;
  path: [number, number][];
  visited: string[];       // last N nodes for recency check
  target: string | null;   // current lookahead destination
  steps: number;           // steps since last direction change
}

/**
 * Pick the next node for a bot using a directional-bias random walk.
 * Priority: 1) continue toward `target` if reachable
 *           2) prefer unvisited neighbours
 *           3) avoid immediate backtrack
 *           4) random fallback
 */
const pickNextNode = (
  bot: BotState,
  edges: Record<string, string[]>,
  nodes: Record<string, [number, number]>
): { nextNode: string; newTarget: string | null } => {
  const neighbours = (edges[bot.currentNode] || []).filter(n => nodes[n]);
  if (!neighbours.length) return { nextNode: bot.currentNode, newTarget: null };

  const lastNode = bot.visited.length >= 2 ? bot.visited[bot.visited.length - 2] : null;
  const notBacktrack = neighbours.filter(n => n !== lastNode);
  const candidates = notBacktrack.length ? notBacktrack : neighbours;

  // Try to keep moving toward existing target for a few steps
  if (bot.target && candidates.includes(bot.target) && bot.steps < 8) {
    return { nextNode: bot.target, newTarget: bot.target };
  }

  // Prefer nodes not recently visited
  const recentSet = new Set(bot.visited.slice(-20));
  const fresh = candidates.filter(n => !recentSet.has(n));
  const pool = fresh.length ? fresh : candidates;

  // Among pool, pick the one that is most distant from current position (explore outward)
  const cur = nodes[bot.currentNode];
  let best = pool[0];
  let bestDist = -1;
  for (const n of pool) {
    const d = haversine(cur, nodes[n]);
    if (d > bestDist) { bestDist = d; best = n; }
  }

  return { nextNode: best, newTarget: best };
};

// ─── LOCATION TRACKER ────────────────────────────────────────────────────────

function LocationTracker({ onLocation }: { onLocation: (pos: [number, number]) => void }) {
  const map = useMap();
  const hasLocated = useRef(false);
  useEffect(() => {
    map.locate({ watch: true, enableHighAccuracy: true, maximumAge: 2000 });
    map.on('locationfound', (e) => {
      if (e.accuracy > 5000) return;
      onLocation([e.latlng.lat, e.latlng.lng]);
      if (!hasLocated.current) {
        map.setView(e.latlng, 17);
        hasLocated.current = true;
      }
    });
    map.on('locationerror', (e) => console.log('GPS error:', e.message));
    return () => { map.stopLocate(); };
  }, [map]);
  return null;
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function Map() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [roads, setRoads] = useState<RoadWay[]>([]);
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [roadsLoaded, setRoadsLoaded] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [runPath, setRunPath] = useState<[number, number][]>([]);
  const [botTrails, setBotTrails] = useState<Record<string, [number, number][]>>({});
  const [distance, setDistance] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [captured, setCaptured] = useState(0);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState<'capture' | 'warning'>('capture');
  const [showSummary, setShowSummary] = useState(false);
  const [gpsMode, setGpsMode] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [myLocation, setMyLocation] = useState<[number, number] | null>(null);
  const [summaryData, setSummaryData] = useState({ time: 0, dist: 0, zones: 0 });
  const [loadingStatus, setLoadingStatus] = useState('⏳ Loading campus roads...');

  // Refs (survive re-renders inside setInterval)
  const currentNodeRef = useRef<string>('');
  const pathRef = useRef<[number, number][]>([]);
  const capturedRef = useRef(0);
  const distanceRef = useRef(0);
  const userRef = useRef<User | null>(null);
  const graphRef = useRef<RoadGraph>({ nodes: {}, edges: {} });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const botStatesRef = useRef<Record<string, BotState>>({});
  const isRunningRef = useRef(false);
  const gpsModeRef = useRef(false);
  const territoriesRef = useRef<Territory[]>([]);

  // Keep territoriesRef in sync
  useEffect(() => { territoriesRef.current = territories; }, [territories]);

  useEffect(() => {
    const u = getCurrentUser();
    if (!u) { navigate('/'); return; }
    setUser(u); userRef.current = u;
    fetchRoads();
    const unsub = subscribeToTerritories((firebaseTerritories) => {
      setTerritories(current => {
        const myId = userRef.current?.id;
        const mine = current.filter(t => t.owner === myId);
        const others = firebaseTerritories.filter(t => t.owner !== myId);
        return [...mine, ...others];
      });
    });
    return () => unsub();
  }, [navigate]);

  // ── Road loading ─────────────────────────────────────────────────────────

  const applyRoadsAndBots = (
    ways: RoadWay[],
    nodes: Record<string, [number, number]>,
    edges: Record<string, string[]>
  ) => {
    graphRef.current = { nodes, edges };
    setRoads(ways);
    // Place three starter territories for the bots using actual road coords
    if (ways.length >= 3) {
      const makePolygon = (startIdx: number): [number, number][] => {
        const pts: [number, number][] = [];
        for (let w = startIdx; w < startIdx + 3 && w < ways.length; w++) {
          pts.push(...ways[w].coords.slice(0, 3));
        }
        return pts;
      };
      setTerritories([
        { id: 't1', owner: 'bot1', ownerName: 'Alex Runner', color: BOT_COLORS.bot1, polygon: makePolygon(0) },
        { id: 't2', owner: 'bot2', ownerName: 'Sarah Sprint', color: BOT_COLORS.bot2, polygon: makePolygon(Math.floor(ways.length / 3)) },
        { id: 't3', owner: 'bot3', ownerName: 'Mike Marathon', color: BOT_COLORS.bot3, polygon: makePolygon(Math.floor(ways.length * 2 / 3)) },
      ]);
    }
    setRoadsLoaded(true);
    setLoadingStatus('✅ Roads loaded!');
  };

  const fetchRoads = async (attempt = 1) => {
    try {
      setLoadingStatus(`⏳ Loading campus roads... (attempt ${attempt}/3)`);
      const query = `[out:json];way[highway](${BBOX});out geom;`;
      const urls = [
        `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`,
        `https://api.allorigins.win/get?url=${encodeURIComponent(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`)}`,
        `https://corsproxy.io/?${encodeURIComponent(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`)}`,
      ];
      const url = urls[(attempt - 1) % urls.length];
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      let data;
      const text = await res.text();
      if (url.includes('allorigins')) {
        data = JSON.parse(JSON.parse(text).contents);
      } else {
        data = JSON.parse(text);
      }
      if (!data.elements || data.elements.length === 0) throw new Error('No road data');

      const ways: RoadWay[] = [];
      const nodes: Record<string, [number, number]> = {};
      const edges: Record<string, string[]> = {};

      for (const el of data.elements) {
        if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
        const coords: [number, number][] = el.geometry.map((g: { lat: number; lon: number }) => [g.lat, g.lon] as [number, number]);
        ways.push({ id: el.id, coords });
        for (let i = 0; i < coords.length; i++) {
          const key = toKey(coords[i][0], coords[i][1]);
          nodes[key] = coords[i];
          if (!edges[key]) edges[key] = [];
          if (i > 0) {
            const prevKey = toKey(coords[i - 1][0], coords[i - 1][1]);
            if (!edges[prevKey]) edges[prevKey] = [];
            if (!edges[key].includes(prevKey)) edges[key].push(prevKey);
            if (!edges[prevKey].includes(key)) edges[prevKey].push(key);
          }
        }
      }
      console.log(`✅ Real roads loaded: ${ways.length} ways, ${Object.keys(nodes).length} nodes`);
      applyRoadsAndBots(ways, nodes, edges);
    } catch (e) {
      console.error(`Road fetch attempt ${attempt} failed:`, e);
      if (attempt < 3) {
        setTimeout(() => fetchRoads(attempt + 1), 2000);
      } else {
        console.log('Using dense fallback grid');
        setLoadingStatus('✅ Ready (offline grid mode)');
        const { nodes, edges, ways } = buildDenseGrid();
        applyRoadsAndBots(ways, nodes, edges);
      }
    }
  };

  // ── Helpers ──────────────────────────────────────────────────────────────

  const findClosestNode = (target: [number, number]): string => {
    const { nodes, edges } = graphRef.current;
    const keys = Object.keys(nodes).filter(k => (edges[k]?.length ?? 0) > 0);
    if (!keys.length) return toKey(target[0], target[1]);
    let best = keys[0], bestDist = Infinity;
    for (const k of keys) {
      const d = haversine(target, nodes[k]);
      if (d < bestDist) { bestDist = d; best = k; }
    }
    return best;
  };

  /** Try to detect and register a territory from a path. Returns true if captured. */
  const tryCapture = (
    path: [number, number][],
    ownerId: string,
    ownerName: string,
    color: string,
    isBot: boolean
  ): boolean => {
    const loop = findLoop(path);
    if (!loop) return false;

    // Build polygon from the crossing point onward + the exact intersection point
    const poly: [number, number][] = [loop.point, ...path.slice(loop.idx + 1)];

    // Reject tiny noise polygons (< 500 m²)
    if (poly.length < 4 || polygonArea(poly) < 500) return false;

    const newTerritory: Territory = {
      id: `t_${ownerId}_${Date.now()}`,
      owner: ownerId,
      ownerName,
      color,
      polygon: poly,
    };

    setTerritories(t => [...t, newTerritory]);

    if (!isBot) {
      capturedRef.current += 1;
      setCaptured(capturedRef.current);
      setToastType('capture');
      setToast(`🏆 Territory Captured! You own ${capturedRef.current} zone${capturedRef.current > 1 ? 's' : ''}!`);
      setTimeout(() => setToast(''), 3500);
      saveTerritoryToFirebase(newTerritory);
    } else {
      setToastType('warning');
      setToast(`⚠️ ${ownerName} captured an area!`);
      setTimeout(() => setToast(''), 2500);
    }
    return true;
  };

  // ── GPS tracking ─────────────────────────────────────────────────────────

  const handleGPSLocation = (pos: [number, number]) => {
    setMyLocation(pos);
    if (!isRunningRef.current || gpsModeRef.current === false) return;

    const prev = pathRef.current[pathRef.current.length - 1];
    if (prev) {
      const meters = haversine(prev, pos);
      if (meters < 8) return; // filter jitter
      const km = meters / 1000;
      distanceRef.current += km;
      setDistance(distanceRef.current);
    }

    pathRef.current = [...pathRef.current, pos];
    setRunPath([...pathRef.current]);

    if (userRef.current) {
      const captured = tryCapture(pathRef.current, userRef.current.id, userRef.current.name, PLAYER_COLOR, false);
      if (captured) {
        // Reset path to just the last point so next loop starts fresh
        pathRef.current = [pos];
        setRunPath([pos]);
      }
    }
  };

  // ── Simulate loop ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isRunning || !startTime || gpsMode) return;
    const { edges, nodes } = graphRef.current;

    // Spread bots across the road network
    const allConnectedKeys = Object.keys(nodes).filter(k => (edges[k]?.length ?? 0) >= 2);
    if (!allConnectedKeys.length) return;

    const botIds = ['bot1', 'bot2', 'bot3'] as const;
    const botNames: Record<string, string> = { bot1: 'Alex', bot2: 'Sarah', bot3: 'Mike' };

    botIds.forEach((botId, i) => {
      if (!botStatesRef.current[botId]) {
        const startKey = allConnectedKeys[Math.floor((allConnectedKeys.length / 4) * (i + 1))];
        botStatesRef.current[botId] = {
          currentNode: startKey,
          path: [nodes[startKey]],
          visited: [startKey],
          target: null,
          steps: 0,
        };
      }
    });

    // Player starting state
    if (!currentNodeRef.current) {
      const startNode = findClosestNode(CAMPUS_CENTER);
      currentNodeRef.current = startNode;
      pathRef.current = [nodes[startNode] || CAMPUS_CENTER];
    }

    const TICK_MS = 800; // faster ticks, 1 move per tick = more natural
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));

      // ── Move player (simulate) ──
      {
        const cur = currentNodeRef.current;
        const neighbours = (edges[cur] || []).filter(n => nodes[n]);
        if (neighbours.length) {
          // Simple player: random but prefer unvisited
          const recentSet = new Set(pathRef.current.slice(-15).map(p => toKey(p[0], p[1])));
          const fresh = neighbours.filter(n => !recentSet.has(n));
          const pool = fresh.length ? fresh : neighbours;
          const next = pool[Math.floor(Math.random() * pool.length)];
          const newPos: [number, number] = nodes[next];
          pathRef.current = [...pathRef.current, newPos];
          const didCapture = tryCapture(pathRef.current, userRef.current!.id, userRef.current!.name, PLAYER_COLOR, false);
          if (didCapture) {
            pathRef.current = [newPos];
          }
          currentNodeRef.current = next;
          distanceRef.current += haversine(nodes[cur] || CAMPUS_CENTER, newPos) / 1000;
          setDistance(distanceRef.current);
          setRunPath([...pathRef.current]);
        }
      }

      // ── Move bots ──
      botIds.forEach(botId => {
        const bot = botStatesRef.current[botId];
        if (!bot) return;

        const { nextNode, newTarget } = pickNextNode(bot, edges, nodes);
        if (!nodes[nextNode]) return;

        const newPos: [number, number] = nodes[nextNode];
        const newPath = [...bot.path, newPos];
        const didCapture = tryCapture(newPath, botId, botNames[botId], BOT_COLORS[botId], true);

        botStatesRef.current[botId] = {
          currentNode: nextNode,
          path: didCapture ? [newPos] : newPath,
          visited: [...bot.visited.slice(-40), nextNode],
          target: didCapture ? null : newTarget,
          steps: didCapture ? 0 : bot.steps + 1,
        };

        setBotTrails(prev => ({
          ...prev,
          [botId]: botStatesRef.current[botId].path.slice(-80),
        }));
      });
    }, TICK_MS);

    timerRef.current = interval;
    return () => clearInterval(interval);
  }, [isRunning, startTime, gpsMode]);

  // GPS-only timer
  useEffect(() => {
    if (!isRunning || !gpsMode || !startTime) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(t);
  }, [isRunning, gpsMode, startTime]);

  // ── Start / Stop ─────────────────────────────────────────────────────────

  const startRun = (useGPS = false) => {
    const { nodes } = graphRef.current;
    if (!Object.keys(nodes).length) {
      setGpsError('Still loading — please wait a moment');
      return;
    }
    // Keep initial bot territories only
    setTerritories(t => t.filter(x => ['t1', 't2', 't3'].includes(x.id)));

    const startNode = findClosestNode(CAMPUS_CENTER);
    const startPos = nodes[startNode] || CAMPUS_CENTER;

    currentNodeRef.current = startNode;
    pathRef.current = [startPos];
    capturedRef.current = 0;
    distanceRef.current = 0;
    botStatesRef.current = {};

    setBotTrails({});
    setIsRunning(true);
    isRunningRef.current = true;
    setStartTime(Date.now());
    setRunPath([startPos]);
    setDistance(0);
    setElapsed(0);
    setCaptured(0);
    setGpsMode(useGPS);
    gpsModeRef.current = useGPS;
    setGpsError('');

    if (useGPS && !navigator.geolocation) {
      setGpsError('GPS not supported on this device');
    }
  };

  const stopRun = () => {
    const fd = distanceRef.current;
    const ft = elapsed;
    const fc = capturedRef.current;

    setIsRunning(false);
    isRunningRef.current = false;
    setRunPath([]);
    setBotTrails({});
    if (timerRef.current) clearInterval(timerRef.current);
    setGpsMode(false);
    gpsModeRef.current = false;

    if (!userRef.current) return;
    const today = new Date().toDateString();
    const alreadyRanToday = (userRef.current.lastRunDate || '') === today;
    const updated: User = {
      ...userRef.current,
      totalDistance: (userRef.current.totalDistance || 0) + fd,
      streak: alreadyRanToday ? userRef.current.streak : (userRef.current.streak || 0) + 1,
      lastRunDate: today,
    };
    setUser(updated);
    userRef.current = updated;
    updateUser(updated);
    setSummaryData({ time: ft, dist: fd, zones: fc });
    setShowSummary(true);
    setTimeout(() => setShowSummary(false), 6000);
  };

  // ── UI helpers ────────────────────────────────────────────────────────────

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  if (!user) return null;
  const myCount = territories.filter(t => t.owner === user.id).length;

  return (
    <div style={{ position: 'relative', height: '100vh', background: '#080808', fontFamily: "'Barlow', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@700;800;900&display=swap" rel="stylesheet" />

      <MapContainer center={myLocation || CAMPUS_CENTER} zoom={17} style={{ height: 'calc(100vh - 80px)', zIndex: 1 }} zoomControl={false}>
        <TileLayer attribution="Esri" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
        <LocationTracker onLocation={handleGPSLocation} />

        {roads.map(r => (
          <Polyline key={r.id} positions={r.coords} pathOptions={{ color: '#ffffff', weight: 1.5, opacity: 0.25, dashArray: '4 4' }} />
        ))}

        {territories.map(t => (
          <Polygon key={t.id} positions={t.polygon} pathOptions={{ color: t.color, fillColor: t.color, fillOpacity: 0.3, opacity: 1, weight: 3 }} />
        ))}

        {Object.entries(botTrails).map(([botId, trail]) =>
          trail.length > 1 ? (
            <Polyline key={`trail_${botId}`} positions={trail}
              pathOptions={{ color: BOT_COLORS[botId], weight: 4, opacity: 0.95 }} />
          ) : null
        )}

        {myLocation && <Marker position={myLocation} />}
        {runPath.length > 1 && (
          <Polyline positions={runPath} pathOptions={{ color: PLAYER_COLOR, weight: 4, opacity: 0.9 }} />
        )}
      </MapContainer>

      {/* Loading overlay */}
      {!roadsLoaded && (
        <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, background: 'rgba(0,0,0,0.85)', color: 'white', padding: '10px 24px', borderRadius: 999, fontSize: 14 }}>
          {loadingStatus}
        </div>
      )}

      {/* Start buttons */}
      {!isRunning && roadsLoaded && (
        <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={() => startRun(false)} style={{ background: '#00FF87', color: 'black', fontWeight: 900, padding: '12px 20px', borderRadius: 16, border: 'none', cursor: 'pointer', fontSize: 14, fontFamily: "'Barlow Condensed',sans-serif" }}>▶ SIMULATE</button>
          <button onClick={() => startRun(true)} style={{ background: '#3b82f6', color: 'white', fontWeight: 900, padding: '12px 20px', borderRadius: 16, border: 'none', cursor: 'pointer', fontSize: 14, fontFamily: "'Barlow Condensed',sans-serif" }}>📍 GPS RUN</button>
          {gpsError && <p style={{ color: '#ef4444', fontSize: 11, textAlign: 'center', margin: 0 }}>{gpsError}</p>}
        </div>
      )}

      {/* Run HUD */}
      {isRunning && (
        <div style={{ position: 'absolute', top: 16, left: 16, right: 16, zIndex: 9999 }}>
          <div style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 24, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ fontSize: 40, fontWeight: 900, color: '#00FF87', margin: 0, fontFamily: "'Barlow Condensed',sans-serif" }}>{fmt(elapsed)}</p>
                <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
                  <span style={{ color: 'white', fontSize: 14, fontWeight: 600 }}>{distance.toFixed(2)} <span style={{ color: '#666', fontSize: 12 }}>km</span></span>
                  <span style={{ color: 'white', fontSize: 14, fontWeight: 600 }}>{captured} <span style={{ color: '#666', fontSize: 12 }}>zones</span></span>
                </div>
              </div>
              <button onClick={stopRun} style={{ background: '#ef4444', color: 'white', fontWeight: 900, padding: '12px 24px', borderRadius: 16, border: 'none', cursor: 'pointer', fontSize: 14, fontFamily: "'Barlow Condensed',sans-serif" }}>STOP</button>
            </div>
            <p style={{ color: '#555', fontSize: 11, textAlign: 'center', marginTop: 8 }}>
              {gpsMode ? '📍 GPS active — walk outside to draw territory' : '🛣️ Simulated — bots racing on real roads'}
            </p>
            {gpsError && <p style={{ color: '#ef4444', fontSize: 11, textAlign: 'center', marginTop: 4 }}>{gpsError}</p>}
          </div>
        </div>
      )}

      {/* Leaderboard strip */}
      <div style={{ position: 'absolute', bottom: 96, left: 16, right: 16, zIndex: 9999 }}>
        <div style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '12px 16px', display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
          {[
            { label: 'You', color: '#00FF87', count: myCount },
            { label: 'Alex', color: '#00C6FF', count: territories.filter(t => t.owner === 'bot1').length },
            { label: 'Sarah', color: '#FF6B6B', count: territories.filter(t => t.owner === 'bot2').length },
            { label: 'Mike', color: '#C77DFF', count: territories.filter(t => t.owner === 'bot3').length }
          ].map((p, i) => (
            <div key={i}>
              <p style={{ color: p.color, fontWeight: 900, fontSize: 22, margin: 0, fontFamily: "'Barlow Condensed',sans-serif" }}>{p.count}</p>
              <p style={{ color: '#666', fontSize: 11, margin: 0 }}>{p.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'absolute', top: '33%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 9999, textAlign: 'center' }}>
          <div style={{ background: toastType === 'capture' ? '#00FF87' : '#FF6B6B', color: 'black', fontWeight: 900, padding: '16px 24px', borderRadius: 16, fontSize: 16, border: '3px solid white', whiteSpace: 'nowrap', fontFamily: "'Barlow Condensed',sans-serif" }}>{toast}</div>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 8, fontWeight: 600 }}>
            {toastType === 'capture' ? 'Keep running for more!' : 'Compete to take it back!'}
          </p>
        </div>
      )}

      {/* Run summary modal */}
      {showSummary && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, backdropFilter: 'blur(10px)' }}>
          <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 24, padding: 32, maxWidth: 360, width: '90%', textAlign: 'center' }}>
            <p style={{ color: '#00FF87', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Activity Complete</p>
            <h2 style={{ color: 'white', fontSize: 44, fontWeight: 900, margin: '0 0 24px', fontFamily: "'Barlow Condensed',sans-serif" }}>RUN COMPLETE!</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
              {[
                { label: 'Time', value: fmt(summaryData.time) },
                { label: 'Distance', value: `${summaryData.dist.toFixed(2)} km` },
                { label: 'Territories', value: `${summaryData.zones} zones` },
                { label: 'Streak', value: `🔥 ${user.streak || 0} days` }
              ].map((s, i) => (
                <div key={i} style={{ background: '#1a1a1a', borderRadius: 16, padding: 16 }}>
                  <p style={{ color: 'white', fontSize: 22, fontWeight: 900, margin: 0, fontFamily: "'Barlow Condensed',sans-serif" }}>{s.value}</p>
                  <p style={{ color: '#666', fontSize: 11, margin: '4px 0 0' }}>{s.label}</p>
                </div>
              ))}
            </div>
            <button onClick={() => setShowSummary(false)} style={{ width: '100%', background: '#00FF87', color: 'black', fontWeight: 900, padding: '16px', borderRadius: 16, border: 'none', cursor: 'pointer', fontSize: 16, fontFamily: "'Barlow Condensed',sans-serif" }}>DONE</button>
          </div>
        </div>
      )}

      <BottomNavigation />
    </div>
  );
}