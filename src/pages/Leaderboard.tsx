import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser } from '../utils/storage';
import { User } from '../types';
import BottomNavigation from '../components/BottomNavigation';

const BOT_COLORS: Record<string, string> = {
  bot1: '#4D96FF', bot2: '#FF922B', bot3: '#CC5DE8',
};

const MOCK_STATS: Record<string, { zones: number; distance: number; streak: number }> = {
  bot1: { zones: 5, distance: 45.8, streak: 12 },
  bot2: { zones: 3, distance: 32.4, streak: 8 },
  bot3: { zones: 1, distance: 18.2, streak: 5 },
};

type Tab = 'zones' | 'distance' | 'streak';

export default function Leaderboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<Tab>('zones');

  useEffect(() => {
    const u = getCurrentUser();
    if (!u) { navigate('/'); return; }
    setUser(u);
  }, [navigate]);

  if (!user) return null;

  const players = [
    { id: user.id, name: user.name, avatar: '👤', color: '#39d353',
      zones: user.capturedZones?.length || 0, distance: user.totalDistance || 0,
      streak: user.streak || 0, isMe: true },
    { id: 'bot1', name: 'Alex Runner', avatar: '🏃', color: BOT_COLORS.bot1,
      zones: MOCK_STATS.bot1.zones, distance: MOCK_STATS.bot1.distance,
      streak: MOCK_STATS.bot1.streak, isMe: false },
    { id: 'bot2', name: 'Sarah Sprint', avatar: '⚡', color: BOT_COLORS.bot2,
      zones: MOCK_STATS.bot2.zones, distance: MOCK_STATS.bot2.distance,
      streak: MOCK_STATS.bot2.streak, isMe: false },
    { id: 'bot3', name: 'Mike Marathon', avatar: '🔥', color: BOT_COLORS.bot3,
      zones: MOCK_STATS.bot3.zones, distance: MOCK_STATS.bot3.distance,
      streak: MOCK_STATS.bot3.streak, isMe: false },
  ];

  const sorted = [...players].sort((a, b) => {
    if (tab === 'zones') return b.zones - a.zones;
    if (tab === 'distance') return b.distance - a.distance;
    return b.streak - a.streak;
  });

  const myRank = sorted.findIndex(p => p.isMe) + 1;

  const getValue = (p: typeof players[0]) => {
    if (tab === 'zones') return `${p.zones} zones`;
    if (tab === 'distance') return `${p.distance.toFixed(1)} km`;
    return `${p.streak} days`;
  };

  const rankEmojis = ['🥇', '🥈', '🥉', '4️⃣'];

  return (
    <div className="min-h-screen bg-[#080808] text-white pb-24" style={{fontFamily:"'Barlow', sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@700;800;900&display=swap" rel="stylesheet"/>

      {/* Header */}
      <div className="px-5 pt-14 pb-6">
        <p className="text-[#39d353] text-xs font-semibold tracking-widest uppercase">MIT ADT Campus</p>
        <h1 className="text-4xl font-black tracking-tight mt-1"
          style={{fontFamily:"'Barlow Condensed', sans-serif"}}>
          LEADERBOARD
        </h1>
      </div>

      {/* My rank banner */}
      <div className="px-5 mb-6">
        <div className="rounded-3xl p-5 flex items-center gap-4"
          style={{background:'linear-gradient(135deg, #39d353 0%, #1a8f2e 100%)'}}>
          <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center text-3xl">
            👤
          </div>
          <div className="flex-1">
            <p className="text-white/70 text-xs font-semibold tracking-widest uppercase">Your Rank</p>
            <p className="text-4xl font-black text-white"
              style={{fontFamily:"'Barlow Condensed', sans-serif"}}>
              #{myRank} of {players.length}
            </p>
          </div>
          <div className="text-5xl">{rankEmojis[myRank - 1]}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-5 mb-5">
        <div className="bg-[#111] rounded-2xl p-1 flex gap-1 border border-[#1e1e1e]">
          <button
            onClick={() => setTab('zones')}
            className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${tab === 'zones' ? 'bg-[#39d353] text-black' : 'text-gray-500'}`}
            style={{fontFamily:"'Barlow Condensed', sans-serif"}}>
            🗺 ZONES
          </button>
          <button
            onClick={() => setTab('distance')}
            className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${tab === 'distance' ? 'bg-[#39d353] text-black' : 'text-gray-500'}`}
            style={{fontFamily:"'Barlow Condensed', sans-serif"}}>
            📏 KM
          </button>
          <button
            onClick={() => setTab('streak')}
            className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${tab === 'streak' ? 'bg-[#39d353] text-black' : 'text-gray-500'}`}
            style={{fontFamily:"'Barlow Condensed', sans-serif"}}>
            🔥 STREAK
          </button>
        </div>
      </div>

      {/* Top 3 podium */}
      {sorted.length >= 3 && (
        <div className="px-5 mb-6">
          <div className="flex items-end justify-center gap-3">
            {/* 2nd place */}
            <div className="flex-1 flex flex-col items-center">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl mb-2"
                style={{background:`${sorted[1].color}22`, border:`2px solid ${sorted[1].color}`}}>
                {sorted[1].avatar}
              </div>
              <p className="text-white text-xs font-bold text-center w-full truncate">
                {sorted[1].name.split(' ')[0]}
              </p>
              <p className="text-gray-400 text-xs">{getValue(sorted[1])}</p>
              <div className="w-full bg-[#C0C0C0] rounded-t-xl mt-2 flex items-center justify-center py-3">
                <span className="text-black font-black text-lg"
                  style={{fontFamily:"'Barlow Condensed', sans-serif"}}>2</span>
              </div>
            </div>
            {/* 1st place */}
            <div className="flex-1 flex flex-col items-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl mb-2"
                style={{background:`${sorted[0].color}22`, border:`2px solid ${sorted[0].color}`}}>
                {sorted[0].avatar}
              </div>
              <p className="text-white text-xs font-bold text-center w-full truncate">
                {sorted[0].name.split(' ')[0]}
              </p>
              <p className="text-[#39d353] text-xs font-bold">{getValue(sorted[0])}</p>
              <div className="w-full bg-[#FFD700] rounded-t-xl mt-2 flex items-center justify-center py-5">
                <span className="text-black font-black text-xl"
                  style={{fontFamily:"'Barlow Condensed', sans-serif"}}>1</span>
              </div>
            </div>
            {/* 3rd place */}
            <div className="flex-1 flex flex-col items-center">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl mb-2"
                style={{background:`${sorted[2].color}22`, border:`2px solid ${sorted[2].color}`}}>
                {sorted[2].avatar}
              </div>
              <p className="text-white text-xs font-bold text-center w-full truncate">
                {sorted[2].name.split(' ')[0]}
              </p>
              <p className="text-gray-400 text-xs">{getValue(sorted[2])}</p>
              <div className="w-full bg-[#CD7F32] rounded-t-xl mt-2 flex items-center justify-center py-2">
                <span className="text-black font-black text-lg"
                  style={{fontFamily:"'Barlow Condensed', sans-serif"}}>3</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full ranked list */}
      <div className="px-5 space-y-2">
        {sorted.map((p, i) => (
          <div key={p.id}
            className={`rounded-2xl p-4 flex items-center gap-3 border ${
              p.isMe
                ? 'border-[#39d353]/50 bg-[#39d353]/10'
                : 'border-[#1e1e1e] bg-[#111]'
            }`}>
            <span className="text-2xl w-8 text-center">{rankEmojis[i]}</span>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
              style={{background:`${p.color}22`, border:`1.5px solid ${p.color}`}}>
              {p.avatar}
            </div>
            <div className="flex-1">
              <p className="text-white font-bold text-sm">
                {p.name} {p.isMe && <span className="text-[#39d353] text-xs">(You)</span>}
              </p>
              <p className="text-gray-500 text-xs">{getValue(p)}</p>
            </div>
            <div className="text-right">
              <p className="font-black text-lg"
                style={{color: p.color, fontFamily:"'Barlow Condensed', sans-serif"}}>
                {tab === 'zones' ? p.zones : tab === 'distance' ? p.distance.toFixed(0) : p.streak}
              </p>
              <p className="text-gray-600 text-xs">
                {tab === 'zones' ? 'zones' : tab === 'distance' ? 'km' : 'days'}
              </p>
            </div>
          </div>
        ))}
      </div>

      <BottomNavigation />
    </div>
  );
}