export type UserType = {
  _id: string;
  /** Null for phone-only accounts (Phase 2). */
  email: string | null;
  password: string;
  firstName: string;
  lastName: string;
  role?: "user" | "admin" | "hotel_owner";
  /** E.164 phone — first-class identity (Phase 2). */
  phone?: string | null;
  phoneVerified?: boolean;
  address?: {
    street: string;
    city: string;
    state: string;
    country: string;
    zipCode: string;
  };
  preferences?: {
    preferredDestinations: string[];
    preferredHotelTypes: string[];
    budgetRange: {
      min: number;
      max: number;
    };
  };
  totalBookings?: number;
  totalSpent?: number;
  lastLogin?: Date;
  isActive?: boolean;
  emailVerified?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

export type HotelType = {
  _id: string;
  userId: string;
  name: string;
  city: string;
  country: string;
  description: string;
  type: string[];
  adultCount: number;
  childCount: number;
  facilities: string[];
  pricePerNight: number;
  starRating: number;
  imageUrls: string[];
  lastUpdated: Date;
  // Remove embedded bookings - using separate collection now
  // bookings: BookingType[];

  // New fields
  location?: {
    latitude: number;
    longitude: number;
    address: {
      street: string;
      city: string;
      state: string;
      country: string;
      zipCode: string;
    };
  };
  contact?: {
    phone: string;
    email: string;
    website: string;
  };
  policies?: {
    checkInTime: string;
    checkOutTime: string;
    cancellationPolicy: string;
    petPolicy: string;
    smokingPolicy: string;
  };
  amenities?: {
    parking: boolean;
    wifi: boolean;
    pool: boolean;
    gym: boolean;
    spa: boolean;
    restaurant: boolean;
    bar: boolean;
    airportShuttle: boolean;
    businessCenter: boolean;
  };
  totalBookings?: number;
  totalRevenue?: number;
  averageRating?: number;
  reviewCount?: number;
  occupancyRate?: number;
  isActive?: boolean;
  isFeatured?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

export type BookingType = {
  _id: string;
  /** Null for guest checkout (no account). */
  userId: string | null;
  hotelId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone?: string | null;
  adultCount: number;
  childCount: number;
  checkIn: Date;
  checkOut: Date;
  totalCost: number;
  status?:
    | "pending"
    | "confirmed"
    | "cancelled"
    | "completed"
    | "refunded"
    | "checked_in"
    | "checked_out"
    | "no_show";
  paymentStatus?:
    | "pending"
    | "paid"
    | "failed"
    | "refunded"
    | "deposit_paid"
    | "partially_refunded";
  paymentMethod?: string;
  specialRequests?: string;
  cancellationReason?: string;
  refundAmount?: number;
  /** Phase 1: room-type inventory + server-authoritative money fields. */
  roomTypeId?: string | null;
  reference?: string | null;
  depositAmount?: number;
  balanceAmount?: number;
  currency?: string;
  source?: "web" | "phone" | "telegram" | "walkin";
  createdAt?: Date;
  updatedAt?: Date;
};

export type HotelWithBookingsType = HotelType & {
  bookings: BookingType[];
};

/** Public room-type summary returned by GET /api/hotels/:id. */
export type RoomTypeSummary = {
  _id: string;
  name: string;
  description?: string | null;
  maxAdults: number;
  maxChildren: number;
  basePrice: number;
  roomCount: number;
  photos: string[];
  sortOrder?: number;
};

export type HotelDetailType = HotelType & {
  roomTypes?: RoomTypeSummary[];
};

export type QuoteBreakdown = {
  nights: number;
  currency: string;
  totalStored: number;
  display: { currency: string; total: number } | null;
  deposit: number;
  balance: number;
  fees: { name: string; amount: number }[];
};

/** POST /api/quotes — availability + server-computed price. */
export type QuoteResponse = {
  available: boolean;
  message?: string;
  nights?: number;
  currency?: string;
  quote?: QuoteBreakdown;
  roomType?: Pick<
    RoomTypeSummary,
    "_id" | "name" | "maxAdults" | "maxChildren" | "basePrice"
  > | null;
  hotel?: {
    _id: string;
    name: string;
    currency: string;
    checkInTime?: string;
    checkOutTime?: string;
  };
};

/** GET /api/payment-providers */
export type PaymentProviderInfo = {
  id: string;
  displayName: string;
  kind: "online" | "onsite";
  enabled: boolean;
  available: boolean;
  details?: Record<string, unknown>;
};

export type CreateBookingPayload = {
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
  providerId?: string;
  source?: "web" | "phone" | "walkin";
  /** Optional client cross-check; server quote is authoritative. */
  totalCost?: number;
};

export type CreateBookingResponse = {
  booking: BookingType;
  payment: {
    providerId: string;
    status: "pending" | "succeeded";
    intentId?: string;
    clientSecret?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
};

/** Guest self-service lookup — no account required (Phase 2). */
export type BookingLookupResponse = {
  booking: BookingType;
  hotel: {
    _id: string;
    name: string;
    city: string;
    country: string;
    contact?: Record<string, unknown> | null;
  } | null;
  freeCancellationHours: number;
  freeCancellationUntil: string;
  freeCancellation: boolean;
};

export type HotelSearchResponse = {
  data: HotelType[];
  pagination: {
    total: number;
    page: number;
    pages: number;
  };
};

export type PaymentIntentResponse = {
  paymentIntentId: string;
  clientSecret: string;
  totalCost: number;
};
