import axiosInstance from "./lib/api-client";
import { RegisterFormData } from "./pages/Register";
import { SignInFormData } from "./pages/SignIn";
import {
  HotelSearchResponse,
  HotelType,
  HotelDetailType,
  PaymentIntentResponse,
  UserType,
  HotelWithBookingsType,
  BookingType,
  QuoteResponse,
  PaymentProviderInfo,
  CreateBookingPayload,
  CreateBookingResponse,
  BookingLookupResponse,
} from "../../shared/types";

// --- AUTH I USER SEKCIJA ---

export const register = async (formData: RegisterFormData) => {
  const response = await axiosInstance.post("/api/users/register", formData);
  return response.data;
};

export const signIn = async (formData: SignInFormData) => {
  const response = await axiosInstance.post("/api/auth/login", formData);
  
  return response.data;
};

export type PublicSettings = {
  currency: string;
  features: {
    phoneLogin: boolean;
    otpEnabled: boolean;
    reviewsEnabled: boolean;
    telegramEnabled: boolean;
  };
  [key: string]: unknown;
};

export const fetchPublicSettings = async (): Promise<PublicSettings> => {
  const response = await axiosInstance.get("/api/settings/public");
  return response.data;
};

export const validateToken = async () => {
  const response = await axiosInstance.get("/api/auth/validate-token");
  return response.data;
};

export const signOut = async () => {
  const response = await axiosInstance.post("/api/auth/logout");
  localStorage.removeItem("user_id");
  return response.data;
};

export const fetchCurrentUser = async (): Promise<UserType> => {
  const response = await axiosInstance.get("/api/users/me");
  return response.data;
};

// --- MOJI HOTELI (ADMIN/HOST) ---

export const addMyHotel = async (hotelFormData: FormData) => {
  const response = await axiosInstance.post("/api/my-hotels", hotelFormData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return response.data;
};

export const fetchMyHotels = async (): Promise<HotelType[]> => {
  const response = await axiosInstance.get("/api/my-hotels");
  return response.data;
};

export const fetchMyHotelById = async (hotelId: string): Promise<HotelType> => {
  const response = await axiosInstance.get(`/api/my-hotels/${hotelId}`);
  return response.data;
};

export const updateMyHotelById = async (hotelFormData: FormData) => {
  const hotelId = hotelFormData.get("hotelId");
  const response = await axiosInstance.put(
    `/api/my-hotels/${hotelId}`,
    hotelFormData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    }
  );
  return response.data;
};

// --- PRETRAGA I JAVNI HOTELI ---

export type SearchParams = {
  destination?: string;
  checkIn?: string;
  checkOut?: string;
  adultCount?: string;
  childCount?: string;
  page?: string;
  facilities?: string[];
  types?: string[];
  stars?: string[];
  maxPrice?: string;
  sortOption?: string;
};

export const searchHotels = async (
  searchParams: SearchParams
): Promise<HotelSearchResponse> => {
  const queryParams = new URLSearchParams();

  if (searchParams.destination?.trim()) {
    queryParams.append("destination", searchParams.destination.trim());
  }

  queryParams.append("checkIn", searchParams.checkIn || "");
  queryParams.append("checkOut", searchParams.checkOut || "");
  queryParams.append("adultCount", searchParams.adultCount || "");
  queryParams.append("childCount", searchParams.childCount || "");
  queryParams.append("page", searchParams.page || "");
  queryParams.append("maxPrice", searchParams.maxPrice || "");
  queryParams.append("sortOption", searchParams.sortOption || "");

  searchParams.facilities?.forEach((facility) => queryParams.append("facilities", facility));
  searchParams.types?.forEach((type) => queryParams.append("types", type));
  searchParams.stars?.forEach((star) => queryParams.append("stars", star));

  const response = await axiosInstance.get(`/api/hotels/search?${queryParams}`);
  return response.data;
};

export const fetchHotels = async (): Promise<HotelType[]> => {
  const response = await axiosInstance.get("/api/hotels");
  return response.data;
};

export const fetchHotelById = async (
  hotelId: string
): Promise<HotelDetailType> => {
  const response = await axiosInstance.get(`/api/hotels/${hotelId}`);
  return response.data;
};

// --- PHASE 1: QUOTES, PROVIDERS, PROVIDER-AWARE CHECKOUT ---

export type QuotePayload = {
  hotelId: string;
  roomTypeId?: string;
  checkIn: string;
  checkOut: string;
  adultCount: number;
  childCount: number;
  displayCurrency?: string;
};

export const createQuote = async (
  payload: QuotePayload
): Promise<QuoteResponse> => {
  const response = await axiosInstance.post("/api/quotes", payload);
  return response.data;
};

export const fetchPaymentProviders = async (): Promise<{
  providers: PaymentProviderInfo[];
}> => {
  const response = await axiosInstance.get("/api/payment-providers");
  return response.data;
};

export const createProviderBooking = async (
  payload: CreateBookingPayload
): Promise<CreateBookingResponse> => {
  const response = await axiosInstance.post("/api/bookings", payload);
  return response.data;
};

