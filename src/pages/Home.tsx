import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser, getZones, getAllUsers } from '../utils/storage';
import { User } from '../types';
import BottomNavigation from '../components/BottomNavigation';

export default function Home() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [timeOfDay, setTimeOfDay] = useState('');
  const [rankPosition, setRankPosition] = useState(1);

  useEffect(() => {
    const u = getCurrentUser();
    if (!u) { navigate('/'); return; }
    setUser(u);
    const hour = new Date().getHours();
    if (hour < 12) setTimeOfDay('Morning');
    else if (hour < 17) setTimeOfDay('Afternoon');
    else setTimeOfDay('Evening');
    const allUsers = getAllUsers();
    const sorted = [...allUsers].sort((a, b) =>
      (b.capturedZones?.length || 0) - (a.capturedZones?.length || 0)
    );
    const pos = sorted.findIndex(u2 => u2.id === u.id) + 1;
    setRankPosition(pos || 1);
  }, [navigate]);

  if (!user) return null;

  const stats = [
    { label: 'Total Distance', value: `${(user.totalDistance || 0).toFixed(1)}`, unit: 'km' },
    { label: 'Day Streak', value: `${user.streak || 0}`, unit: 'days' },
    { label: 'Zones Owned', value: `${user.capturedZones?.length || 0}`, unit: 'areas' },
    { label: 'Global Rank', value: `#${rankPosition}`, unit: '' },
  ];

  return (
    <div className="min-h-screen bg-[#080808] text-white pb-24" style={{fontFamily:"'Barlow', sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@700;800;900&display=swap" rel="stylesheet" />

      {/* Header */}
      <div className="px-5 pt-14 pb-6">
        <p className="text-[#39d353] text-sm font-semibold tracking-widest uppercase">Dominate Today.</p>
        <h1 className="text-4xl font-black tracking-tight mt-1" style={{fontFamily:"'Barlow Condensed', sans-serif"}}>
          {user.name.toUpperCase()}
        </h1>
      </div>

      {/* Big Run Button */}
      <div className="px-5 mb-6">
        <button
          onClick={() => navigate('/map')}
          className="w-full relative overflow-hidden rounded-3xl py-8 flex flex-col items-center justify-center gap-2"
          style={{background:'linear-gradient(135deg, #39d353 0%, #1a8f2e 100%)'}}>
          <div className="absolute inset-0 opacity-10"
            style={{backgroundImage:'repeating-linear-gradient(45deg, #fff 0, #fff 1px, transparent 0, transparent 50%)', backgroundSize:'12px 12px'}} />
          <svg width="48" height="48" viewBox="0 0 24 24" fill="white">
            <path d="M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z"/>
          </svg>
          <span className="text-2xl font-black text-white tracking-wide" style={{fontFamily:"'Barlow Condensed', sans-serif"}}>
            START RUNNING
          </span>
          <span className="text-white/70 text-sm">Capture territory on campus</span>
        </button>
      </div>

      {/* Stats Grid */}
      <div className="px-5 mb-6">
        <p className="text-gray-500 text-xs font-semibold tracking-widest uppercase mb-3">Your Stats</p>
        <div className="grid grid-cols-2 gap-3">
          {stats.map((s, i) => (
            <div key={i} className="bg-[#111111] rounded-2xl p-4 border border-[#1e1e1e]">
              <p className="text-3xl font-black text-white" style={{fontFamily:"'Barlow Condensed', sans-serif"}}>
                {s.value} <span className="text-lg text-[#39d353]">{s.unit}</span>
              </p>
              <p className="text-gray-500 text-xs mt-1 font-medium">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Streak Card */}
      <div className="px-5 mb-6">
        <div className="bg-[#111111] rounded-2xl p-5 border border-[#1e1e1e] flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl"
            style={{background:'linear-gradient(135deg, #ff6b35, #f7c59f)'}}>
            🔥
          </div>
          <div className="flex-1">
            <p className="text-white font-bold text-lg">{user.streak || 0} Day Streak!</p>
            <p className="text-gray-500 text-sm">
              {(user.streak || 0) === 0
                ? 'Run today to start your streak'
                : "Don't break the chain — run today!"}
            </p>
          </div>
          <div className="text-[#39d353] font-black text-2xl" style={{fontFamily:"'Barlow Condensed', sans-serif"}}>
            {(user.streak || 0) >= 7 ? '🏆' : `${7 - (user.streak || 0)}d`}
          </div>
        </div>
      </div>

      {/* Weekly Activity */}
      <div className="px-5 mb-6">
        <p className="text-gray-500 text-xs font-semibold tracking-widest uppercase mb-3">This Week</p>
        <div className="bg-[#111111] rounded-2xl p-5 border border-[#1e1e1e]">
          <div className="flex justify-between items-end gap-1 h-16 mb-3">
            {['M','T','W','T','F','S','S'].map((day, i) => {
              const active = i < (new Date().getDay() || 7);
              const height = active ? Math.floor(Math.random() * 60 + 30) : 15;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full rounded-sm transition-all"
                    style={{
                      height: `${height}%`,
                      background: active ? 'linear-gradient(180deg, #39d353, #1a8f2e)' : '#1e1e1e'
                    }} />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between">
            {['M','T','W','T','F','S','S'].map((day, i) => (
              <div key={i} className="flex-1 text-center text-gray-600 text-xs font-medium">{day}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Territory control */}
      <div className="px-5 mb-6">
        <p className="text-gray-500 text-xs font-semibold tracking-widest uppercase mb-3">Territory Control</p>
        <div className="bg-[#111111] rounded-2xl p-5 border border-[#1e1e1e]">
          <div className="flex justify-between items-center mb-3">
            <span className="text-white font-semibold">Campus Domination</span>
            <span className="text-[#39d353] font-black">{user.capturedZones?.length || 0}/8</span>
          </div>
          <div className="w-full bg-[#1e1e1e] rounded-full h-3">
            <div className="h-3 rounded-full transition-all"
              style={{
                width: `${((user.capturedZones?.length || 0) / 8) * 100}%`,
                background:'linear-gradient(90deg, #39d353, #1a8f2e)'
              }} />
          </div>
          <div className="flex justify-between mt-2">
            <span className="text-gray-600 text-xs">Keep running to conquer more</span>
            <span className="text-gray-500 text-xs">{Math.round(((user.capturedZones?.length || 0) / 8) * 100)}%</span>
          </div>
        </div>
      </div>

      <BottomNavigation />
    </div>
  );
}