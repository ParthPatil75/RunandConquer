import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { getCurrentUser } from '../utils/storage';

export default function Splash() {
  const navigate = useNavigate();

  useEffect(() => {
    const user = getCurrentUser();
    if (user) {
      navigate('/home');
    }
  }, [navigate]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center px-6">
      <div className="text-center mb-16">
        <h1 className="text-[72px] leading-none mb-4" style={{ fontFamily: 'Bebas Neue', color: '#39d353' }}>
          RUN & CONQUER
        </h1>
        <p className="text-white text-sm tracking-[4px]">
          DOMINATE MIT ADT CAMPUS
        </p>
      </div>

      <div className="w-full max-w-md space-y-4">
        <button
          onClick={() => navigate('/signup')}
          className="w-full bg-[#39d353] text-black font-bold py-4 rounded-xl text-lg transition-transform active:scale-95"
        >
          CREATE ACCOUNT
        </button>
        <button
          onClick={() => navigate('/signin')}
          className="w-full bg-transparent text-white font-bold py-4 rounded-xl text-lg border-2 border-white transition-transform active:scale-95"
        >
          SIGN IN
        </button>
      </div>

      <p className="text-gray-400 text-sm mt-16">
        Track. Capture. Conquer.
      </p>
    </div>
  );
}