export type BookingLookupPayload = {
  reference: string;
  phone?: string;
  email?: string;
};

export const lookupBooking = async (
  payload: BookingLookupPayload
): Promise<BookingLookupResponse> => {
  const response = await axiosInstance.post("/api/bookings/lookup", payload);
  return response.data;
};

export const cancelBookingByReference = async (
  payload: BookingLookupPayload & { cancellationReason?: string }
): Promise<{ booking: BookingType }> => {
  const response = await axiosInstance.post(
    "/api/bookings/lookup/cancel",
    payload
  );
  return response.data;
};

// --- REZERVACIJE I PLAĆANJE ---

export const createPaymentIntent = async (
  hotelId: string,
  numberOfNights: string
): Promise<PaymentIntentResponse> => {
  const response = await axiosInstance.post(
    `/api/hotels/${hotelId}/bookings/payment-intent`,
    { numberOfNights }
  );
  return response.data;
};

export const createRoomBooking = async (formData: {
  hotelId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  adultCount: number;
  childCount: number;
  checkIn: string;
  checkOut: string;
  paymentIntentId: string;
  totalCost: number;
  specialRequests?: string;
}) => {
  const response = await axiosInstance.post(
    `/api/hotels/${formData.hotelId}/bookings`,
    formData
  );
  return response.data;
};

export const fetchMyBookings = async (): Promise<HotelWithBookingsType[]> => {
  const response = await axiosInstance.get("/api/my-bookings");
  return response.data;
};

export const fetchHotelBookings = async (hotelId: string): Promise<BookingType[]> => {
  const response = await axiosInstance.get(`/api/bookings/hotel/${hotelId}`);
  return response.data;
};

// --- RECENZIJE I FAVORITI ---

export const fetchReviewsByHotelId = async (hotelId: string) => {
  try {
    const response = await axiosInstance.get(`/api/reviews/${hotelId}`);
    return response.data;
  } catch (error: any) {
    if (error.response?.status === 404) return [];
    throw new Error("Failed to fetch reviews");
  }
};

export type CreateReviewPayload = {
  rating: number;
  comment: string;
  categories: {
    cleanliness: number;
    service: number;
    location: number;
    value: number;
    amenities: number;
  };
};

export const createReview = async (hotelId: string, payload: CreateReviewPayload) => {
  const response = await axiosInstance.post(`/api/reviews/${hotelId}`, payload);
  return response.data;
};

// --- PHASE 3: SETTINGS + PAYMENT PROVIDERS (owner/admin) ---

export type AdminProviderConfig = Record<string, any>;

export type AdminPaymentProvider = {
  id: string;
  displayName: string;
  kind: "online" | "onsite";
  enabled: boolean;
  sortOrder: number;
  config: AdminProviderConfig;
  available: boolean;
};

export const fetchAdminPaymentProviders = async (): Promise<{
  providers: AdminPaymentProvider[];
}> => {
  const response = await axiosInstance.get("/api/admin/payment-providers");
  return response.data;
};

export const updateAdminPaymentProvider = async (
  id: string,
  patch: Partial<AdminPaymentProvider>
): Promise<AdminPaymentProvider> => {
  const response = await axiosInstance.put(
    `/api/admin/payment-providers/${id}`,
    patch
  );
  return response.data;
};

export const fetchSettings = async (): Promise<any> => {
  const response = await axiosInstance.get("/api/settings");
  return response.data;
};

export const updateSettings = async (patch: any): Promise<any> => {
  const response = await axiosInstance.put("/api/settings", patch);
  return response.data;
};

// --- PHASE 3: ROOM TYPES (owner/admin) ---

