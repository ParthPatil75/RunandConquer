import { db } from '../firebase';
import {
  doc, setDoc, getDoc, collection,
  onSnapshot, getDocs, serverTimestamp
} from 'firebase/firestore';
import { User, Zone } from '../types';

// ─── LOCAL HELPERS ───────────────────────────────────────────
const LOCAL = {
  CURRENT_USER: 'currentUser',
  USERS: 'users',
  ZONES: 'zones',
};

// ─── CURRENT USER (localStorage) ─────────────────────────────
export const getCurrentUser = (): User | null => {
  const j = localStorage.getItem(LOCAL.CURRENT_USER);
  return j ? JSON.parse(j) : null;
};

export const setCurrentUser = (user: User | null) => {
  if (user) localStorage.setItem(LOCAL.CURRENT_USER, JSON.stringify(user));
  else localStorage.removeItem(LOCAL.CURRENT_USER);
};

// ─── USERS ────────────────────────────────────────────────────
export const getAllUsers = (): User[] => {
  const j = localStorage.getItem(LOCAL.USERS);
  return j ? JSON.parse(j) : [];
};

export const addUser = async (user: User) => {
  // Save locally
  const users = getAllUsers();
  users.push(user);
  localStorage.setItem(LOCAL.USERS, JSON.stringify(users));

  // Save to Firebase
  try {
    await setDoc(doc(db, 'users', user.id), {
      id: user.id,
      name: user.name,
      streak: user.streak || 0,
      totalDistance: user.totalDistance || 0,
      capturedZones: user.capturedZones || [],
      lastRunDate: user.lastRunDate || '',
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    console.error('Firebase addUser error:', e);
  }
};

export const updateUser = async (user: User) => {
  // Update locally
  const users = getAllUsers();
  const idx = users.findIndex(u => u.id === user.id);
  if (idx !== -1) users[idx] = user;
  localStorage.setItem(LOCAL.USERS, JSON.stringify(users));
  if (getCurrentUser()?.id === user.id) setCurrentUser(user);

  // Sync to Firebase
  try {
    await setDoc(doc(db, 'users', user.id), {
      id: user.id,
      name: user.name,
      streak: user.streak || 0,
      totalDistance: user.totalDistance || 0,
      capturedZones: user.capturedZones || [],
      lastRunDate: user.lastRunDate || '',
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    console.error('Firebase updateUser error:', e);
  }
};

// ─── ZONES ────────────────────────────────────────────────────
export const getZones = (): Zone[] => {
  const j = localStorage.getItem(LOCAL.ZONES);
  return j ? JSON.parse(j) : [];
};

export const updateZones = async (zones: Zone[]) => {
  localStorage.setItem(LOCAL.ZONES, JSON.stringify(zones));

  // Sync each zone to Firebase
  try {
    for (const zone of zones) {
      await setDoc(doc(db, 'zones', String(zone.id)), {
        ...zone,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
  } catch (e) {
    console.error('Firebase updateZones error:', e);
  }
};

// ─── TERRITORIES (real-time) ──────────────────────────────────
export const saveTerritoryToFirebase = async (territory: {
  id: string; owner: string; ownerName: string;
  polygon: [number,number][]; color: string;
}) => {
  try {
    await setDoc(doc(db, 'territories', territory.id), {
      ...territory,
      capturedAt: serverTimestamp(),
    });
  } catch (e) {
    console.error('Firebase territory save error:', e);
  }
};

export const subscribeToTerritories = (
  callback: (territories: any[]) => void
) => {
  const unsub = onSnapshot(collection(db, 'territories'), (snapshot) => {
    const territories = snapshot.docs.map(d => d.data());
    callback(territories);
  });
  return unsub;
};

// ─── LEADERBOARD (real-time) ──────────────────────────────────
export const subscribeToLeaderboard = (
  callback: (users: User[]) => void
) => {
  const unsub = onSnapshot(collection(db, 'users'), (snapshot) => {
    const users = snapshot.docs.map(d => d.data()) as User[];
    callback(users);
  });
  return unsub;
};

// ─── INITIALIZE ───────────────────────────────────────────────
export const initializeStorage = () => {
  // Bots
  const existing = getAllUsers();
  if (!existing.find(u => u.id === 'bot1')) {
    const bots: User[] = [
      { id:'bot1', name:'Alex Runner', email:'alex@example.com', password:'demo',
        streak:12, totalDistance:45.8, capturedZones:[], achievements:[], lastRunDate:'' },
      { id:'bot2', name:'Sarah Sprint', email:'sarah@example.com', password:'demo',
        streak:8, totalDistance:32.4, capturedZones:[], achievements:[], lastRunDate:'' },
      { id:'bot3', name:'Mike Marathon', email:'mike@example.com', password:'demo',
        streak:5, totalDistance:18.2, capturedZones:[], achievements:[], lastRunDate:'' },
    ];
    localStorage.setItem(LOCAL.USERS, JSON.stringify(bots));
  }
};