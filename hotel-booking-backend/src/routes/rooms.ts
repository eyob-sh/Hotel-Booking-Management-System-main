import express, { Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { body, validationResult } from "express-validator";
import { and, eq, gte } from "drizzle-orm";
import { db, hotels, roomTypes, roomInventory } from "../db";
import verifyToken from "../middleware/auth";
import { calendarDateOf, getSettings, propertyTimeZone } from "../services/settings";

// ---------------------------------------------------------------------------
// Room types CRUD (Phase 3) � the owner/admin tunes the property's sellable
// rooms: name, capacity, nightly price, physical room count and photos.
//
// Mounted at /api/my-hotels, so the full paths are /api/my-hotels/:hotelId/rooms.
// RBAC: the owner of that hotel, or an admin.
//
// Room-count edits are reconciled against `room_inventory` for upcoming dates:
//   * a date whose totalRooms matched the old count is bumped to the new count,
//   * a date never "manually" adjusted (totalRooms != old count) is left alone,
//   * a date is never pushed below what is already reserved (that would break
//     the reserved <= totalRooms invariant and oversell existing bookings).
// ---------------------------------------------------------------------------

const router = express.Router();

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "hotels");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

async function saveImages(files: Express.Multer.File[], baseUrl: string): Promise<string[]> {
  if (!files || files.length === 0) return [];
  return Promise.all(
    files.map(async (file) => {
      const ext = path.extname(file.originalname) || ".bin";
      const filename = `${uuidv4()}${ext}`;
      await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), new Uint8Array(file.buffer));
      return `${baseUrl}/uploads/hotels/${encodeURIComponent(filename)}`;
    })
  );
}

type Access =
  | { ok: true; hotel: typeof hotels.$inferSelect }
  | { ok: false; status: number; message: string };

/** Owner of the hotel (or an admin) � the only callers allowed here. */
async function resolveHotelAccess(req: Request, hotelId: string): Promise<Access> {
  if (!/^[0-9a-fA-F-]{36}$/.test(hotelId)) {
    return { ok: false, status: 400, message: "Invalid hotel id" };
  }
  const [hotel] = await db
    .select()
    .from(hotels)
    .where(eq(hotels._id, hotelId))
    .limit(1);
  if (!hotel) return { ok: false, status: 404, message: "Hotel not found" };
  if (req.userRole === "admin") return { ok: true, hotel };
  if (hotel.userId !== req.userId) {
    return { ok: false, status: 403, message: "Access denied" };
  }
  return { ok: true, hotel };
}

/** Clamp `totalRooms` to `reserved` on any date that would be oversold. */
async function reconcileInventory(opts: {
  roomTypeId: string;
  oldCount: number;
  newCount: number;
}): Promise<void> {
  const { roomTypeId, oldCount, newCount } = opts;
  if (oldCount === newCount) return;

  const today = calendarDateOf(new Date(), propertyTimeZone(await getSettings()));

  const rows = await db
    .select({ date: roomInventory.date, totalRooms: roomInventory.totalRooms, reserved: roomInventory.reserved })
    .from(roomInventory)
    .where(
      and(
        eq(roomInventory.roomTypeId, roomTypeId),
        gte(roomInventory.date, today)
      )
    );

  for (const row of rows) {
    // Only touch dates that were still tracking the old default count � a
    // date whose totalRooms differs was adjusted by hand and must be kept.
    if (row.totalRooms !== oldCount) continue;
    if (newCount < row.reserved) continue; // would oversell
    await db
      .update(roomInventory)
      .set({ totalRooms: newCount, updatedAt: new Date() })
      .where(
        and(
          eq(roomInventory.roomTypeId, roomTypeId),
          eq(roomInventory.date, row.date)
        )
      );
  }
}

const parsePhotos = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
      } catch {
        return [];
      }
    }
    return trimmed ? [trimmed] : [];
  }
  return [];
};

