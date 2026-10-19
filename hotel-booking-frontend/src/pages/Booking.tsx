import { useQuery } from "react-query";
import * as apiClient from "../api-client";
import BookingForm from "../forms/BookingForm/BookingForm";
import useSearchContext from "../hooks/useSearchContext";
import { useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import BookingDetailsSummary from "../components/BookingDetailsSummary";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Loader2, CreditCard, Calendar, Users, AlertCircle } from "lucide-react";
import { HotelDetailType } from "../../../shared/types";

const toISODate = (date: Date) => date.toISOString();

const Booking = () => {
  const search = useSearchContext();
  const { hotelId } = useParams();
  const navigate = useNavigate();

  const [numberOfNights, setNumberOfNights] = useState<number>(0);
  const [validationError, setValidationError] = useState<string | null>(null);

  const checkIn = search.checkIn;
  const checkOut = search.checkOut;

  useEffect(() => {
    if (checkIn && checkOut) {
      const nights = Math.abs(checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24);
      setNumberOfNights(Math.ceil(nights));
    }
  }, [checkIn, checkOut]);

  const validDates = Boolean(checkIn && checkOut && checkOut.getTime() > checkIn.getTime());

  // Server-authoritative quote (availability + price + deposit/balance).
  const {
    data: quoteData,
    isLoading: isLoadingQuote,
    error: quoteError,
  } = useQuery(
    [
      "quote",
      hotelId,
      search.roomTypeId,
      checkIn?.toISOString(),
      checkOut?.toISOString(),
      search.adultCount,
      search.childCount,
    ],
    () =>
      apiClient.createQuote({
        hotelId: hotelId as string,
        roomTypeId: search.roomTypeId || undefined,
        checkIn: toISODate(checkIn),
        checkOut: toISODate(checkOut),
        adultCount: search.adultCount,
        childCount: search.childCount,
      }),
    {
      enabled: !!hotelId && validDates,
      retry: false,
    }
  );

  const { data: providersData, isLoading: isLoadingProviders } = useQuery(
    "paymentProviders",
    apiClient.fetchPaymentProviders
  );

  const { data: hotel, isLoading: isLoadingHotel } = useQuery(
    "fetchHotelById",
    () => apiClient.fetchHotelById(hotelId as string),
    { enabled: !!hotelId }
  );

  const { data: currentUser, isLoading: isLoadingUser } = useQuery(
    "fetchCurrentUser",
    apiClient.fetchCurrentUser
  );

  useEffect(() => {
    if (!validDates) {
      setValidationError(
        "Your booking dates are missing or invalid. Please pick your dates again."
      );
    }
  }, [validDates]);

  if (isLoadingHotel || isLoadingUser) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <span className="text-lg font-medium text-gray-700">
            Loading booking details...
          </span>
        </div>
      </div>
    );
  }

  if (!hotel) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-gray-800 mb-2">
            Property Not Found
          </h2>
          <p className="text-gray-600">
            The property you're looking for doesn't exist.
          </p>
        </div>
      </div>
    );
  }

  const enabledProviders = (providersData?.providers || []).filter(
    (p) => p.enabled && p.available
  );

  const roomType = (hotel as HotelDetailType).roomTypes?.find(
    (rt) => rt._id === search.roomTypeId
  );

  const quote = quoteData?.quote;
  const unavailable = quoteData && quoteData.available === false;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <CreditCard className="h-6 w-6 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">
              Complete Your Booking
            </h1>
          </div>
          <p className="text-gray-600">
            Review your stay, choose how you'd like to pay, and confirm.
          </p>
        </div>

        {(validationError || unavailable) && (
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
            <div>
              <p className="font-medium text-amber-800">
                {validationError || "Not available for these dates"}
              </p>
              {unavailable && quoteData?.message && (
                <p className="text-sm text-amber-700 mt-1">{quoteData.message}</p>
              )}
              <button
                className="mt-2 text-sm font-medium text-blue-700 hover:underline"
                onClick={() => navigate(`/detail/${hotelId}`)}
              >
                Change dates
              </button>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-[1fr_2fr] gap-8">
          {/* Booking Summary */}
          <div className="space-y-6">
            <Card className="shadow-lg border-0 bg-white">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                  <Calendar className="h-5 w-5 text-blue-600" />
                  Booking Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <BookingDetailsSummary
                  checkIn={checkIn}
                  checkOut={checkOut}
                  adultCount={search.adultCount}
                  childCount={search.childCount}
                  numberOfNights={numberOfNights}
                  hotel={hotel}
                />
              </CardContent>
            </Card>

            <Card className="shadow-lg border-0 bg-white">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                  <Users className="h-5 w-5 text-blue-600" />
                  Property Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="font-semibold text-gray-900 mb-2">
                    {hotel.name}
                  </h3>
                  <p className="text-gray-600 text-sm mb-3">
                    {hotel.city}, {hotel.country}
                  </p>
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <Badge variant="outline" className="text-xs">
                      {hotel.starRating} Stars
                    </Badge>
                    {roomType && (
                      <Badge
                        variant="outline"
                        className="text-xs bg-blue-50 text-blue-700 border-blue-200"
                      >
                        {roomType.name}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-xs">
                      ETB{" "}
                      {(roomType?.basePrice ?? hotel.pricePerNight).toLocaleString()}
                      /night
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Checkout */}
          <div className="space-y-6">
            {isLoadingQuote || isLoadingProviders || quoteError ? (
              <Card className="shadow-lg border-0 bg-white">
                <CardContent className="flex items-center justify-center py-12">
                  <div className="flex items-center gap-3">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                    <span className="text-gray-700">Preparing payment...</span>
                  </div>
                </CardContent>
              </Card>
            ) : currentUser && quote && enabledProviders.length > 0 ? (
              <Card className="shadow-lg border-0 bg-white">
                <CardContent className="p-0">
                  <BookingForm
                    currentUser={currentUser}
                    hotel={hotel}
                    hotelId={hotelId as string}
                    roomTypeId={search.roomTypeId || undefined}
                    roomTypeName={roomType?.name}
                    checkIn={checkIn}
                    checkOut={checkOut}
                    adultCount={search.adultCount}
                    childCount={search.childCount}
                    quote={quote}
                    providers={enabledProviders}
                  />
                </CardContent>
              </Card>
            ) : (
              <Card className="shadow-lg border-0 bg-white">
                <CardContent className="flex items-center justify-center py-12 text-center">
                  <p className="text-gray-600">
                    No payment methods are currently available. Please contact
                    the property.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Booking;
