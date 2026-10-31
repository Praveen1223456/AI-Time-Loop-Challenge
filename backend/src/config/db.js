import mongoose from 'mongoose';

const READY_STATES = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };

export function sanitizeDbUri(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/mongodb(\+srv)?:\/\/[^@\s]+@/g, 'mongodb$1://<redacted>@');
}

export async function connectDb(uri) {
  mongoose.set('strictQuery', true);

  mongoose.connection.on('error', (err) => {
    const safeMsg = sanitizeDbUri(String(err?.message ?? 'Unknown database error'));
    console.error(`[database] connection error: ${safeMsg}`);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('[database] connection lost; driver attempting to reconnect');
  });

  mongoose.connection.on('reconnected', () => {
    console.log('[database] connection restored');
  });

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
    minPoolSize: 1,
  });
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

/**
 * Reports the real driver state and verifies actual ping responsiveness.
 * Returns 'connected' only when the database is reachable.
 */
export async function getDbStatus() {
  const ready = READY_STATES[mongoose.connection.readyState] ?? 'unknown';
  if (ready !== 'connected') return ready;
  if (!mongoose.connection.db) return 'disconnected';
  try {
    await mongoose.connection.db.admin().ping({ maxTimeMS: 2000 });
    return 'connected';
  } catch {
    return 'disconnected';
  }
}

/** Synchronous check of the driver ready state without network ping. */
export function getDbStatusSync() {
  return READY_STATES[mongoose.connection.readyState] ?? 'unknown';
}
