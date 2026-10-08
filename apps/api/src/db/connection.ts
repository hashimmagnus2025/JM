import mongoose from 'mongoose';

/**
 * Transactions need a replica set (a single-node replica set is enough for the single-VPS deployment).
 * `retryWrites`/`w: majority` are the safe defaults for financial data.
 */
export async function connectMongo(uri: string): Promise<typeof mongoose> {
  mongoose.set('sanitizeFilter', true); // refuse `$`-operators smuggled into query values
  mongoose.set('strictQuery', true);
  return mongoose.connect(uri, {
    retryWrites: true,
    w: 'majority',
    serverSelectionTimeoutMS: 10_000,
    autoIndex: false,
  });
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}