export type RoomTypeAdmin = {
  _id: string;
  hotelId: string;
  name: string;
  description: string | null;
  maxAdults: number;
  maxChildren: number;
  basePrice: number;
  roomCount: number;
  photos: string[];
  sortOrder: number;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type RoomTypePayload = {
  name?: string;
  description?: string;
  maxAdults?: number;
  maxChildren?: number;
  basePrice?: number;
  roomCount?: number;
  sortOrder?: number;
  active?: boolean;
  photos?: string[];
};

export const fetchRoomTypes = async (
  hotelId: string
): Promise<{ roomTypes: RoomTypeAdmin[] }> => {
  const response = await axiosInstance.get(`/api/my-hotels/${hotelId}/rooms`);
  return response.data;
};

export const createRoomType = async (
  hotelId: string,
  payload: RoomTypePayload | FormData
): Promise<RoomTypeAdmin> => {
  const response = await axiosInstance.post(
    `/api/my-hotels/${hotelId}/rooms`,
    payload,
    payload instanceof FormData
      ? { headers: { "Content-Type": "multipart/form-data" } }
      : undefined
  );
  return response.data;
};

export const updateRoomType = async (
  hotelId: string,
  roomTypeId: string,
  payload: RoomTypePayload | FormData
): Promise<RoomTypeAdmin> => {
  const response = await axiosInstance.put(
    `/api/my-hotels/${hotelId}/rooms/${roomTypeId}`,
    payload,
    payload instanceof FormData
      ? { headers: { "Content-Type": "multipart/form-data" } }
      : undefined
  );
  return response.data;
};

export const deleteRoomType = async (
  hotelId: string,
  roomTypeId: string
): Promise<{ message: string }> => {
  const response = await axiosInstance.delete(
    `/api/my-hotels/${hotelId}/rooms/${roomTypeId}`
  );
  return response.data;
};

export const fetchCalendar = async (hotelId: string, from?: string, to?: string) => {
  const q = new URLSearchParams();
  if (from) q.append("from", from);
  if (to) q.append("to", to);
  const qs = q.toString();
  const response = await axiosInstance.get(
    `/api/admin/hotels/${hotelId}/calendar${qs ? `?${qs}` : ""}`
  );
  return response.data;
};

// --- PHASE 3d: MANUAL BOOKING (owner/admin) ---

export type ManualBookingPayload = {
  hotelId: string;
  roomTypeId?: string;
  checkIn: string;
  checkOut: string;
  adultCount: number;
  childCount: number;
  firstName: string;
  lastName: string;
  email?: string;
  phone: string;
  specialRequests?: string;
  source?: "web" | "phone" | "walkin" | "telegram";
  paymentMethod?: string;
  totalCost?: number;
};

export const createManualBooking = async (
  payload: ManualBookingPayload
): Promise<{ booking: BookingType }> => {
  const response = await axiosInstance.post("/api/admin/bookings/manual", payload);
  return response.data;
};

// --- PHASE 3c: BOOKING MANAGEMENT (owner/admin) ---

export type ManagementPayment = {
  _id: string;
  bookingId: string;
  providerId: string;
  type: "deposit" | "balance" | "refund" | "charge";
  amount: number;
  currency: string;
  status: "pending" | "succeeded" | "failed" | "refunded";
  providerRef: string | null;
  createdAt?: string;
};

export type ManagementBooking = BookingType & {
  roomTypeName?: string | null;
  payments?: ManagementPayment[];
  paidAmount?: number;
  refundedAmount?: number;
  netPaid?: number;
};

export type ManagementBookingsParams = {
  status?: string;
  checkInFrom?: string;
  checkInTo?: string;
};

export const fetchManagementBookings = async (
  hotelId: string,
  params?: ManagementBookingsParams
): Promise<{ bookings: ManagementBooking[] }> => {
  const query = new URLSearchParams();
  if (params?.status) query.append("status", params.status);
  if (params?.checkInFrom) query.append("checkInFrom", params.checkInFrom);
  if (params?.checkInTo) query.append("checkInTo", params.checkInTo);
  const qs = query.toString();
  const response = await axiosInstance.get(
    `/api/management/hotels/${hotelId}/bookings${qs ? `?${qs}` : ""}`
  );
  return response.data;
};

export type RecordPaymentPayload = {
  amount: number;
  providerId?: string;
  reference?: string;
  note?: string;
  method?: string;
};

export const recordBookingPayment = async (
  bookingId: string,
  payload: RecordPaymentPayload
): Promise<{
  payment: ManagementPayment;
  booking: ManagementBooking;
  remaining: number;
}> => {
  const response = await axiosInstance.post(
    `/api/management/bookings/${bookingId}/payments`,
    payload
  );
  return response.data;
};

export type IssueRefundPayload = {
  amount: number;
  reason?: string;
  reference?: string;
};

export const issueBookingRefund = async (
  bookingId: string,
  payload: IssueRefundPayload
): Promise<{
  refund: ManagementPayment;
  booking: ManagementBooking;
  refunded: number;
}> => {
  const response = await axiosInstance.post(
    `/api/management/bookings/${bookingId}/refunds`,
    payload
  );
  return response.data;
};

export const updateBookingStatus = async (
  bookingId: string,
  payload: { status: string; cancellationReason?: string; refundAmount?: number }
): Promise<BookingType> => {
  const response = await axiosInstance.patch(
    `/api/bookings/${bookingId}/status`,
    payload
  );
  return response.data;
};

// --- ADMIN I INSIGHTS ---

export const fetchAdminDashboard = async () => {
  const response = await axiosInstance.get("/api/admin/dashboard");
  return response.data;
};

export const fetchBusinessInsightsDashboard = async () => {
  const response = await axiosInstance.get("/api/business-insights/dashboard");
  return response.data;
};

export const fetchBusinessInsightsForecast = async () => {
  const response = await axiosInstance.get("/api/business-insights/forecast");
  return response.data;
};

export const fetchBusinessInsightsPerformance = async () => {
  const response = await axiosInstance.get("/api/business-insights/performance");
  return response.data;
};

// Pomocna funkcija za čišćenje (samo za dev)
export const clearAllStorage = () => {
  localStorage.clear();
  sessionStorage.clear();
};