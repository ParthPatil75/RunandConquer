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

const segmentsIntersect = (p1: [number, number], p2: [number, number], p3: [number, number], p4: [number, number]): boolean => {
  const d1 = [p2[0] - p1[0], p2[1] - p1[1]], d2 = [p4[0] - p3[0], p4[1] - p3[1]];
  const cross = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(cross) < 1e-10) return false;
  const t = ((p3[0] - p1[0]) * d2[1] - (p3[1] - p1[1]) * d2[0]) / cross;
  const u = ((p3[0] - p1[0]) * d1[1] - (p3[1] - p1[1]) * d1[0]) / cross;
  return t > 0.05 && t < 0.95 && u > 0.05 && u < 0.95;
};

const findIntersectionIdx = (path: [number, number][]): number => {
  if (path.length < 6) return -1;
  const last = path[path.length - 1], prev = path[path.length - 2];
  for (let i = 0; i < path.length - 5; i++) {
    if (segmentsIntersect(prev, last, path[i], path[i + 1])) return i;
  }
  return -1;
};

// Proximity loop: if end is close to an earlier point — close the loop
const findProximityLoop = (path: [number, number][]): number => {
  if (path.length < 10) return -1;
  const last = path[path.length - 1];
  for (let i = 0; i < path.length - 9; i++) {
    const dx = last[0] - path[i][0];
    const dy = last[1] - path[i][1];
    if (Math.sqrt(dx * dx + dy * dy) < 0.0003) return i; // ~33 metres
  }
  return -1;
};

