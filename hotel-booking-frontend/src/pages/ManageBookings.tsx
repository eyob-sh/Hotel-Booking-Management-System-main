import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "react-query";
import * as apiClient from "../api-client";
import { ManagementBooking, ManagementPayment } from "../api-client";
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
import { Separator } from "../components/ui/separator";
import { Calendar, CreditCard, DollarSign, User2 } from "lucide-react";

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

const fmtDate = (d?: string | Date) => {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
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

  const { data, isLoading } = useQueryWithLoading(
    ["managementBookings", hotelId, statusFilter],
    () =>
      apiClient.fetchManagementBookings(hotelId, {
        status: statusFilter === "all" ? undefined : statusFilter,
      }),
    { onError: () => {}, loadingMessage: "Loading bookings..." }
  );
  const bookings = data?.bookings ?? [];

  const invalidate = () =>
    queryClient.invalidateQueries(["managementBookings", hotelId, statusFilter]);

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

  const remaining = (b: ManagementBooking) => {
    const total = b.totalCost || 0;
    const net = b.netPaid ?? 0;
    return Math.max(0, total - net);
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
        <div className="flex gap-2 flex-wrap">
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
        </div>
      </div>

      {isLoading ? null : bookings.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center border border-gray-100 shadow-soft">
          <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-gray-700 mb-1">No bookings</h3>
          <p className="text-gray-500">Bookings for this hotel will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => (
            <div
              key={b._id}
              className="bg-white rounded-xl border border-gray-100 shadow-soft p-4"
            >
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-bold text-gray-900">
                      {b.firstName} {b.lastName}
                    </h2>
                    <Badge className={statusColor(b.status)}>{b.status}</Badge>
                    <Badge className={paymentColor(b.paymentStatus)}>{b.paymentStatus}</Badge>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">
                    {b.roomTypeName ?? "Room"} · {b.adultCount} adults
                    {b.childCount ? ` · ${b.childCount} children` : ""}
                  </p>
                  <div className="flex items-center gap-4 mt-2 text-sm text-gray-600 flex-wrap">
                    <span className="inline-flex items-center">
                      <Calendar className="w-4 h-4 mr-1 text-primary-600" />
                      {fmtDate(b.checkIn)} → {fmtDate(b.checkOut)}
                    </span>
                    <span className="inline-flex items-center">
                      <User2 className="w-4 h-4 mr-1 text-primary-600" />
                      {b.email || b.phone || "—"}
                    </span>
                    <span className="inline-flex items-center">
                      <DollarSign className="w-4 h-4 mr-1 text-primary-600" />
                      ETB {(b.totalCost || 0).toLocaleString()}
                    </span>
                    <span>Ref: {b.reference || "—"}</span>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {b.status === "pending" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        updateStatus.mutate({
                          bookingId: b._id,
                          payload: { status: "confirmed" },
                        })
                      }
                    >
                      Confirm
                    </Button>
                  )}
                  {b.status !== "cancelled" && b.status !== "no_show" && b.status !== "completed" && b.status !== "refunded" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        updateStatus.mutate({
                          bookingId: b._id,
                          payload: { status: "cancelled", cancellationReason: "Cancelled by manager" },
                        })
                      }
                    >
                      Cancel
                    </Button>
                  )}
                  {b.status === "confirmed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        updateStatus.mutate({
                          bookingId: b._id,
                          payload: { status: "checked_in" },
                        })
                      }
                    >
                      Check-in
                    </Button>
                  )}
                  {b.status === "checked_in" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        updateStatus.mutate({
                          bookingId: b._id,
                          payload: { status: "checked_out" },
                        })
                      }
                    >
                      Check-out
                    </Button>
                  )}
                  {b.status === "checked_out" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        updateStatus.mutate({
                          bookingId: b._id,
                          payload: { status: "completed" },
                        })
                      }
                    >
                      Complete
                    </Button>
                  )}
                  {b.status !== "cancelled" && b.status !== "refunded" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                      onClick={() => setPayBooking(b)}
                    >
                      <CreditCard className="w-4 h-4 mr-1" />
                      Record payment
                    </Button>
                  )}
                  {(b.paidAmount ?? 0) > 0.01 && b.status !== "refunded" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                      onClick={() => {
                        setRefundBooking(b);
                        setRefundForm({
                          amount: String(Math.max(0, (b.netPaid ?? 0) - (b.refundedAmount ?? 0)) || (b.totalCost || 0)),
                          reason: "",
                        });
                      }}
                    >
                      Issue refund
                    </Button>
                  )}
                </div>
              </div>

              <Separator className="my-3" />
              <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                <span>Collected: <span className="font-semibold">ETB {(b.paidAmount ?? 0).toFixed(2)}</span></span>
                <span>Refunded: <span className="font-semibold">ETB {(b.refundedAmount ?? 0).toFixed(2)}</span></span>
                <span>Remaining: <span className="font-semibold">ETB {remaining(b).toFixed(2)}</span></span>
                <span>Net: <span className="font-semibold">ETB {(b.netPaid ?? 0).toFixed(2)}</span></span>
              </div>
              {b.payments && b.payments.length > 0 && (
                <div className="mt-2 text-xs text-gray-500">
                  {b.payments
                    .slice(0, 3)
                    .map((p: ManagementPayment) => `${p.type} ETB ${p.amount.toFixed(2)} (${p.status})`)
                    .join(" · ")}
                  {b.payments.length > 3 && ` · +${b.payments.length - 3} more`}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={Boolean(payBooking)} onOpenChange={(open) => !open && setPayBooking(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="pay-amount">Amount (ETB)</Label>
              <Input
                id="pay-amount"
                className={inputCls}
                type="number"
                step="0.01"
                min="0.01"
                value={payForm.amount}
                placeholder={`Max ${payBooking ? remaining(payBooking).toFixed(2) : ""}`}
                onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="pay-ref">Reference (optional)</Label>
              <Input
                id="pay-ref"
                className={inputCls}
                value={payForm.reference}
                placeholder="Receipt/tracking #"
                onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="pay-note">Note (optional)</Label>
              <Input
                id="pay-note"
                className={inputCls}
                value={payForm.note}
                placeholder="Cash/card etc"
                onChange={(e) => setPayForm({ ...payForm, note: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayBooking(null)}>
              Cancel
            </Button>
            <Button
              onClick={submitPay}
              disabled={recordPay.isLoading}
              className="bg-primary-600 hover:bg-primary-700"
            >
              Record payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(refundBooking)} onOpenChange={(open) => !open && setRefundBooking(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Issue refund</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="refund-amount">Amount (ETB)</Label>
              <Input
                id="refund-amount"
                className={inputCls}
                type="number"
                step="0.01"
                min="0.01"
                value={refundForm.amount}
                placeholder={
                  refundBooking
                    ? `Available ${(refundBooking.netPaid ?? 0) - (refundBooking.refundedAmount ?? 0)}`
                    : ""
                }
                onChange={(e) => setRefundForm({ ...refundForm, amount: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="refund-reason">Reason (optional)</Label>
              <Input
                id="refund-reason"
                className={inputCls}
                value={refundForm.reason}
                placeholder="Reason"
                onChange={(e) => setRefundForm({ ...refundForm, reason: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundBooking(null)}>
              Cancel
            </Button>
            <Button
              onClick={submitRefund}
              disabled={issueRefund.isLoading}
              variant="destructive"
            >
              Issue refund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ManageBookings;