const toRoomTypeResponse = (row: any) => ({
  _id: row._id,
  hotelId: row.hotelId,
  name: row.name,
  description: row.description,
  maxAdults: row.maxAdults,
  maxChildren: row.maxChildren,
  basePrice: row.basePrice,
  roomCount: row.roomCount,
  photos: row.photos ?? [],
  sortOrder: row.sortOrder,
  active: row.active,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const listRoomTypes = async (hotelId: string) => {
  const rows = await db
    .select()
    .from(roomTypes)
    .where(eq(roomTypes.hotelId, hotelId));
  return rows.sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)
  );
};

// ---------------------------------------------------------------------------
// GET /api/my-hotels/:hotelId/rooms
// ---------------------------------------------------------------------------
router.get(
  "/:hotelId/rooms",
  verifyToken,
  async (req: Request, res: Response) => {
    const access = await resolveHotelAccess(req, String(req.params.hotelId));
    if (!access.ok) return res.status(access.status).json({ message: access.message });
    try {
      const rows = await listRoomTypes(access.hotel._id);
      res.status(200).json({ roomTypes: rows.map(toRoomTypeResponse) });
    } catch (error) {
      res.status(500).json({ message: "Unable to load room types" });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/my-hotels/:hotelId/rooms
// ---------------------------------------------------------------------------
router.post(
  "/:hotelId/rooms",
  verifyToken,
  upload.array("photoFiles", 6),
  [
    body("name").trim().notEmpty().withMessage("name is required"),
    body("basePrice").isFloat({ min: 0 }).withMessage("basePrice must be a non-negative number"),
    body("roomCount").optional().isInt({ min: 0 }).withMessage("roomCount must be a non-negative integer"),
    body("maxAdults").optional().isInt({ min: 1 }).withMessage("maxAdults must be at least 1"),
    body("maxChildren").optional().isInt({ min: 0 }).withMessage("maxChildren must be non-negative"),
    body("sortOrder").optional().isInt().withMessage("sortOrder must be an integer"),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const access = await resolveHotelAccess(req, String(req.params.hotelId));
    if (!access.ok) return res.status(access.status).json({ message: access.message });

    try {
      const files = (req as any).files as Express.Multer.File[] | undefined;
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const uploaded = await saveImages(files ?? [], baseUrl);
      const photos = [...parsePhotos(req.body.photos), ...uploaded];

      const [created] = await db
        .insert(roomTypes)
        .values({
          hotelId: access.hotel._id,
          name: String(req.body.name).trim(),
          description: req.body.description ? String(req.body.description) : null,
          maxAdults: Math.max(1, Number(req.body.maxAdults) || 2),
          maxChildren: Math.max(0, Number(req.body.maxChildren) || 0),
          basePrice: Number(req.body.basePrice),
          roomCount: Math.max(0, Number(req.body.roomCount) || 0),
          photos,
          sortOrder: Number.isFinite(Number(req.body.sortOrder)) ? Number(req.body.sortOrder) : 0,
          active: req.body.active === undefined ? true : req.body.active !== false,
        })
        .returning();

      res.status(201).json(toRoomTypeResponse(created));
    } catch (error) {
      res.status(500).json({ message: "Unable to create room type" });
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /api/my-hotels/:hotelId/rooms/:roomTypeId
// ---------------------------------------------------------------------------
router.put(
  "/:hotelId/rooms/:roomTypeId",
  verifyToken,
  upload.array("photoFiles", 6),
  async (req: Request, res: Response) => {
    const access = await resolveHotelAccess(req, String(req.params.hotelId));
    if (!access.ok) return res.status(access.status).json({ message: access.message });

    try {
      const [existing] = await db
        .select()
        .from(roomTypes)
        .where(
          and(
            eq(roomTypes._id, String(req.params.roomTypeId)),
            eq(roomTypes.hotelId, access.hotel._id)
          )
        )
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Room type not found" });

      const files = (req as any).files as Express.Multer.File[] | undefined;
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const uploaded = await saveImages(files ?? [], baseUrl);

      // Photos only change when the client sends them (or new files arrive).
      // A partial update like { roomCount: 5 } must NOT wipe existing photos.
      const photosProvided = req.body.photos !== undefined;
      const photos = photosProvided
        ? [...parsePhotos(req.body.photos), ...uploaded]
        : [...(existing.photos ?? []), ...uploaded];

      // Drop local files for photos that were removed.
      const removed = (existing.photos ?? []).filter((url) => !photos.includes(url));
      for (const url of removed) {
        const marker = "/uploads/hotels/";
        const idx = url.indexOf(marker);
        if (idx === -1) continue;
        const filename = decodeURIComponent(url.substring(idx + marker.length).split("?")[0]);
        if (!filename) continue;
        try {
          await fs.promises.unlink(path.join(UPLOAD_DIR, filename));
        } catch {
          /* best effort */
        }
      }

      const nextCount = Math.max(
        0,
        Number.isFinite(Number(req.body.roomCount)) ? Number(req.body.roomCount) : existing.roomCount
      );

      const [updated] = await db
        .update(roomTypes)
        .set({
          ...(req.body.name !== undefined ? { name: String(req.body.name).trim() } : {}),
          ...(req.body.description !== undefined
            ? { description: req.body.description ? String(req.body.description) : null }
            : {}),
          ...(req.body.maxAdults !== undefined ? { maxAdults: Math.max(1, Number(req.body.maxAdults) || 1) } : {}),
          ...(req.body.maxChildren !== undefined ? { maxChildren: Math.max(0, Number(req.body.maxChildren) || 0) } : {}),
          ...(req.body.basePrice !== undefined ? { basePrice: Number(req.body.basePrice) } : {}),
          ...(req.body.roomCount !== undefined ? { roomCount: nextCount } : {}),
          ...(req.body.sortOrder !== undefined ? { sortOrder: Number(req.body.sortOrder) || 0 } : {}),
          ...(req.body.active !== undefined ? { active: req.body.active !== false } : {}),
          photos,
          updatedAt: new Date(),
        })
        .where(eq(roomTypes._id, existing._id))
        .returning();

      if (req.body.roomCount !== undefined) {
        await reconcileInventory({
          roomTypeId: existing._id,
          oldCount: existing.roomCount,
          newCount: nextCount,
        });
      }

      res.status(200).json(toRoomTypeResponse(updated));
    } catch (error) {
      res.status(500).json({ message: "Unable to update room type" });
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/my-hotels/:hotelId/rooms/:roomTypeId
// ---------------------------------------------------------------------------
router.delete(
  "/:hotelId/rooms/:roomTypeId",
  verifyToken,
  async (req: Request, res: Response) => {
    const access = await resolveHotelAccess(req, String(req.params.hotelId));
    if (!access.ok) return res.status(access.status).json({ message: access.message });

    try {
      const roomTypeId = String(req.params.roomTypeId);
      const [existing] = await db
        .select()
        .from(roomTypes)
        .where(and(eq(roomTypes._id, roomTypeId), eq(roomTypes.hotelId, access.hotel._id)))
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Room type not found" });

      // Deleting a type that holds live inventory would orphan reservations.
      const [activeRow] = await db
        .select({ n: roomInventory.roomTypeId })
        .from(roomInventory)
        .where(
          and(
            eq(roomInventory.roomTypeId, roomTypeId),
            gte(roomInventory.reserved, 1)
          )
        )
        .limit(1);
      if (activeRow) {
        return res.status(409).json({
          message:
            "This room type still has rooms reserved. Deactivate it instead (active: false).",
        });
      }

      await db.transaction(async (tx) => {
        await tx
          .delete(roomInventory)
          .where(eq(roomInventory.roomTypeId, roomTypeId));
        await tx.delete(roomTypes).where(eq(roomTypes._id, roomTypeId));
      });

      res.status(200).json({ message: "Room type deleted" });
    } catch (error) {
      res.status(500).json({ message: "Unable to delete room type" });
    }
  }
);

export default router;
