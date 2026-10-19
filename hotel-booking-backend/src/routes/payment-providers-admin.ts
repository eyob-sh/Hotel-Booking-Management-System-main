import express, { Request, Response } from "express";
import verifyToken from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
import { db, paymentProviders } from "../db";
import { eq } from "drizzle-orm";
import { getProvider, type ProviderRow } from "../payments/registry";

const router = express.Router();

type ProviderConfig = Record<string, unknown>;

function sanitizeConfig(config: unknown): ProviderConfig {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return {};
  }
  return config as ProviderConfig;
}

router.get(
  "/",
  verifyToken,
  requireRole("admin", "hotel_owner"),
  async (_req: Request, res: Response) => {
    try {
      const rows = await db.select().from(paymentProviders);
      const providers = rows.map((row: ProviderRow) => {
        const provider = getProvider(row.id);
        const config = sanitizeConfig(row.config);
        return {
          id: row.id,
          displayName: row.displayName,
          kind: row.kind,
          enabled: row.enabled,
          sortOrder: row.sortOrder,
          config,
          available: provider ? provider.isConfigured(config) : false,
        };
      });
      res.status(200).json({ providers });
    } catch (error) {
      res.status(500).json({ message: "Unable to load payment providers" });
    }
  }
);

router.put(
  "/:id",
  verifyToken,
  requireRole("admin", "hotel_owner"),
  async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      const provider = getProvider(id);
      if (!provider) {
        return res.status(404).json({ message: "Unknown payment provider" });
      }
      const updates: Partial<Pick<ProviderRow, "displayName" | "enabled" | "sortOrder" | "config">> = {};
      if (typeof req.body.displayName === "string" && req.body.displayName.trim()) {
        updates.displayName = req.body.displayName.trim();
      }
      if (typeof req.body.enabled === "boolean") {
        updates.enabled = req.body.enabled;
      }
      if (typeof req.body.sortOrder === "number" && Number.isFinite(req.body.sortOrder)) {
        updates.sortOrder = Math.max(0, Math.trunc(req.body.sortOrder));
      }
      if (req.body.config !== undefined) {
        if (typeof req.body.config !== "object" || req.body.config === null || Array.isArray(req.body.config)) {
          return res.status(400).json({ message: "config must be an object" });
        }
        updates.config = req.body.config as ProviderConfig;
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }
      const [row] = await db
        .update(paymentProviders)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(paymentProviders.id, id))
        .returning();
      if (!row) {
        return res.status(404).json({ message: "Provider not found" });
      }
      const config = sanitizeConfig(row.config);
      res.status(200).json({
        id: row.id,
        displayName: row.displayName,
        kind: row.kind,
        enabled: row.enabled,
        sortOrder: row.sortOrder,
        config,
        available: provider.isConfigured(config),
      });
    } catch (error) {
      res.status(500).json({ message: "Unable to update payment provider" });
    }
  }
);

export default router;
