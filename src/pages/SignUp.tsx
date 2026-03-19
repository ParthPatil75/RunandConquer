import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { addUser, getAllUsers, setCurrentUser } from '../utils/storage';
import { User } from '../types';

export default function SignUp() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!formData.name || !formData.email || !formData.password) {
      setError('All fields are required');
      return;
    }

    const users = getAllUsers();
    if (users.find(u => u.email === formData.email)) {
      setError('Email already exists');
      return;
    }

    const newUser: User = {
      id: `user-${Date.now()}`,
      name: formData.name,
      email: formData.email,
      password: formData.password,
      streak: 0,
      totalDistance: 0,
      capturedZones: [],
      achievements: [],
    };

    addUser(newUser);
    setCurrentUser(newUser);
    navigate('/home');
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
        Create Account
      </h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <input
            type="text"
            placeholder="Full Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full bg-[#1e1e1e] border border-[#2a2a2a] text-white px-4 py-4 rounded-lg outline-none focus:border-[#39d353] transition-colors"
          />
        </div>
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
          CREATE ACCOUNT
        </button>
      </form>

      <p className="text-center text-gray-400 mt-6">
        Already have an account?{' '}
        <button
          onClick={() => navigate('/signin')}
          className="text-[#39d353] font-semibold"
        >
          Sign In
        </button>
      </p>
    </div>
  );
}
