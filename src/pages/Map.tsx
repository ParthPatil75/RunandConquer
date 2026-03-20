import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Polygon, Polyline, useMap } from 'react-leaflet';
import { getCurrentUser, updateUser, saveTerritoryToFirebase, subscribeToTerritories } from '../utils/storage';
import { User } from '../types';
import BottomNavigation from '../components/BottomNavigation';
import 'leaflet/dist/leaflet.css';

const BOT_COLORS: Record<string,string> = { bot1:'#4D96FF', bot2:'#FF922B', bot3:'#CC5DE8' };
const PLAYER_COLOR = '#39d353';
const CAMPUS_CENTER: [number,number] = [18.4926, 74.0255];
const BBOX = '18.488,74.018,18.500,74.032';

interface RoadWay { id: number; coords: [number,number][] }
interface Territory { id:string; owner:string; ownerName:string; polygon:[number,number][]; color:string; }

const segmentsIntersect = (p1:[number,number],p2:[number,number],p3:[number,number],p4:[number,number]):boolean => {
  const d1=[p2[0]-p1[0],p2[1]-p1[1]], d2=[p4[0]-p3[0],p4[1]-p3[1]];
  const cross=d1[0]*d2[1]-d1[1]*d2[0];
  if(Math.abs(cross)<1e-10) return false;
  const t=((p3[0]-p1[0])*d2[1]-(p3[1]-p1[1])*d2[0])/cross;
  const u=((p3[0]-p1[0])*d1[1]-(p3[1]-p1[1])*d1[0])/cross;
  return t>0.05&&t<0.95&&u>0.05&&u<0.95;
};

const findIntersectionIdx = (path:[number,number][]):number => {
  if(path.length<5) return -1;
  const last=path[path.length-1], prev=path[path.length-2];
  for(let i=0;i<path.length-4;i++) if(segmentsIntersect(prev,last,path[i],path[i+1])) return i;
  return -1;
};

function LocationTracker({ onLocation }: { onLocation: (pos:[number,number]) => void }) {
  const map = useMap();
  useEffect(() => {
    map.locate({ watch: true, enableHighAccuracy: true, maximumAge: 3000 });
    map.on('locationfound', (e) => {
      if (e.accuracy > 30) return;
      onLocation([e.latlng.lat, e.latlng.lng]);
      map.panTo(e.latlng);
    });
    map.on('locationerror', (e) => { console.log('GPS error:', e.message); });
    return () => { map.stopLocate(); };
  }, [map]);
  return null;
}

