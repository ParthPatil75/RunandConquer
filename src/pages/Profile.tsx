import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser, setCurrentUser } from '../utils/storage';
import { User } from '../types';
import BottomNavigation from '../components/BottomNavigation';

const ACHIEVEMENTS = [
  { id: 'first-run', icon: '👟', title: 'First Steps', desc: 'Complete your first run', req: (u: User) => (u.totalDistance || 0) > 0 },
  { id: 'first-capture', icon: '🏴', title: 'Territory Claimed', desc: 'Capture your first zone', req: (u: User) => (u.capturedZones?.length || 0) >= 1 },
  { id: 'streak-3', icon: '🔥', title: 'On Fire', desc: '3 day running streak', req: (u: User) => (u.streak || 0) >= 3 },
  { id: 'streak-7', icon: '⚡', title: 'Week Warrior', desc: '7 day running streak', req: (u: User) => (u.streak || 0) >= 7 },
  { id: 'distance-5', icon: '📏', title: '5K Club', desc: 'Run 5km total', req: (u: User) => (u.totalDistance || 0) >= 5 },
  { id: 'distance-10', icon: '🏅', title: '10K Legend', desc: 'Run 10km total', req: (u: User) => (u.totalDistance || 0) >= 10 },
  { id: 'zones-3', icon: '🗺️', title: 'Area Controller', desc: 'Own 3 territories', req: (u: User) => (u.capturedZones?.length || 0) >= 3 },
  { id: 'zones-5', icon: '👑', title: 'Campus King', desc: 'Own 5 territories', req: (u: User) => (u.capturedZones?.length || 0) >= 5 },
];

