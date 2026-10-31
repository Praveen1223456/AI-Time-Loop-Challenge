import mongoose from 'mongoose';

const READY_STATES = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };

export async function connectDb(uri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

/** Reports the real driver state; never assumes a connection. */
export function getDbStatus() {
  return READY_STATES[mongoose.connection.readyState] ?? 'unknown';
}