export default function Map() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User|null>(null);
  const [roads, setRoads] = useState<RoadWay[]>([]);
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [roadsLoaded, setRoadsLoaded] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [runPath, setRunPath] = useState<[number,number][]>([]);
  const [botTrails, setBotTrails] = useState<Record<string,[number,number][]>>({});
  const [distance, setDistance] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [startTime, setStartTime] = useState<number|null>(null);
  const [captured, setCaptured] = useState(0);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState<'capture'|'warning'>('capture');
  const [showSummary, setShowSummary] = useState(false);
  const [gpsMode, setGpsMode] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [myLocation, setMyLocation] = useState<[number,number]|null>(null);
  const [summaryData, setSummaryData] = useState({time:0,dist:0,zones:0});

  const watchIdRef = useRef<number|null>(null);
  const currentNodeRef = useRef<string>('');
  const pathRef = useRef<[number,number][]>([]);
  const capturedRef = useRef(0);
  const userRef = useRef<User|null>(null);
  const adjRef = useRef<Record<string,string[]>>({});
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const botPathsRef = useRef<Record<string,[number,number][]>>({});
  const botCurrentNodeRef = useRef<Record<string,string>>({});
  const botVisitedRef = useRef<Record<string,string[]>>({});

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

  const fetchRoads = async () => {
    try {
      const query = `[out:json];way[highway](${BBOX});out geom;`;
      const res = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
      const data = await res.json();
      const ways: RoadWay[] = [];
      const adj: Record<string,string[]> = {};
      for (const el of data.elements) {
        if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
        const coords: [number,number][] = el.geometry.map((g:any) => [g.lat, g.lon]);
        ways.push({ id: el.id, coords });
        for (let i = 0; i < coords.length-1; i++) {
          const a=`${coords[i][0].toFixed(5)},${coords[i][1].toFixed(5)}`;
          const b=`${coords[i+1][0].toFixed(5)},${coords[i+1][1].toFixed(5)}`;
          if(!adj[a]) adj[a]=[];
          if(!adj[b]) adj[b]=[];
          if(!adj[a].includes(b)) adj[a].push(b);
          if(!adj[b].includes(a)) adj[b].push(a);
        }
      }
      setRoads(ways);
      adjRef.current = adj;
      if (ways.length >= 3) {
        const makePolygon = (startIdx: number): [number,number][] => {
          const pts: [number,number][] = [];
          for (let w = startIdx; w < startIdx+3 && w < ways.length; w++) {
            pts.push(...ways[w].coords.slice(0,3));
          }
          return pts;
        };
        setTerritories([
          { id:'t1', owner:'bot1', ownerName:'Alex Runner', color:BOT_COLORS.bot1, polygon:makePolygon(0) },
          { id:'t2', owner:'bot2', ownerName:'Sarah Sprint', color:BOT_COLORS.bot2, polygon:makePolygon(Math.floor(ways.length/3)) },
          { id:'t3', owner:'bot3', ownerName:'Mike Marathon', color:BOT_COLORS.bot3, polygon:makePolygon(Math.floor(ways.length*2/3)) },
        ]);
      }
      setRoadsLoaded(true);
    } catch(e) { setRoadsLoaded(true); }
  };

  const findStartNode = ():string => {
    const nodes = Object.keys(adjRef.current);
    if (!nodes.length) return `${CAMPUS_CENTER[0]},${CAMPUS_CENTER[1]}`;
    let best = nodes[0]; let bestDist = Infinity;
    for (const k of nodes) {
      const [la,ln] = k.split(',').map(Number);
      const d = Math.abs(la-CAMPUS_CENTER[0]) + Math.abs(ln-CAMPUS_CENTER[1]);
      if (d < bestDist) { bestDist = d; best = k; }
    }
    return best;
  };

  const handleCapture = (newPos:[number,number], path:[number,number][]):boolean => {
    const idx = findIntersectionIdx(path);
    if (idx >= 0) {
      const poly = path.slice(idx) as [number,number][];
      if (poly.length >= 3) {
        const u = userRef.current!;
        const newTerritory = {
          id:`t_${Date.now()}`, owner:u.id, ownerName:u.name,
          color:PLAYER_COLOR, polygon:poly,
        };
        setTerritories(t => [...t, newTerritory]);
        capturedRef.current += 1;
        setCaptured(capturedRef.current);
        setToastType('capture');
        setToast(`🏆 Territory Captured! You own ${capturedRef.current} area${capturedRef.current>1?'s':''}!`);
        setTimeout(()=>setToast(''),3500);
        pathRef.current = [newPos];
        saveTerritoryToFirebase(newTerritory);
        return true;
      }
    }
    return false;
  };

  const handleGPSLocation = (pos:[number,number]) => {
    setMyLocation(pos);
    if (!isRunning) return;
    if (pathRef.current.length >= 1) {
      const prev = pathRef.current[pathRef.current.length-1];
      const R = 6371000;
      const dLat = (pos[0]-prev[0])*Math.PI/180;
      const dLon = (pos[1]-prev[1])*Math.PI/180;
      const a = Math.sin(dLat/2)**2 + Math.cos(prev[0]*Math.PI/180)*Math.cos(pos[0]*Math.PI/180)*Math.sin(dLon/2)**2;
      const meters = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      if (meters < 8) return;
      setDistance(d => d + meters/1000);
    }
    const newPath = [...pathRef.current, pos];
    pathRef.current = newPath;
    setRunPath([...newPath]);
    handleCapture(pos, newPath);
  };

  useEffect(() => {
    if (!isRunning || !startTime || gpsMode) return;
    const adj = adjRef.current;
    const botNames:Record<string,string> = { bot1:'Alex', bot2:'Sarah', bot3:'Mike' };

    // Initialize bots at different road nodes
    const allNodes = Object.keys(adj);
    if (allNodes.length > 0) {
      ['bot1','bot2','bot3'].forEach((botId, i) => {
        if (!botCurrentNodeRef.current[botId]) {
          const startIdx = Math.floor((allNodes.length / 4) * (i + 1));
          const startNode = allNodes[startIdx] || allNodes[0];
          const [la,ln] = startNode.split(',').map(Number);
          botCurrentNodeRef.current[botId] = startNode;
          botPathsRef.current[botId] = [[la,ln]];
          botVisitedRef.current[botId] = [startNode];
        }
      });
    }

    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now()-startTime)/1000));
      setDistance(p => p+0.008);

      // Player movement
      const cur = currentNodeRef.current;
      const neighbors = adj[cur] || [];
      if (neighbors.length) {
        const next = neighbors[Math.floor(Math.random()*neighbors.length)];
        const [la,ln] = next.split(',').map(Number);
        const newPos:[number,number] = [la,ln];
        const newPath = [...pathRef.current, newPos];
        pathRef.current = newPath;
        setRunPath([...newPath]);
        handleCapture(newPos, newPath);
        currentNodeRef.current = next;
      }

      // Bot movement on real roads
      ['bot1','bot2','bot3'].forEach(botId => {
        const curNode = botCurrentNodeRef.current[botId];
        if (!curNode) return;
        const botNeighbors = adj[curNode] || [];
        if (!botNeighbors.length) return;

        // Prefer unvisited roads like a real runner exploring
        const visited = botVisitedRef.current[botId] || [];
        const unvisited = botNeighbors.filter(n => !visited.includes(n));
        const nextNode = unvisited.length > 0
          ? unvisited[Math.floor(Math.random() * unvisited.length)]
          : botNeighbors[Math.floor(Math.random() * botNeighbors.length)];

        const [bLa,bLn] = nextNode.split(',').map(Number);
        const newBotPos:[number,number] = [bLa, bLn];
        const currentBotPath = botPathsRef.current[botId] || [];
        const newBotPath = [...currentBotPath, newBotPos];
        botPathsRef.current[botId] = newBotPath;
        botCurrentNodeRef.current[botId] = nextNode;
        botVisitedRef.current[botId] = [...visited.slice(-50), nextNode];

        // Update bot trail on map
        setBotTrails(prev => ({...prev, [botId]: newBotPath.slice(-30)}));

        // Check if bot path loops → capture territory
        const crossIdx = findIntersectionIdx(newBotPath);
        if (crossIdx >= 0) {
          const poly = newBotPath.slice(crossIdx) as [number,number][];
          if (poly.length >= 3) {
            setTerritories(t => [...t, {
              id:`tb_${botId}_${Date.now()}`, owner:botId,
              ownerName:botNames[botId], color:BOT_COLORS[botId], polygon:poly
            }]);
            setToastType('warning');
            setToast(`⚠️ ${botNames[botId]} captured an area!`);
            setTimeout(()=>setToast(''),2500);
            // Reset bot path
            botPathsRef.current[botId] = [newBotPos];
            botVisitedRef.current[botId] = [nextNode];
            setBotTrails(prev => ({...prev, [botId]: [newBotPos]}));
          }
        }
      });
    }, 800);

    timerRef.current = interval;
    return () => clearInterval(interval);
  }, [isRunning, startTime, gpsMode]);

  useEffect(() => {
    if (!isRunning || !gpsMode || !startTime) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now()-startTime)/1000)), 1000);
    return () => clearInterval(t);
  }, [isRunning, gpsMode, startTime]);

  const startRun = (useGPS = false) => {
    const start = findStartNode();
    const [la,ln] = start.split(',').map(Number);
    currentNodeRef.current = start;
    pathRef.current = [[la,ln]];
    capturedRef.current = 0;
    // Reset bots
    botPathsRef.current = {};
    botCurrentNodeRef.current = {};
    botVisitedRef.current = {};
    setBotTrails({});
    setIsRunning(true); setStartTime(Date.now());
    setRunPath([[la,ln]]); setDistance(0); setElapsed(0); setCaptured(0);
    setGpsMode(useGPS); setGpsError('');
    if (useGPS && !navigator.geolocation) setGpsError('GPS not supported on this device');
  };

  const stopRun = () => {
    const fd=distance, ft=elapsed, fc=capturedRef.current;
    setIsRunning(false); setRunPath([]); setBotTrails({});
    if (watchIdRef.current !== null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
    if (timerRef.current) clearInterval(timerRef.current);
    setGpsMode(false);
    const today = new Date().toDateString();
    const alreadyRanToday = (userRef.current!.lastRunDate||'') === today;
    const updated = {
      ...userRef.current!,
      totalDistance: (userRef.current!.totalDistance||0) + fd,
      streak: alreadyRanToday ? userRef.current!.streak : (userRef.current!.streak||0)+1,
      lastRunDate: today,
    };
    setUser(updated); userRef.current = updated; updateUser(updated);
    setSummaryData({time:ft, dist:fd, zones:fc});
    setShowSummary(true);
    setTimeout(()=>setShowSummary(false), 6000);
  };

  const fmt = (s:number) => `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;
  if (!user) return null;
  const myCount = territories.filter(t=>t.owner===user.id).length;

  return (
    <div style={{position:'relative', height:'100vh', background:'#080808', fontFamily:"'Barlow', sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@700;800;900&display=swap" rel="stylesheet"/>
      <MapContainer center={CAMPUS_CENTER} zoom={16} style={{height:'calc(100vh - 80px)', zIndex:1}} zoomControl={false}>
        <TileLayer attribution="Esri" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"/>
        {gpsMode && <LocationTracker onLocation={handleGPSLocation}/>}
        {roads.map(r=>(<Polyline key={r.id} positions={r.coords} pathOptions={{color:'#ffffff',weight:1.5,opacity:0.3,dashArray:'4 4'}}/>))}
        {territories.map(t=>(<Polygon key={t.id} positions={t.polygon} pathOptions={{color:t.color,fillColor:t.color,fillOpacity:0.4,weight:2}}/>))}

        {/* Bot trails on real roads */}
        {Object.entries(botTrails).map(([botId, trail]) =>
          trail.length > 1 ? (
            <Polyline key={`trail_${botId}`} positions={trail}
              pathOptions={{color:BOT_COLORS[botId], weight:3, opacity:0.7, dashArray:'6 3'}}/>
          ) : null
        )}

        {myLocation && (<Polygon positions={[[myLocation[0]+0.00005,myLocation[1]],[myLocation[0],myLocation[1]+0.00005],[myLocation[0]-0.00005,myLocation[1]],[myLocation[0],myLocation[1]-0.00005]]} pathOptions={{color:'#39d353',fillColor:'#39d353',fillOpacity:1,weight:2}}/>)}
        {runPath.length>1 && (<Polyline positions={runPath} pathOptions={{color:'#39d353',weight:4,opacity:0.9}}/>)}
      </MapContainer>

      {!roadsLoaded && (
        <div style={{position:'absolute',top:16,left:'50%',transform:'translateX(-50%)',zIndex:9999,background:'rgba(0,0,0,0.8)',color:'white',padding:'8px 20px',borderRadius:999,fontSize:14}}>
          Loading campus roads...
        </div>
      )}

      {!isRunning && roadsLoaded && (
        <div style={{position:'absolute',top:16,right:16,zIndex:9999,display:'flex',flexDirection:'column',gap:8}}>
          <button onClick={()=>startRun(false)} style={{background:'#39d353',color:'black',fontWeight:900,padding:'12px 20px',borderRadius:16,border:'none',cursor:'pointer',fontSize:14,fontFamily:"'Barlow Condensed',sans-serif"}}>▶ SIMULATE</button>
          <button onClick={()=>startRun(true)} style={{background:'#3b82f6',color:'white',fontWeight:900,padding:'12px 20px',borderRadius:16,border:'none',cursor:'pointer',fontSize:14,fontFamily:"'Barlow Condensed',sans-serif"}}>📍 GPS RUN</button>
        </div>
      )}

      {isRunning && (
        <div style={{position:'absolute',top:16,left:16,right:16,zIndex:9999}}>
          <div style={{background:'rgba(0,0,0,0.85)',backdropFilter:'blur(10px)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:24,padding:16}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div>
                <p style={{fontSize:40,fontWeight:900,color:'#39d353',margin:0,fontFamily:"'Barlow Condensed',sans-serif"}}>{fmt(elapsed)}</p>
                <div style={{display:'flex',gap:16,marginTop:4}}>
                  <span style={{color:'white',fontSize:14,fontWeight:600}}>{distance.toFixed(2)} <span style={{color:'#666',fontSize:12}}>km</span></span>
                  <span style={{color:'white',fontSize:14,fontWeight:600}}>{captured} <span style={{color:'#666',fontSize:12}}>zones</span></span>
                </div>
              </div>
              <button onClick={stopRun} style={{background:'#ef4444',color:'white',fontWeight:900,padding:'12px 24px',borderRadius:16,border:'none',cursor:'pointer',fontSize:14,fontFamily:"'Barlow Condensed',sans-serif"}}>STOP</button>
            </div>
            <p style={{color:'#555',fontSize:11,textAlign:'center',marginTop:8}}>
              {gpsMode ? '📍 GPS active — walk outside to draw territory' : '🛣️ Simulated — looping roads to capture'}
            </p>
            {gpsError && <p style={{color:'#ef4444',fontSize:11,textAlign:'center',marginTop:4}}>{gpsError}</p>}
          </div>
        </div>
      )}

      <div style={{position:'absolute',bottom:96,left:16,right:16,zIndex:9999}}>
        <div style={{background:'rgba(0,0,0,0.85)',backdropFilter:'blur(10px)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:16,padding:'12px 16px',display:'flex',justifyContent:'space-around',textAlign:'center'}}>
          {[{label:'You',color:'#39d353',count:myCount},{label:'Alex',color:'#4D96FF',count:territories.filter(t=>t.owner==='bot1').length},{label:'Sarah',color:'#FF922B',count:territories.filter(t=>t.owner==='bot2').length},{label:'Mike',color:'#CC5DE8',count:territories.filter(t=>t.owner==='bot3').length}].map((p,i)=>(
            <div key={i}>
              <p style={{color:p.color,fontWeight:900,fontSize:22,margin:0,fontFamily:"'Barlow Condensed',sans-serif"}}>{p.count}</p>
              <p style={{color:'#666',fontSize:11,margin:0}}>{p.label}</p>
            </div>
          ))}
        </div>
      </div>

      {toast && (
        <div style={{position:'absolute',top:'33%',left:'50%',transform:'translate(-50%,-50%)',zIndex:9999,textAlign:'center'}}>
          <div style={{background:toastType==='capture'?'#39d353':'#FF922B',color:'black',fontWeight:900,padding:'16px 24px',borderRadius:16,fontSize:16,border:'3px solid white',whiteSpace:'nowrap',fontFamily:"'Barlow Condensed',sans-serif"}}>{toast}</div>
          <p style={{color:'rgba(255,255,255,0.7)',fontSize:12,marginTop:8,fontWeight:600}}>{toastType==='capture'?'Keep running for more!':'Compete to take it back!'}</p>
        </div>
      )}

      {showSummary && (
        <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.9)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999,backdropFilter:'blur(10px)'}}>
          <div style={{background:'#111',border:'1px solid #2a2a2a',borderRadius:24,padding:32,maxWidth:360,width:'90%',textAlign:'center'}}>
            <p style={{color:'#39d353',fontSize:11,fontWeight:600,letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:4}}>Activity Complete</p>
            <h2 style={{color:'white',fontSize:44,fontWeight:900,margin:'0 0 24px',fontFamily:"'Barlow Condensed',sans-serif"}}>RUN COMPLETE!</h2>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:24}}>
              {[{label:'Time',value:fmt(summaryData.time)},{label:'Distance',value:`${summaryData.dist.toFixed(2)} km`},{label:'Territories',value:`${summaryData.zones} zones`},{label:'Streak',value:`🔥 ${user.streak||0} days`}].map((s,i)=>(
                <div key={i} style={{background:'#1a1a1a',borderRadius:16,padding:16}}>
                  <p style={{color:'white',fontSize:22,fontWeight:900,margin:0,fontFamily:"'Barlow Condensed',sans-serif"}}>{s.value}</p>
                  <p style={{color:'#666',fontSize:11,margin:'4px 0 0'}}>{s.label}</p>
                </div>
              ))}
            </div>
            <button onClick={()=>setShowSummary(false)} style={{width:'100%',background:'#39d353',color:'black',fontWeight:900,padding:'16px',borderRadius:16,border:'none',cursor:'pointer',fontSize:16,fontFamily:"'Barlow Condensed',sans-serif"}}>DONE</button>
          </div>
        </div>
      )}
      <BottomNavigation />
    </div>
  );
}
```

Press **Ctrl+S** → then push to Vercel:
```
git add .
git commit -m "bots follow real roads like real runners"
git push