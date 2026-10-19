import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

// Lazy singleton so importing this module never opens a connection by itself.
let _pool: Pool | undefined;
let _db: ReturnType<typeof drizzle> | undefined;

const createPool = () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "Missing required environment variable: DATABASE_URL (PostgreSQL connection string)"
    );
  }
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
};

const getPool = () => {
  if (!_pool) _pool = createPool();
  return _pool;
};

export const getDb = () => {
  if (!_db) _db = drizzle(getPool(), { schema });
  return _db;
};

// Eager `db` export for convenient imports (still lazy under the hood).
export const db = getDb();

export { schema };

// Named table re-exports for convenient route imports.
export {
  users,
  hotels,
  bookings,
  reviews,
  favorites,
  analytics,
  settings,
  roomTypes,
  roomInventory,
  paymentProviders,
  payments,
} from "./schema";

// Simple health probe used by the /api/health route.
export const checkDatabaseConnection = async (): Promise<boolean> => {
  try {
    await getPool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
};

// Graceful shutdown helper (replaces mongoose.connection.close()).
export const closeDatabaseConnection = async (): Promise<void> => {
  if (_pool) {
    await _pool.end();
    _pool = undefined;
    _db = undefined;
  }
};
