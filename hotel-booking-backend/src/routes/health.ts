import express, { Request, Response } from "express";
import { db, checkDatabaseConnection } from "../db";
import { sql } from "drizzle-orm";

const router = express.Router();

const rowsOf = async (query: any): Promise<any[]> => {
  const result: any = await db.execute(query);
  return result.rows ?? result;
};

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Get API health status
 *     description: Returns the current health status of the API including database connection, memory usage, and uptime
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: API is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "healthy"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: number
 *                   description: Server uptime in seconds
 *                 database:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       example: "connected"
 *                     collections:
 *                       type: number
 *                       description: Number of collections in database
 *                 memory:
 *                   type: object
 *                   properties:
 *                     used:
 *                       type: number
 *                       description: Memory usage in MB
 *                     total:
 *                       type: number
 *                       description: Total memory in MB
 *                     percentage:
 *                       type: number
 *                       description: Memory usage percentage
 *       503:
 *         description: API is unhealthy
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    // Check database connection
    const connected = await checkDatabaseConnection();
    const dbStatus = connected ? "connected" : "disconnected";

    let tableCount = 0;
    let dbName = "hotel-booking";
    if (connected) {
      try {
        const countRows = await rowsOf(sql`
          SELECT count(*) AS count
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        `);
        tableCount = Number(countRows[0]?.count ?? 0);

        const nameRows = await rowsOf(sql`SELECT current_database() AS name`);
        dbName = nameRows[0]?.name || dbName;
      } catch {
        // ignore secondary query failures
      }
    }

    // Get memory usage
    const memUsage = process.memoryUsage();
    const usedMemoryMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const totalMemoryMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const memoryPercentage = Math.round((usedMemoryMB / totalMemoryMB) * 100);

    // Get uptime
    const uptime = process.uptime();

    const healthData = {
      status: dbStatus === "connected" ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
      uptime: Math.round(uptime),
      database: {
        status: dbStatus,
        collections: tableCount,
        name: dbName,
      },
      memory: {
        used: usedMemoryMB,
        total: totalMemoryMB,
        percentage: memoryPercentage,
      },
      environment: process.env.NODE_ENV || "development",
      version: "1.0.0",
    };

    const statusCode = dbStatus === "connected" ? 200 : 503;
    res.status(statusCode).json(healthData);
  } catch (error) {
    res.status(503).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: "Health check failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * @swagger
 * /api/health/detailed:
 *   get:
 *     summary: Get detailed API health status
 *     description: Returns detailed health information including system metrics and performance data
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Detailed health information
 */
router.get("/detailed", async (req: Request, res: Response) => {
  try {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    const connected = await checkDatabaseConnection();

    const database: any = {
      status: connected ? "connected" : "disconnected",
      readyState: connected ? 1 : 0,
      host: null,
      port: null,
      name: null,
    };

    if (connected) {
      try {
        const nameRows = await rowsOf(sql`SELECT current_database() AS name`);
        database.name = nameRows[0]?.name ?? null;
      } catch {
        // ignore
      }
    }

    try {
      const parsed = new URL(process.env.DATABASE_URL || "");
      database.host = parsed.hostname || null;
      database.port = parsed.port ? Number(parsed.port) : 5432;
    } catch {
      // ignore malformed DATABASE_URL
    }

    const detailedHealth = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      system: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        pid: process.pid,
      },
      performance: {
        memory: {
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
          external: memUsage.external,
          rss: memUsage.rss,
        },
        cpu: {
          user: cpuUsage.user,
          system: cpuUsage.system,
        },
        uptime: Math.round(process.uptime()),
      },
      database,
    };

    res.status(200).json(detailedHealth);
  } catch (error) {
    res.status(503).json({
      status: "unhealthy",
      error: "Detailed health check failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
