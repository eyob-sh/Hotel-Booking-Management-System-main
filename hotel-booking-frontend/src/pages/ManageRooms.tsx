import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "react-query";
import * as apiClient from "../api-client";
import { RoomTypeAdmin, RoomTypePayload } from "../api-client";
import useAppContext from "../hooks/useAppContext";
import { useQueryWithLoading, useMutationWithLoading } from "../hooks/useLoadingHooks";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Separator } from "../components/ui/separator";
import {
  ArrowLeft,
  BedDouble,
  ImageIcon,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";

const inputCls = "border rounded-md px-3 py-2 w-full text-sm";

type FormState = {
  name: string;
  description: string;
  maxAdults: string;
  maxChildren: string;
  basePrice: string;
  roomCount: string;
  sortOrder: string;
  active: boolean;
};

const emptyForm: FormState = {
  name: "",
  description: "",
  maxAdults: "2",
  maxChildren: "0",
  basePrice: "",
  roomCount: "1",
  sortOrder: "0",
  active: true,
};

const toFormState = (room: RoomTypeAdmin): FormState => ({
  name: room.name,
  description: room.description ?? "",
  maxAdults: String(room.maxAdults),
  maxChildren: String(room.maxChildren),
  basePrice: String(room.basePrice),
  roomCount: String(room.roomCount),
  sortOrder: String(room.sortOrder ?? 0),
  active: room.active,
});

const parsePhotos = (value: string): string[] =>
  value
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const ManageRooms = () => {
  const params = useParams<{ hotelId: string }>();
  const hotelId = params.hotelId as string;
  const queryClient = useQueryClient();
  const { showToast } = useAppContext();

  const [editing, setEditing] = useState<RoomTypeAdmin | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoUrlInput, setPhotoUrlInput] = useState("");
  const [uploadFiles, setUploadFiles] = useState<FileList | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RoomTypeAdmin | null>(null);

  const { data, isLoading } = useQueryWithLoading(
    ["fetchRoomTypes", hotelId],
    () => apiClient.fetchRoomTypes(hotelId),
    { onError: () => {}, loadingMessage: "Loading rooms..." }
  );
  const rooms = data?.roomTypes ?? [];

  const invalidate = () =>
    queryClient.invalidateQueries(["fetchRoomTypes", hotelId]);

  const saveMutation = useMutationWithLoading<
    RoomTypeAdmin,
    Error,
    { roomTypeId?: string; payload: RoomTypePayload | FormData }
  >(
    ({ roomTypeId, payload }) =>
      roomTypeId
        ? apiClient.updateRoomType(hotelId, roomTypeId, payload)
        : apiClient.createRoomType(hotelId, payload),
    {
      loadingMessage: "Saving room...",
      onSuccess: (saved) => {
        setIsFormOpen(false);
        setEditing(null);
        invalidate();
        showToast({
          title: editing ? "Room updated" : "Room added",
          description: saved.name,
          type: "SUCCESS",
        });
      },
      onError: (error: any) => {
        showToast({
          title: "Could not save room",
          description: error?.response?.data?.message ?? error?.message,
          type: "ERROR",
        });
      },
    }
  );

  const deleteMutation = useMutationWithLoading<
    { message: string },
    Error,
    string
  >((roomTypeId) => apiClient.deleteRoomType(hotelId, roomTypeId), {
    loadingMessage: "Deleting room...",
    onSuccess: () => {
      setPendingDelete(null);
      invalidate();
      showToast({ title: "Room deleted", type: "SUCCESS" });
    },
    onError: (error: any) => {
      showToast({
        title: "Could not delete room",
        description: error?.response?.data?.message ?? error?.message,
        type: "ERROR",
      });
      setPendingDelete(null);
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setPhotos([]);
    setPhotoUrlInput("");
    setUploadFiles(null);
    setIsFormOpen(true);
  };

  const openEdit = (room: RoomTypeAdmin) => {
    setEditing(room);
    setForm(toFormState(room));
    setPhotos(room.photos ?? []);
    setPhotoUrlInput("");
    setUploadFiles(null);
    setIsFormOpen(true);
  };

  const addPhotoUrl = () => {
    const next = parsePhotos(photoUrlInput);
    if (next.length === 0) return;
    setPhotos((prev) => Array.from(new Set([...prev, ...next])));
    setPhotoUrlInput("");
  };

  const submit = () => {
    if (!form.name.trim()) {
      showToast({ title: "Room name is required", type: "ERROR" });
      return;
    }
    const basePrice = Number(form.basePrice);
    if (!Number.isFinite(basePrice) || basePrice < 0) {
      showToast({ title: "Base price must be a non-negative number", type: "ERROR" });
      return;
    }

    const fields: RoomTypePayload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      maxAdults: Math.max(1, Number(form.maxAdults) || 1),
      maxChildren: Math.max(0, Number(form.maxChildren) || 0),
      basePrice,
      roomCount: Math.max(0, Number(form.roomCount) || 0),
      sortOrder: Number(form.sortOrder) || 0,
      active: form.active,
      photos,
    };

    // New uploads go up as multipart; everything else as JSON.
    if (uploadFiles && uploadFiles.length > 0) {
      const fd = new FormData();
      Object.entries(fields).forEach(([key, value]) => {
        if (value === undefined) return;
        fd.append(key, Array.isArray(value) ? JSON.stringify(value) : String(value));
      });
      Array.from(uploadFiles).forEach((file) => fd.append("photoFiles", file));
      saveMutation.mutate({ roomTypeId: editing?._id, payload: fd });
      return;
    }

    saveMutation.mutate({ roomTypeId: editing?._id, payload: fields });
  };

  const totals = useMemo(
    () => ({
      rooms: rooms.reduce((sum, r) => sum + (r.roomCount || 0), 0),
      active: rooms.filter((r) => r.active).length,
    }),
    [rooms]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Link
            to="/my-hotels"
            className="inline-flex items-center text-sm text-gray-500 hover:text-primary-600 mb-2"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            My Hotels
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">Rooms</h1>
          <p className="text-gray-600 mt-1">
            {rooms.length} room type{rooms.length === 1 ? "" : "s"} ·{" "}
            {totals.rooms} physical room{totals.rooms === 1 ? "" : "s"} ·{" "}
            {totals.active} accepting bookings
          </p>
        </div>
        <Button onClick={openCreate} className="bg-primary-600 hover:bg-primary-700">
          <Plus className="w-4 h-4 mr-2" />
          Add Room
        </Button>
      </div>

      {isLoading ? null : rooms.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center border border-gray-100 shadow-soft">
          <BedDouble className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-gray-700 mb-1">No rooms yet</h3>
          <p className="text-gray-500 mb-5">
            Add your first room type so guests can book it.
          </p>
          <Button onClick={openCreate} className="bg-primary-600 hover:bg-primary-700">
            <Plus className="w-4 h-4 mr-2" />
            Add Room
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {rooms.map((room) => (
            <div
              key={room._id}
              className="bg-white rounded-2xl border border-gray-100 shadow-soft overflow-hidden flex"
            >
              <div className="w-40 h-40 flex-shrink-0 bg-gray-100">
                {room.photos?.[0] ? (
                  <img
                    src={room.photos[0]}
                    alt={room.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400">
                    <ImageIcon className="w-8 h-8" />
                  </div>
                )}
              </div>
              <div className="p-4 flex-1 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-lg font-bold text-gray-900">{room.name}</h2>
                  <Badge
                    className={
                      room.active
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-600"
                    }
                  >
                    {room.active ? "Active" : "Inactive"}
                  </Badge>
                </div>
                {room.description && (
                  <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                    {room.description}
                  </p>
                )}
                <div className="flex flex-wrap gap-3 mt-3 text-sm text-gray-600">
                  <span className="inline-flex items-center">
                    <Users className="w-4 h-4 mr-1 text-primary-600" />
                    {room.maxAdults} adults
                    {room.maxChildren > 0 ? ` · ${room.maxChildren} children` : ""}
                  </span>
                  <span>· {room.roomCount} rooms</span>
                </div>
                <div className="mt-auto pt-3 flex items-center justify-between">
                  <span className="text-xl font-bold text-primary-600">
                    ETB {room.basePrice.toLocaleString()}
                    <span className="text-sm font-normal text-gray-500">/night</span>
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEdit(room)}
                      className="border-gray-200"
                    >
                      <Pencil className="w-4 h-4 mr-1" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPendingDelete(room)}
                      className="border-red-200 text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / edit dialog */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit room" : "Add room"}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Label htmlFor="room-name">Name</Label>
              <Input
                id="room-name"
                className={inputCls}
                value={form.name}
                placeholder="Deluxe King"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div className="sm:col-span-2">
              <Label htmlFor="room-description">Description</Label>
              <Textarea
                id="room-description"
                className={inputCls}
                rows={2}
                value={form.description}
                placeholder="What makes this room special?"
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor="room-price">Base price per night (ETB)</Label>
              <Input
                id="room-price"
                type="number"
                min={0}
                className={inputCls}
                value={form.basePrice}
                onChange={(e) => setForm({ ...form, basePrice: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor="room-count">Number of rooms</Label>
              <Input
                id="room-count"
                type="number"
                min={0}
                className={inputCls}
                value={form.roomCount}
                onChange={(e) => setForm({ ...form, roomCount: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor="room-adults">Max adults</Label>
              <Input
                id="room-adults"
                type="number"
                min={1}
                className={inputCls}
                value={form.maxAdults}
                onChange={(e) => setForm({ ...form, maxAdults: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor="room-children">Max children</Label>
              <Input
                id="room-children"
                type="number"
                min={0}
                className={inputCls}
                value={form.maxChildren}
                onChange={(e) => setForm({ ...form, maxChildren: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor="room-sort">Sort order</Label>
              <Input
                id="room-sort"
                type="number"
                className={inputCls}
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
              />
            </div>

            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  className="rounded border-gray-300"
                />
                Accepting bookings
              </label>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>Photos</Label>
            {photos.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {photos.map((url) => (
                  <div key={url} className="relative w-20 h-20 rounded-md overflow-hidden border">
                    <img src={url} alt="room" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setPhotos(photos.filter((p) => p !== url))}
                      className="absolute top-0 right-0 bg-red-600 text-white rounded-bl-md px-1 text-xs"
                      aria-label="Remove photo"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                className={inputCls}
                value={photoUrlInput}
                placeholder="Paste image URL, then Add"
                onChange={(e) => setPhotoUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addPhotoUrl();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addPhotoUrl}>
                Add
              </Button>
            </div>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setUploadFiles(e.target.files)}
              className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-primary-700 hover:file:bg-primary-100"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFormOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={saveMutation.isLoading}
              className="bg-primary-600 hover:bg-primary-700"
            >
              {editing ? "Save changes" : "Add room"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{pendingDelete?.name}”?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            This removes the room type and any empty inventory rows. Rooms with
            reservations cannot be deleted — deactivate them instead.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isLoading}
              onClick={() =>
                pendingDelete && deleteMutation.mutate(pendingDelete._id)
              }
            >
              Delete room
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ManageRooms;
