import { useForm } from "react-hook-form";
import {
  HotelDetailType,
  PaymentProviderInfo,
  QuoteBreakdown,
  UserType,
} from "../../../../shared/types";
import { useNavigate } from "react-router-dom";
import { useMutation } from "react-query";
import * as apiClient from "../../api-client";
import useAppContext from "../../hooks/useAppContext";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import {
  User,
  Phone,
  MessageSquare,
  CreditCard,
  Shield,
  CheckCircle,
  Building2,
  Smartphone,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Props = {
  /** Undefined for guest checkout (no account). */
  currentUser?: UserType;
  hotel: HotelDetailType;
  hotelId: string;
  roomTypeId?: string;
  roomTypeName?: string;
  checkIn: Date;
  checkOut: Date;
  adultCount: number;
  childCount: number;
  quote: QuoteBreakdown;
  providers: PaymentProviderInfo[];
};

type BookingFormData = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  specialRequests?: string;
};

const money = (amount: number, currency: string) =>
  `${currency} ${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const providerIcon = (kind: PaymentProviderInfo["kind"], id: string) => {
  if (kind === "onsite" && id === "bank-transfer")
    return <Building2 className="h-5 w-5 text-blue-600" />;
  if (kind === "onsite") return <CheckCircle className="h-5 w-5 text-green-600" />;
  return <Smartphone className="h-5 w-5 text-blue-600" />;
};

const BookingForm = ({
  currentUser,
  hotelId,
  roomTypeId,
  roomTypeName,
  checkIn,
  checkOut,
  adultCount,
  childCount,
  quote,
  providers,
}: Props) => {
  const navigate = useNavigate();
  const { showToast } = useAppContext();

  const [providerId, setProviderId] = useState<string>(
    () => providers.find((p) => p.id === "pay-at-arrival")?.id || providers[0]?.id || ""
  );

  const [confirmation, setConfirmation] = useState<{
    reference: string;
    status: string;
    paymentStatus?: string;
    message?: string;
  } | null>(null);

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === providerId),
    [providers, providerId]
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BookingFormData>({
    defaultValues: {
      firstName: currentUser?.firstName || "",
      lastName: currentUser?.lastName || "",
      email: currentUser?.email || "",
      phone: currentUser?.phone || "",
      specialRequests: "",
    },
    mode: "onChange",
  });

  useEffect(() => {
    if (!providerId && providers.length > 0) {
      setProviderId(providers[0].id);
    }
  }, [providers, providerId]);

  const { mutate: book, isLoading } = useMutation(
    (data: BookingFormData) =>
      apiClient.createProviderBooking({
        hotelId,
        roomTypeId,
        checkIn: checkIn.toISOString(),
        checkOut: checkOut.toISOString(),
        adultCount,
        childCount,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email || undefined,
        phone: data.phone,
        specialRequests: data.specialRequests,
        providerId,
        source: "web",
        totalCost: quote.totalStored,
      }),
    {
      onSuccess: (res) => {
        const pending = res.payment?.status === "pending";
        showToast({
          title: pending ? "Booking reserved" : "Booking Confirmed",
          description:
            res.payment?.message ||
            (pending
              ? "Your booking is held and will be confirmed once payment is received."
              : "Your stay has been booked successfully!"),
          type: "SUCCESS",
        });
        // Guests have no account, so show an inline confirmation with the
        // booking reference instead of redirecting to /my-bookings.
        if (currentUser) {
          setTimeout(() => navigate("/my-bookings"), 1500);
        } else {
          setConfirmation({
            reference: res.booking?.reference || "",
            status: res.booking?.status || "",
            paymentStatus: res.booking?.paymentStatus,
            message: res.payment?.message,
          });
        }
      },
      onError: (err: any) => {
        showToast({
          title: "Booking Failed",
          description:
            err?.response?.data?.message ||
            "There was an error processing your booking. Please try again.",
          type: "ERROR",
        });
      },
    }
  );

  const onSubmit = (data: BookingFormData) => {
    book(data);
  };

  const dueNow = selectedProvider?.id === "pay-at-arrival" ? 0 : quote.deposit;
  const payLater = Math.round((quote.totalStored - dueNow) * 100) / 100;

  if (confirmation) {
    return (
      <div className="p-8 text-center space-y-4">
        <div className="flex justify-center">
          <CheckCircle className="h-14 w-14 text-green-500" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900">
          Booking Confirmed
        </h2>
        <p className="text-gray-600">
          {confirmation.message ||
            "Thank you! Your stay has been reserved."}
        </p>
        {confirmation.reference && (
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
            <p className="text-sm text-gray-600 mb-1">Your booking reference</p>
            <p className="text-2xl font-mono font-bold tracking-wider text-blue-700">
              {confirmation.reference}
            </p>
            <p className="text-xs text-gray-500 mt-2">
              Save this reference — you'll need it to manage your booking.
            </p>
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            type="button"
            onClick={() => navigate(`/detail/${hotelId}`)}
            className="bg-gradient-to-r from-blue-600 to-blue-700 text-white"
          >
            Back to property
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate("/manage-booking")}
          >
            Manage my booking
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <CardHeader className="pb-6">
        <CardTitle className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <User className="h-6 w-6 text-blue-600" />
          Confirm Your Details
        </CardTitle>
        <p className="text-gray-600 mt-2">
          Please review and complete your booking information
        </p>
      </CardHeader>

      <CardContent className="space-y-6">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Personal Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <User className="h-5 w-5 text-blue-600" />
              Guest Information
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium text-gray-700">
                  First Name
                </Label>
                <Input
                  type="text"
                  placeholder="First name"
                  {...register("firstName", {
                    required: "First name is required",
                  })}
                />
                {errors.firstName && (
                  <span className="text-red-500 text-xs">
                    {errors.firstName.message}
                  </span>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium text-gray-700">
                  Last Name
                </Label>
                <Input
                  type="text"
                  placeholder="Last name"
                  {...register("lastName", {
                    required: "Last name is required",
                  })}
                />
                {errors.lastName && (
                  <span className="text-red-500 text-xs">
                    {errors.lastName.message}
                  </span>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium text-gray-700">
                  Email (optional)
                </Label>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  {...register("email", {
                    pattern: {
                      value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                      message: "Enter a valid email address",
                    },
                  })}
                />
                {errors.email && (
                  <span className="text-red-500 text-xs">
                    {errors.email.message}
                  </span>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  Phone
                </Label>
                <Input
                  type="tel"
                  placeholder="+251 9XX XXX XXX"
                  {...register("phone", {
                    required: "Phone number is required",
                    pattern: {
                      value: /^\+?[0-9][0-9\s\-()]{5,19}$/,
                      message: "Enter a valid phone number",
                    },
                  })}
                />
                {errors.phone && (
                  <span className="text-red-500 text-xs">
                    {errors.phone.message}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Special Requests */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-blue-600" />
              Special Requests (Optional)
            </h3>
            <textarea
              rows={3}
              placeholder="Any special requests, preferences, or additional information..."
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              {...register("specialRequests")}
            />
          </div>

          {/* Payment Method */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-blue-600" />
              Payment Method
            </h3>

            <div className="space-y-2">
              {providers.map((p) => {
                const active = p.id === providerId;
                return (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => setProviderId(p.id)}
                    className={`w-full text-left p-4 rounded-lg border-2 transition-all flex items-start gap-3 ${
                      active
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-blue-300"
                    }`}
                  >
                    <div className="mt-0.5">
                      {providerIcon(p.kind, p.id)}
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-gray-900">
                        {p.displayName}
                      </div>
                      <div className="text-xs text-gray-500">
                        {p.id === "pay-at-arrival"
                          ? "Pay the full amount when you arrive."
                          : p.kind === "onsite"
                          ? "Transfer the prepayment to the property's bank account."
                          : "Pay securely online now."}
                      </div>
                      {p.details?.publicNote ? (
                        <div className="text-xs text-amber-600 mt-1">
                          {String(p.details.publicNote)}
                        </div>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Bank transfer instructions */}
            {selectedProvider?.kind === "onsite" &&
              selectedProvider.id === "bank-transfer" &&
              selectedProvider.details && (
                <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-gray-700 space-y-1">
                  <div className="font-semibold text-blue-800">
                    Bank transfer details
                  </div>
                  {selectedProvider.details.bankName ? (
                    <div>
                      <span className="text-gray-500">Bank: </span>
                      {String(selectedProvider.details.bankName)}
                    </div>
                  ) : null}
                  {selectedProvider.details.accountName ? (
                    <div>
                      <span className="text-gray-500">Account name: </span>
                      {String(selectedProvider.details.accountName)}
                    </div>
                  ) : null}
                  {selectedProvider.details.accountNumber ? (
                    <div>
                      <span className="text-gray-500">Account number: </span>
                      {String(selectedProvider.details.accountNumber)}
                    </div>
                  ) : null}
                  <p className="text-xs text-gray-500 pt-1">
                    {selectedProvider.details.instructions
                      ? String(selectedProvider.details.instructions)
                      : "Use your booking reference as the payment reference."}
                  </p>
                </div>
              )}
          </div>

          {/* Price Summary */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-blue-600" />
              Price Summary
            </h3>

            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-100 space-y-2">
              <div className="flex justify-between text-sm text-gray-700">
                <span>
                  {roomTypeName ? `${roomTypeName} · ` : ""}
                  {quote.nights} night{quote.nights > 1 ? "s" : ""}
                </span>
                <span>{money(quote.totalStored, quote.currency)}</span>
              </div>

              {quote.fees.map((fee, i) => (
                <div
                  key={`${fee.name}-${i}`}
                  className="flex justify-between text-sm text-gray-600"
                >
                  <span>{fee.name}</span>
                  <span>{money(fee.amount, quote.currency)}</span>
                </div>
              ))}

              <div className="border-t border-blue-100 pt-2 flex justify-between items-center">
                <span className="text-gray-700 font-medium">Total</span>
                <span className="text-2xl font-bold text-blue-600">
                  {money(quote.totalStored, quote.currency)}
                </span>
              </div>

              {quote.display && (
                <div className="text-xs text-gray-500 text-right">
                  ≈ {money(quote.display.total, quote.display.currency)}
                </div>
              )}

              <div className="border-t border-blue-100 pt-2 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-700">
                    {selectedProvider?.id === "pay-at-arrival"
                      ? "Due at arrival"
                      : "Due now"}
                  </span>
                  <span className="font-semibold text-gray-900">
                    {money(dueNow, quote.currency)}
                  </span>
                </div>
                {payLater > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-700">Balance at arrival</span>
                    <span className="font-semibold text-gray-900">
                      {money(payLater, quote.currency)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Submit */}
          <div className="pt-4">
            <Button
              disabled={isLoading || !providerId}
              type="submit"
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold py-3 px-6 rounded-lg shadow-lg transform transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Processing...
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  Confirm Booking
                </div>
              )}
            </Button>
          </div>
        </form>

        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center justify-center gap-6 text-xs text-gray-500">
            <div className="flex items-center gap-1">
              <Shield className="h-3 w-3 text-green-500" />
              Secure
            </div>
            <div className="flex items-center gap-1">
              <CheckCircle className="h-3 w-3 text-green-500" />
              Instant Confirmation
            </div>
            <div className="flex items-center gap-1">
              <MessageSquare className="h-3 w-3 text-green-500" />
              24/7 Support
            </div>
          </div>
        </div>
      </CardContent>
    </div>
  );
};

export default BookingForm;