const toKey = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`;

// FIX: Build a dense grid tightly around campus — bots make loops fast
function buildDenseGrid(): { nodes: Record<string, [number, number]>; edges: Record<string, string[]>; ways: RoadWay[] } {
  const nodes: Record<string, [number, number]> = {};
  const edges: Record<string, string[]> = {};
  const ways: RoadWay[] = [];
  // 40x40 grid = very dense, bots loop quickly
  const steps = 40;
  const latStart = 18.489, lngStart = 74.019;
  const latEnd = 18.499, lngEnd = 74.031;
  const latStep = (latEnd - latStart) / steps;
  const lngStep = (lngEnd - lngStart) / steps;

  // Horizontal roads
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

  // Vertical roads
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

function LocationTracker({ onLocation }: { onLocation: (pos: [number, number]) => void }) {
  const map = useMap();
  const hasLocated = useRef(false);
  useEffect(() => {
    map.locate({ watch: true, enableHighAccuracy: true, maximumAge: 3000 });
    map.on('locationfound', (e) => {
      if (e.accuracy > 5000) return;
      onLocation([e.latlng.lat, e.latlng.lng]);
      if (!hasLocated.current) {
        map.panTo(e.latlng);
        hasLocated.current = true;
      }
    });
    map.on('locationerror', (e) => { console.log('GPS error:', e.message); });
    return () => { map.stopLocate(); };
  }, [map]);
  return null;
}

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

  const watchIdRef = useRef<number | null>(null);
  const currentNodeRef = useRef<string>('');
  const pathRef = useRef<[number, number][]>([]);
  const capturedRef = useRef(0);
  const userRef = useRef<User | null>(null);
  const graphRef = useRef<RoadGraph>({ nodes: {}, edges: {} });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const botCurrentNodeRef = useRef<Record<string, string>>({});
  const botPathsRef = useRef<Record<string, [number, number][]>>({});
  const botVisitedRef = useRef<Record<string, string[]>>({});
  const isRealRoads = useRef(false);

  useEffect(() => {
    const u = getCurrentUser();
    if (!u) { navigate('/'); return; }
    setUser(u); userRef.current = u;
    fetchRoads();
    const unsub = subscribeToTerritories((firebaseTerritories) => {
      setTerritories(current => {
        const mine = current.filter(t => t.owner === userRef.current?.id);
        const others = firebaseTerritories.filter(t => t.owner !== userRef.current?.id);
        return [...mine, ...others];
      });
    });
    return () => unsub();
  }, [navigate]);

  const applyRoadsAndBots = (ways: RoadWay[], nodes: Record<string, [number, number]>, edges: Record<string, string[]>) => {
    graphRef.current = { nodes, edges };
    setRoads(ways);
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
  };

  const fetchRoads = async (attempt = 1) => {
    try {
      setLoadingStatus(`⏳ Loading campus roads... (attempt ${attempt}/3)`);
      const query = `[out:json];way[highway](${BBOX});out geom;`;

      // Try direct first, then proxy
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
      // Handle allorigins wrapper
      if (url.includes('allorigins')) {
        const wrapper = JSON.parse(text);
        data = JSON.parse(wrapper.contents);
      } else {
        data = JSON.parse(text);
      }

      if (!data.elements || data.elements.length === 0) throw new Error('No road data');

      const ways: RoadWay[] = [];
      const nodes: Record<string, [number, number]> = {};
      const edges: Record<string, string[]> = {};

      for (const el of data.elements) {
        if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
        const coords: [number, number][] = el.geometry.map((g: any) => [g.lat, g.lon]);
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

      isRealRoads.current = true;
      console.log(`✅ Real roads loaded: ${ways.length} ways`);
      applyRoadsAndBots(ways, nodes, edges);

    } catch (e) {
      console.error(`Road fetch attempt ${attempt} failed:`, e);
      if (attempt < 3) {
        setTimeout(() => fetchRoads(attempt + 1), 2000);
      } else {
        // Use dense fallback grid — bots will make loops quickly
        console.log('Using dense fallback grid');
        setLoadingStatus('✅ Ready (offline grid mode)');
        const { nodes, edges, ways } = buildDenseGrid();
        isRealRoads.current = false;
        applyRoadsAndBots(ways, nodes, edges);
      }
    }
  };

  const findClosestNode = (target: [number, number]): string => {
    const { nodes } = graphRef.current;
    const keys = Object.keys(nodes).filter(k => graphRef.current.edges[k]?.length > 0);
    if (!keys.length) return `${target[0]},${target[1]}`;
    let best = keys[0]; let bestDist = Infinity;
    for (const k of keys) {
      const [la, ln] = nodes[k];
      const d = Math.abs(la - target[0]) + Math.abs(ln - target[1]);
      if (d < bestDist) { bestDist = d; best = k; }
    }
    return best;
  };

  const handleCapture = (newPos: [number, number], path: [number, number][], ownerId: string, ownerName: string, color: string, isBot = false) => {
    const sliced = path.slice(-80);
    const idx = findIntersectionIdx(sliced) >= 0
      ? findIntersectionIdx(sliced)
      : findProximityLoop(sliced);

    if (idx >= 0) {
      const poly = path.slice(-(sliced.length - idx)) as [number, number][];
      if (poly.length >= 4) {
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
          setToast(`🏆 Territory Captured! You own ${capturedRef.current} area${capturedRef.current > 1 ? 's' : ''}!`);
          setTimeout(() => setToast(''), 3500);
          pathRef.current = [newPos];
          saveTerritoryToFirebase(newTerritory);
        } else {
          setToastType('warning');
          setToast(`⚠️ ${ownerName} captured an area!`);
          setTimeout(() => setToast(''), 2500);
        }
        return true;
      }
    }
    return false;
  };

  const handleGPSLocation = (pos: [number, number]) => {
    setMyLocation(pos);
    if (!isRunning) return;
    if (pathRef.current.length >= 1) {
      const prev = pathRef.current[pathRef.current.length - 1];
      const R = 6371000;
      const dLat = (pos[0] - prev[0]) * Math.PI / 180;
      const dLon = (pos[1] - prev[1]) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(prev[0] * Math.PI / 180) * Math.cos(pos[0] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      const meters = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      if (meters < 8) return;
      setDistance(d => d + meters / 1000);
    }
    const newPath = [...pathRef.current, pos];
    pathRef.current = newPath;
    setRunPath([...newPath]);
    if (userRef.current) {
      handleCapture(pos, newPath, userRef.current.id, userRef.current.name, PLAYER_COLOR, false);
    }
  };

  useEffect(() => {
    if (!isRunning || !startTime || gpsMode) return;
    const { edges, nodes } = graphRef.current;
    const botNames: Record<string, string> = { bot1: 'Alex', bot2: 'Sarah', bot3: 'Mike' };

    // Init bots at well-connected nodes spread across the map
    const allKeys = Object.keys(nodes).filter(k => edges[k] && edges[k].length >= 2);
    if (allKeys.length > 0) {
      ['bot1', 'bot2', 'bot3'].forEach((botId, i) => {
        if (!botCurrentNodeRef.current[botId]) {
          const startKey = allKeys[Math.floor((allKeys.length / 4) * (i + 1))];
          botCurrentNodeRef.current[botId] = startKey;
          botPathsRef.current[botId] = [nodes[startKey]];
          botVisitedRef.current[botId] = [startKey];
        }
      });
    }

    // FIX: 1500ms interval — bots move faster, loops form quicker
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
      setDistance(p => p + 0.004);

      // Move player — 3 steps per tick for faster path building
      for (let step = 0; step < 3; step++) {
        const cur = currentNodeRef.current;
        const neighbors = (edges[cur] || []).filter(n => nodes[n]);
        if (neighbors.length) {
          const next = neighbors[Math.floor(Math.random() * neighbors.length)];
          const newPos: [number, number] = nodes[next];
          if (newPos) {
            const newPath = [...pathRef.current, newPos];
            pathRef.current = newPath;
            if (userRef.current) {
              const captured = handleCapture(newPos, newPath, userRef.current.id, userRef.current.name, PLAYER_COLOR, false);
              if (captured) break;
            }
            currentNodeRef.current = next;
          }
        }
      }
      setRunPath([...pathRef.current]);

      // Move bots — 3 steps per tick
      ['bot1', 'bot2', 'bot3'].forEach(botId => {
        for (let step = 0; step < 3; step++) {
          const curNode = botCurrentNodeRef.current[botId];
          if (!curNode || !nodes[curNode]) return;

          const botNeighbors = (edges[curNode] || []).filter(n => nodes[n]);
          if (!botNeighbors.length) return;

          // Natural movement — avoid backtrack, prefer fresh roads
          const recentVisited = (botVisitedRef.current[botId] || []).slice(-10);
          const lastNode = (botVisitedRef.current[botId] || []).slice(-2)[0];
          const notBacktrack = botNeighbors.filter(n => n !== lastNode);
          const fresh = notBacktrack.filter(n => !recentVisited.includes(n));
          const nextNode = fresh.length > 0
            ? fresh[Math.floor(Math.random() * fresh.length)]
            : notBacktrack.length > 0
              ? notBacktrack[Math.floor(Math.random() * notBacktrack.length)]
              : botNeighbors[Math.floor(Math.random() * botNeighbors.length)];

          const nextPos = nodes[nextNode];
          if (!nextPos) return;

          const currentBotPath = botPathsRef.current[botId] || [];
          const newBotPath = [...currentBotPath, nextPos];
          botPathsRef.current[botId] = newBotPath;
          botCurrentNodeRef.current[botId] = nextNode;
          botVisitedRef.current[botId] = [...(botVisitedRef.current[botId] || []).slice(-50), nextNode];

          // Check capture
          const captured = handleCapture(
            nextPos, newBotPath,
            botId, botNames[botId], BOT_COLORS[botId], true
          );
          if (captured) {
            botPathsRef.current[botId] = [nextPos];
            botVisitedRef.current[botId] = [nextNode];
            break;
          }
        }
        setBotTrails(prev => ({ ...prev, [botId]: (botPathsRef.current[botId] || []).slice(-60) }));
      });

    }, 1500); // FIX: 1500ms — much faster than 3500ms

    timerRef.current = interval;
    return () => clearInterval(interval);
  }, [isRunning, startTime, gpsMode]);

  useEffect(() => {
    if (!isRunning || !gpsMode || !startTime) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(t);
  }, [isRunning, gpsMode, startTime]);

  const startRun = (useGPS = false) => {
    const { nodes } = graphRef.current;
    if (Object.keys(nodes).length === 0) {
      setGpsError('Still loading — please wait a moment');
      return;
    }

    // Keep initial bot territories
    setTerritories(t => t.filter(x => ['t1', 't2', 't3'].includes(x.id)));

    const startNode = findClosestNode(CAMPUS_CENTER);
    const startPos = nodes[startNode] || CAMPUS_CENTER;

    currentNodeRef.current = startNode;
    pathRef.current = [startPos];
    capturedRef.current = 0;
    botCurrentNodeRef.current = {};
    botPathsRef.current = {};
    botVisitedRef.current = {};
    setBotTrails({});
    setIsRunning(true);
    setStartTime(Date.now());
    setRunPath([startPos]);
    setDistance(0);
    setElapsed(0);
    setCaptured(0);
    setGpsMode(useGPS);
    setGpsError('');

    if (useGPS && !navigator.geolocation) {
      setGpsError('GPS not supported on this device');
    }
  };

  const stopRun = () => {
    const fd = distance, ft = elapsed, fc = capturedRef.current;
    setIsRunning(false); setRunPath([]); setBotTrails({});
    if (watchIdRef.current !== null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
    if (timerRef.current) clearInterval(timerRef.current);
    setGpsMode(false);
    if (!userRef.current) return;
    const today = new Date().toDateString();
    const alreadyRanToday = (userRef.current.lastRunDate || '') === today;
    const updated = {
      ...userRef.current,
      totalDistance: (userRef.current.totalDistance || 0) + fd,
      streak: alreadyRanToday ? userRef.current.streak : (userRef.current.streak || 0) + 1,
      lastRunDate: today,
    };
    setUser(updated); userRef.current = updated; updateUser(updated);
    setSummaryData({ time: ft, dist: fd, zones: fc });
    setShowSummary(true);
    setTimeout(() => setShowSummary(false), 6000);
  };

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
          <Polygon key={t.id} positions={t.polygon} pathOptions={{
            color: t.color,
            fillColor: t.color,
            fillOpacity: 0.3,
            opacity: 1,
            weight: 3,
          }} />
        ))}

        {Object.entries(botTrails).map(([botId, trail]) =>
          trail.length > 1 ? (
            <Polyline key={`trail_${botId}`} positions={trail}
              pathOptions={{ color: BOT_COLORS[botId], weight: 4, opacity: 0.95 }} />
          ) : null
        )}

        {myLocation && <Marker position={myLocation} />}
        {runPath.length > 1 && <Polyline positions={runPath} pathOptions={{ color: PLAYER_COLOR, weight: 4, opacity: 0.9 }} />}
      </MapContainer>

      {!roadsLoaded && (
        <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, background: 'rgba(0,0,0,0.85)', color: 'white', padding: '10px 24px', borderRadius: 999, fontSize: 14 }}>
          {loadingStatus}
        </div>
      )}

      {!isRunning && roadsLoaded && (
        <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={() => startRun(false)} style={{ background: '#00FF87', color: 'black', fontWeight: 900, padding: '12px 20px', borderRadius: 16, border: 'none', cursor: 'pointer', fontSize: 14, fontFamily: "'Barlow Condensed',sans-serif" }}>▶ SIMULATE</button>
          <button onClick={() => startRun(true)} style={{ background: '#3b82f6', color: 'white', fontWeight: 900, padding: '12px 20px', borderRadius: 16, border: 'none', cursor: 'pointer', fontSize: 14, fontFamily: "'Barlow Condensed',sans-serif" }}>📍 GPS RUN</button>
          {gpsError && <p style={{ color: '#ef4444', fontSize: 11, textAlign: 'center', margin: 0 }}>{gpsError}</p>}
        </div>
      )}

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
              {gpsMode ? '📍 GPS active — walk outside to draw territory' : '🛣️ Simulated — looping roads to capture'}
            </p>
            {gpsError && <p style={{ color: '#ef4444', fontSize: 11, textAlign: 'center', marginTop: 4 }}>{gpsError}</p>}
          </div>
        </div>
      )}

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

      {toast && (
        <div style={{ position: 'absolute', top: '33%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 9999, textAlign: 'center' }}>
          <div style={{ background: toastType === 'capture' ? '#00FF87' : '#FF6B6B', color: 'black', fontWeight: 900, padding: '16px 24px', borderRadius: 16, fontSize: 16, border: '3px solid white', whiteSpace: 'nowrap', fontFamily: "'Barlow Condensed',sans-serif" }}>{toast}</div>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 8, fontWeight: 600 }}>{toastType === 'capture' ? 'Keep running for more!' : 'Compete to take it back!'}</p>
        </div>
      )}

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