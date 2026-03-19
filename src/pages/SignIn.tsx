import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { getAllUsers, setCurrentUser } from '../utils/storage';

export default function SignIn() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const users = getAllUsers();
    const user = users.find(
      u => u.email === formData.email && u.password === formData.password
    );

    if (user) {
      setCurrentUser(user);
      navigate('/home');
    } else {
      setError('Invalid email or password');
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] px-6 py-8">
      <button
        onClick={() => navigate('/')}
        className="mb-8 text-white"
      >
        <ArrowLeft size={24} />
      </button>

      <h1 className="text-[40px] text-white mb-8" style={{ fontFamily: 'Bebas Neue' }}>
        Sign In
      </h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <input
            type="email"
            placeholder="Email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="w-full bg-[#1e1e1e] border border-[#2a2a2a] text-white px-4 py-4 rounded-lg outline-none focus:border-[#39d353] transition-colors"
          />
        </div>
        <div>
          <input
            type="password"
            placeholder="Password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            className="w-full bg-[#1e1e1e] border border-[#2a2a2a] text-white px-4 py-4 rounded-lg outline-none focus:border-[#39d353] transition-colors"
          />
        </div>

        {error && (
          <p className="text-red-500 text-sm">{error}</p>
        )}

        <button
          type="submit"
          className="w-full bg-[#39d353] text-black font-bold py-4 rounded-xl text-lg mt-8 transition-transform active:scale-95"
        >
          SIGN IN
        </button>
      </form>

      <div className="mt-6 space-y-2 text-center">
        <button className="text-gray-400 text-sm hover:text-white">
          Forgot password?
        </button>
        <p className="text-gray-400">
          Don't have an account?{' '}
          <button
            onClick={() => navigate('/signup')}
            className="text-[#39d353] font-semibold"
          >
            Sign Up
          </button>
        </p>
      </div>
    </div>
  );
}
