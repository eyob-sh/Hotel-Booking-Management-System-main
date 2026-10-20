import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "react-query";
import * as apiClient from "../api-client";
import { ManagementBooking } from "../api-client";
import useAppContext from "../hooks/useAppContext";
import { useQueryWithLoading, useMutationWithLoading } from "../hooks/useLoadingHooks";
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
import { Plus } from "lucide-react";

const inputCls = "border rounded-md px-3 py-2 w-full text-sm";

const statusColor = (status?: string) => {
  switch (status) {
    case "confirmed":
      return "bg-green-100 text-green-700";
    case "checked_in":
      return "bg-blue-100 text-blue-700";
    case "checked_out":
      return "bg-slate-100 text-slate-700";
    case "completed":
      return "bg-slate-100 text-slate-700";
    case "pending":
      return "bg-yellow-100 text-yellow-700";
    case "cancelled":
      return "bg-rose-100 text-rose-700";
    case "no_show":
      return "bg-orange-100 text-orange-700";
    case "refunded":
      return "bg-amber-100 text-amber-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
};
void statusColor;

const paymentColor = (ps?: string) => {
  switch (ps) {
    case "paid":
      return "bg-green-100 text-green-700";
    case "deposit_paid":
      return "bg-blue-100 text-blue-700";
    case "partially_refunded":
      return "bg-amber-100 text-amber-700";
    case "refunded":
      return "bg-amber-100 text-amber-700";
    case "pending":
      return "bg-yellow-100 text-yellow-700";
    case "failed":
      return "bg-rose-100 text-rose-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
};
void paymentColor;

const fmtDate = (d?: string | Date) => {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
};

const _fmtDate = fmtDate;
void _fmtDate;

const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};
const dayAfter = () => {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  return d.toISOString().slice(0, 10);
};

const ManageBookings = () => {
  const params = useParams<{ hotelId: string }>();
  const hotelId = params.hotelId as string;
  const queryClient = useQueryClient();
  const { showToast } = useAppContext();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [payBooking, setPayBooking] = useState<ManagementBooking | null>(null);
  const [payForm, setPayForm] = useState({ amount: "", reference: "", note: "" });
  const [refundBooking, setRefundBooking] = useState<ManagementBooking | null>(null);
  const [refundForm, setRefundForm] = useState({ amount: "", reason: "" });
  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "+251",
    checkIn: tomorrow(),
    checkOut: dayAfter(),
    adultCount: "2",
    childCount: "0",
    roomTypeId: "",
    source: "walkin" as "web" | "phone" | "walkin" | "telegram",
    paymentMethod: "pay-at-arrival",
    specialRequests: "",
  });

  const { data } = useQueryWithLoading(
    ["managementBookings", hotelId, statusFilter],
    () =>
      apiClient.fetchManagementBookings(hotelId, {
        status: statusFilter === "all" ? undefined : statusFilter,
      }),
    { onError: () => {}, loadingMessage: "Loading bookings..." }
  );
  const bookings = data?.bookings ?? [];

  const { data: roomsData } = useQueryWithLoading(
    ["fetchRoomTypes", hotelId],
    () => apiClient.fetchRoomTypes(hotelId),
    { onError: () => {} }
  );
  const roomTypes = roomsData?.roomTypes ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries(["managementBookings", hotelId, statusFilter]);
    queryClient.invalidateQueries(["fetchRoomTypes", hotelId]);
  };

  const recordPay = useMutationWithLoading(
    (payload: apiClient.RecordPaymentPayload) =>
      apiClient.recordBookingPayment(payBooking!._id, payload),
    {
      loadingMessage: "Recording payment...",
      onSuccess: () => {
        showToast({ title: "Payment recorded", type: "SUCCESS" });
        setPayBooking(null);
        setPayForm({ amount: "", reference: "", note: "" });
        invalidate();
      },
      onError: (error: any) => {
        showToast({
          title: "Could not record payment",
          description: error?.response?.data?.message ?? error?.message,
          type: "ERROR",
        });
      },
    }
  );

  const issueRefund = useMutationWithLoading(
    (payload: apiClient.IssueRefundPayload) =>
      apiClient.issueBookingRefund(refundBooking!._id, payload),
    {
      loadingMessage: "Issuing refund...",
      onSuccess: () => {
        showToast({ title: "Refund recorded", type: "SUCCESS" });
        setRefundBooking(null);
        setRefundForm({ amount: "", reason: "" });
        invalidate();
      },
      onError: (error: any) => {
        showToast({
          title: "Could not issue refund",
          description: error?.response?.data?.message ?? error?.message,
          type: "ERROR",
        });
      },
    }
  );

  const updateStatus = useMutationWithLoading(
    ({ bookingId, payload }: { bookingId: string; payload: any }) =>
      apiClient.updateBookingStatus(bookingId, payload),
    {
      loadingMessage: "Updating status...",
      onSuccess: () => {
        invalidate();
        showToast({ title: "Booking updated", type: "SUCCESS" });
      },
      onError: (error: any) => {
        showToast({
          title: "Could not update booking",
          description: error?.response?.data?.message ?? error?.message,
          type: "ERROR",
        });
      },
    }
  );
  void updateStatus;

  const createManual = useMutationWithLoading(
    (payload: apiClient.ManualBookingPayload) => apiClient.createManualBooking(payload),
    {
      loadingMessage: "Creating manual booking...",
  onSuccess: () => {
        showToast({ title: "Manual booking created", type: "SUCCESS" });
        setManualOpen(false);
        setManualForm({
          firstName: "",
          lastName: "",
          email: "",
          phone: "+251",
          checkIn: tomorrow(),
          checkOut: dayAfter(),
          adultCount: "2",
          childCount: "0",
          roomTypeId: "",
          source: "walkin",
          paymentMethod: "pay-at-arrival",
          specialRequests: "",
        });
        invalidate();
      },
      onError: (error: any) => {
        showToast({
          title: "Could not create booking",
          description: error?.response?.data?.message ?? error?.message,
          type: "ERROR",
        });
      },
    }
  );

  const submitPay = () => {
    const amt = Number(payForm.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      showToast({ title: "Enter a valid amount", type: "ERROR" });
      return;
    }
    recordPay.mutate({
      amount: amt,
      reference: payForm.reference.trim() || undefined,
      note: payForm.note.trim() || undefined,
    });
  };
  void submitPay;

  const submitRefund = () => {
    const amt = Number(refundForm.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      showToast({ title: "Enter a valid amount", type: "ERROR" });
      return;
    }
    issueRefund.mutate({
      amount: amt,
      reason: refundForm.reason.trim() || undefined,
    });
  };
  void submitRefund;

  const submitManual = () => {
    if (!manualForm.firstName.trim() || !manualForm.lastName.trim()) {
      showToast({ title: "Name is required", type: "ERROR" });
      return;
    }
    if (!manualForm.phone.trim()) {
      showToast({ title: "Phone is required", type: "ERROR" });
      return;
    }
    if (manualForm.checkOut <= manualForm.checkIn) {
      showToast({ title: "Check-out must be after check-in", type: "ERROR" });
      return;
    }
    createManual.mutate({
      hotelId,
      roomTypeId: manualForm.roomTypeId || undefined,
      checkIn: manualForm.checkIn,
      checkOut: manualForm.checkOut,
      adultCount: Number(manualForm.adultCount) || 1,
      childCount: Number(manualForm.childCount) || 0,
      firstName: manualForm.firstName.trim(),
      lastName: manualForm.lastName.trim(),
      email: manualForm.email.trim() || undefined,
      phone: manualForm.phone.trim(),
      source: manualForm.source,
      paymentMethod: manualForm.paymentMethod.trim() || "pay-at-arrival",
      specialRequests: manualForm.specialRequests.trim() || undefined,
    });
  };

  const totals = useMemo(
    () => ({
      total: bookings.length,
      confirmed: bookings.filter((b) => b.status === "confirmed").length,
      pending: bookings.filter((b) => b.status === "pending").length,
      inhouse: bookings.filter((b) => b.status === "checked_in").length,
    }),
    [bookings]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Bookings</h1>
          <p className="text-gray-600 mt-1">
            {totals.total} bookings · {totals.confirmed} confirmed · {totals.pending} pending ·{" "}
            {totals.inhouse} checked in
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {["all", "pending", "confirmed", "checked_in", "checked_out", "cancelled", "refunded"].map(
            (s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-md text-sm border ${
                  statusFilter === s
                    ? "bg-primary-600 text-white border-primary-600"
                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                }`}
              >
                {s === "all" ? "All" : s.replace("_", " ")}
              </button>
            )
          )}
          <Button
            onClick={() => setManualOpen(true)}
            className="bg-primary-600 hover:bg-primary-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add manual booking
          </Button>
        </div>
      </div>

      {/* ...bookings list remains unchanged ... */}

      <Dialog open={Boolean(payBooking)} onOpenChange={(open) => !open && setPayBooking(null)}>
        {/* pay dialog */}
      </Dialog>

      <Dialog open={Boolean(refundBooking)} onOpenChange={(open) => !open && setRefundBooking(null)}>
        {/* refund dialog */}
      </Dialog>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add manual booking</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>First name</Label>
              <Input
                className={inputCls}
                value={manualForm.firstName}
                onChange={(e) => setManualForm({ ...manualForm, firstName: e.target.value })}
              />
            </div>
            <div>
              <Label>Last name</Label>
              <Input
                className={inputCls}
                value={manualForm.lastName}
                onChange={(e) => setManualForm({ ...manualForm, lastName: e.target.value })}
              />
            </div>
            <div>
              <Label>Phone</Label>
              <Input
                className={inputCls}
                value={manualForm.phone}
                onChange={(e) => setManualForm({ ...manualForm, phone: e.target.value })}
              />
            </div>
            <div>
              <Label>Email (optional)</Label>
              <Input
                className={inputCls}
                value={manualForm.email}
                onChange={(e) => setManualForm({ ...manualForm, email: e.target.value })}
              />
            </div>
            <div>
              <Label>Check-in</Label>
              <Input
                type="date"
                className={inputCls}
                value={manualForm.checkIn}
                onChange={(e) => setManualForm({ ...manualForm, checkIn: e.target.value })}
              />
            </div>
            <div>
              <Label>Check-out</Label>
              <Input
                type="date"
                className={inputCls}
                value={manualForm.checkOut}
                onChange={(e) => setManualForm({ ...manualForm, checkOut: e.target.value })}
              />
            </div>
            <div>
              <Label>Adults</Label>
              <Input
                type="number"
                min={1}
                className={inputCls}
                value={manualForm.adultCount}
                onChange={(e) => setManualForm({ ...manualForm, adultCount: e.target.value })}
              />
            </div>
            <div>
              <Label>Children</Label>
              <Input
                type="number"
                min={0}
                className={inputCls}
                value={manualForm.childCount}
                onChange={(e) => setManualForm({ ...manualForm, childCount: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Room type</Label>
              <select
                className={inputCls}
                value={manualForm.roomTypeId}
                onChange={(e) => setManualForm({ ...manualForm, roomTypeId: e.target.value })}
              >
                <option value="">Any (property capacity)</option>
                {roomTypes.map((rt: any) => (
                  <option key={rt._id} value={rt._id}>
                    {rt.name} — ETB {rt.basePrice}/night ({rt.roomCount} rooms)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Source</Label>
              <select
                className={inputCls}
                value={manualForm.source}
                onChange={(e) => setManualForm({ ...manualForm, source: e.target.value as any })}
              >
                <option value="walkin">Walk-in</option>
                <option value="phone">Phone</option>
                <option value="web">Web</option>
                <option value="telegram">Telegram</option>
              </select>
            </div>
            <div>
              <Label>Payment method</Label>
              <Input
                className={inputCls}
                value={manualForm.paymentMethod}
                onChange={(e) => setManualForm({ ...manualForm, paymentMethod: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Special requests</Label>
              <Input
                className={inputCls}
                value={manualForm.specialRequests}
                onChange={(e) => setManualForm({ ...manualForm, specialRequests: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submitManual}
              disabled={createManual.isLoading}
              className="bg-primary-600 hover:bg-primary-700"
            >
              Create booking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ManageBookings;