export default function Profile() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<'stats' | 'achievements'>('stats');

  useEffect(() => {
    const u = getCurrentUser();
    if (!u) { navigate('/'); return; }
    setUser(u);
  }, [navigate]);

  const handleLogout = () => {
    setCurrentUser(null);
    navigate('/');
  };

  if (!user) return null;

  const unlockedCount = ACHIEVEMENTS.filter(a => a.req(user)).length;

  return (
    <div className="min-h-screen bg-[#080808] text-white pb-24" style={{fontFamily:"'Barlow', sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@700;800;900&display=swap" rel="stylesheet"/>

      {/* Header */}
      <div className="px-5 pt-14 pb-6 flex justify-between items-start">
        <div>
          <p className="text-[#39d353] text-xs font-semibold tracking-widest uppercase">Runner Profile</p>
          <h1 className="text-4xl font-black tracking-tight mt-1" style={{fontFamily:"'Barlow Condensed', sans-serif"}}>
            {user.name.toUpperCase()}
          </h1>
        </div>
        <button onClick={handleLogout}
          className="text-gray-500 text-xs font-semibold border border-[#2a2a2a] px-3 py-2 rounded-xl mt-2">
          LOG OUT
        </button>
      </div>

      {/* Profile card */}
      <div className="px-5 mb-6">
        <div className="rounded-3xl p-6 relative overflow-hidden"
          style={{background:'linear-gradient(135deg, #111 0%, #1a1a1a 100%)', border:'1px solid #2a2a2a'}}>
          <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-10"
            style={{background:'#39d353', filter:'blur(40px)', transform:'translate(30%, -30%)'}}/>
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-3xl bg-[#39d353]/20 border-2 border-[#39d353] flex items-center justify-center text-4xl">
              🏃
            </div>
            <div>
              <p className="text-white font-bold text-xl">{user.name}</p>
              <p className="text-gray-500 text-sm">MIT ADT Runner</p>
              <div className="flex items-center gap-2 mt-2">
                <span className="bg-[#39d353]/20 text-[#39d353] text-xs font-bold px-3 py-1 rounded-full border border-[#39d353]/30">
                  🔥 {user.streak || 0} Day Streak
                </span>
                <span className="bg-white/5 text-gray-400 text-xs font-bold px-3 py-1 rounded-full border border-white/10">
                  🏆 {unlockedCount}/{ACHIEVEMENTS.length} badges
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-5 mb-5">
        <div className="bg-[#111] rounded-2xl p-1 flex gap-1 border border-[#1e1e1e]">
          {(['stats', 'achievements'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${
                tab === t ? 'bg-[#39d353] text-black' : 'text-gray-500'
              }`}
              style={{fontFamily:"'Barlow Condensed', sans-serif", letterSpacing:'0.05em'}}>
              {t === 'stats' ? '📊 STATS' : '🏅 BADGES'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'stats' && (
        <div className="px-5 space-y-3">
          {/* Big stat */}
          <div className="bg-[#111] border border-[#1e1e1e] rounded-3xl p-6 text-center">
            <p className="text-6xl font-black text-[#39d353]"
              style={{fontFamily:"'Barlow Condensed', sans-serif"}}>
              {(user.totalDistance || 0).toFixed(1)}
            </p>
            <p className="text-gray-400 text-sm font-semibold mt-1">Total Kilometers</p>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon:'🏴', label:'Zones Owned', value: user.capturedZones?.length || 0, unit:'' },
              { icon:'🔥', label:'Day Streak', value: user.streak || 0, unit:'days' },
              { icon:'🗺️', label:'Campus Control', value: `${Math.round(((user.capturedZones?.length||0)/8)*100)}`, unit:'%' },
              { icon:'⭐', label:'Badges Earned', value: unlockedCount, unit:`/${ACHIEVEMENTS.length}` },
            ].map((s, i) => (
              <div key={i} className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-4">
                <p className="text-2xl mb-2">{s.icon}</p>
                <p className="text-2xl font-black text-white"
                  style={{fontFamily:"'Barlow Condensed', sans-serif"}}>
                  {s.value}<span className="text-[#39d353] text-lg">{s.unit}</span>
                </p>
                <p className="text-gray-500 text-xs mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Progress bar */}
          <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-5">
            <div className="flex justify-between items-center mb-3">
              <p className="text-white font-semibold text-sm">Campus Domination</p>
              <p className="text-[#39d353] font-black text-sm"
                style={{fontFamily:"'Barlow Condensed', sans-serif"}}>
                {user.capturedZones?.length || 0}/8
              </p>
            </div>
            <div className="w-full bg-[#1e1e1e] rounded-full h-3">
              <div className="h-3 rounded-full"
                style={{
                  width:`${((user.capturedZones?.length||0)/8)*100}%`,
                  background:'linear-gradient(90deg, #39d353, #1a8f2e)'
                }}/>
            </div>
          </div>
        </div>
      )}

      {tab === 'achievements' && (
        <div className="px-5">
          <p className="text-gray-500 text-xs font-semibold tracking-widest uppercase mb-3">
            {unlockedCount} of {ACHIEVEMENTS.length} unlocked
          </p>
          <div className="space-y-2">
            {ACHIEVEMENTS.map(a => {
              const unlocked = a.req(user);
              return (
                <div key={a.id}
                  className={`rounded-2xl p-4 flex items-center gap-4 border transition-all ${
                    unlocked
                      ? 'bg-[#39d353]/10 border-[#39d353]/30'
                      : 'bg-[#111] border-[#1e1e1e] opacity-50'
                  }`}>
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl ${
                    unlocked ? 'bg-[#39d353]/20' : 'bg-[#1e1e1e]'
                  }`}>
                    {unlocked ? a.icon : '🔒'}
                  </div>
                  <div className="flex-1">
                    <p className={`font-bold text-sm ${unlocked ? 'text-white' : 'text-gray-500'}`}>
                      {a.title}
                    </p>
                    <p className="text-gray-600 text-xs mt-0.5">{a.desc}</p>
                  </div>
                  {unlocked && (
                    <span className="text-[#39d353] text-xs font-bold border border-[#39d353]/30 px-2 py-1 rounded-lg">
                      ✓ DONE
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <BottomNavigation />
    </div>
  );
}