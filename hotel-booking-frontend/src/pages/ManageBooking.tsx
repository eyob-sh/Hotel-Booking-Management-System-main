import { useState } from "react";
import * as apiClient from "../api-client";
import useAppContext from "../hooks/useAppContext";
import type { BookingLookupResponse } from "../../../shared/types";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import {
  Search,
  Calendar,
  Users,
  CreditCard,
  Loader2,
  AlertCircle,
  CheckCircle,
  XCircle,
  MapPin,
  Receipt,
} from "lucide-react";

const statusColor = (status?: string) => {
  switch (status) {
    case "confirmed":
      return "bg-green-100 text-green-800 border-green-200";
    case "pending":
      return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "cancelled":
      return "bg-red-100 text-red-800 border-red-200";
    case "completed":
      return "bg-blue-100 text-blue-800 border-blue-200";
    default:
      return "bg-gray-100 text-gray-800 border-gray-200";
  }
};

const ManageBooking = () => {
  const { showToast } = useAppContext();

  const [reference, setReference] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BookingLookupResponse | null>(null);

  const contact = { phone: phone || undefined, email: email || undefined };
  const canSubmit = reference.trim().length > 0 && (!!phone || !!email);

  const onLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await apiClient.lookupBooking({
        reference: reference.trim(),
        ...contact,
      });
      setResult(data);
    } catch (err: any) {
      setError(
        err?.response?.data?.message ||
          "We couldn't find a booking with those details."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const onCancel = async () => {
    if (!result) return;
    setIsCancelling(true);
    try {
      const data = await apiClient.cancelBookingByReference({
        reference: reference.trim(),
        ...contact,
      });
      setResult({ ...result, booking: data.booking });
      showToast({
        title: "Booking cancelled",
        description: "Your reservation has been cancelled.",
        type: "SUCCESS",
      });
    } catch (err: any) {
      showToast({
        title: "Cancellation failed",
        description:
          err?.response?.data?.message || "Please try again or contact us.",
        type: "ERROR",
      });
    } finally {
      setIsCancelling(false);
    }
  };

  const booking = result?.booking;
  const cancellable =
    booking?.status === "pending" || booking?.status === "confirmed";

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 py-10">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="text-center">
          <div className="flex items-center justify-center gap-3 mb-2">
            <Receipt className="h-7 w-7 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">
              Manage My Booking
            </h1>
          </div>
          <p className="text-gray-600">
            Enter your booking reference and the phone or email you booked with.
          </p>
        </div>

        <Card className="shadow-lg border-0 bg-white">
          <CardHeader>
            <CardTitle className="text-lg">Find your reservation</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onLookup} className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium text-gray-700">
                  Booking reference
                </Label>
                <Input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="HB-XXXXXXXXXX"
                  className="font-mono tracking-wide uppercase"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-gray-700">
                    Phone
                  </Label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+251 9XX XXX XXX"
                    type="tel"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-gray-700">
                    or Email
                  </Label>
                  <Input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    type="email"
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={!canSubmit || isLoading}
                className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold py-3"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Search className="h-4 w-4" />
                    Find booking
                  </span>
                )}
              </Button>
            </form>

            {error && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="h-5 w-5 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {result && booking && (
          <Card className="shadow-lg border-0 bg-white">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-lg">
                  {result.hotel?.name || "Your reservation"}
                </CardTitle>
                <div className="flex gap-2">
                  <Badge className={`${statusColor(booking.status)} border`}>
                    {booking.status}
                  </Badge>
                  {booking.paymentStatus && (
                    <Badge variant="outline">{booking.paymentStatus}</Badge>
                  )}
                </div>
              </div>
              {result.hotel && (
                <div className="flex items-center gap-1 text-sm text-gray-500">
                  <MapPin className="h-4 w-4" />
                  {result.hotel.city}, {result.hotel.country}
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-5">
              {booking.reference && (
                <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
                  <p className="text-xs text-gray-600">Booking reference</p>
                  <p className="text-xl font-mono font-bold tracking-wider text-blue-700">
                    {booking.reference}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div className="rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center gap-2 text-gray-500 mb-1">
                    <Calendar className="h-4 w-4" /> Stay
                  </div>
                  <div className="text-gray-800">
                    {new Date(booking.checkIn).toDateString()}
                    <br />
                    {new Date(booking.checkOut).toDateString()}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center gap-2 text-gray-500 mb-1">
                    <Users className="h-4 w-4" /> Guests
                  </div>
                  <div className="text-gray-800">
                    {booking.adultCount} adult
                    {booking.adultCount > 1 ? "s" : ""}
                    {booking.childCount > 0
                      ? `, ${booking.childCount} child`
                      : ""}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center gap-2 text-gray-500 mb-1">
                    <CreditCard className="h-4 w-4" /> Total
                  </div>
                  <div className="text-gray-800 font-semibold">
                    {booking.currency || "ETB"}{" "}
                    {Number(booking.totalCost).toLocaleString()}
                  </div>
                </div>
              </div>

              {booking.status !== "cancelled" && (
                <div
                  className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                    result.freeCancellation
                      ? "border-green-200 bg-green-50 text-green-800"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  {result.freeCancellation ? (
                    <CheckCircle className="h-5 w-5 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-5 w-5 mt-0.5" />
                  )}
                  <span>
                    {result.freeCancellation
                      ? `Free cancellation until ${new Date(
                          result.freeCancellationUntil
                        ).toLocaleString()}.`
                      : `Free cancellation window has passed (${result.freeCancellationHours}h before check-in). Cancellation fees may apply.`}
                  </span>
                </div>
              )}

              {cancellable ? (
                <Button
                  type="button"
                  onClick={onCancel}
                  disabled={isCancelling}
                  variant="destructive"
                  className="w-full"
                >
                  {isCancelling ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Cancelling...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <XCircle className="h-4 w-4" />
                      Cancel this booking
                    </span>
                  )}
                </Button>
              ) : (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-center text-sm text-gray-600">
                  This booking is <strong>{booking.status}</strong> and can no
                  longer be cancelled online.
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default ManageBooking;
