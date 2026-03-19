export interface User {
  id: string;
  name: string;
  email: string;
  password: string;
  streak: number;
  totalDistance: number;
  capturedZones: string[];
  achievements: string[];
  lastRunDate?: string;
}

export interface Zone {
  id: number;
  name: string;
  lat: number;
  lng: number;
  owner: string | null;
  strength: number;
}

export interface RunData {
  isRunning: boolean;
  startTime: number | null;
  distance: number;
  capturedDuringRun: string[];
}
