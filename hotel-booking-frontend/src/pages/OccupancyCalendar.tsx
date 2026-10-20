import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import * as apiClient from "../api-client";
import { useQueryWithLoading } from "../hooks/useLoadingHooks";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

const addDays = (d: string, days: number) => {
  const dt = new Date(d + "T00:00:00.000Z");
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
};

const OccupancyCalendar = () => {
  const params = useParams<{ hotelId: string }>();
  const hotelId = params.hotelId as string;
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 14));

  const { data } = useQueryWithLoading(
    ["calendar", hotelId, from, to],
    () => apiClient.fetchCalendar(hotelId, from, to),
    { onError: () => {} }
  );

  const nights: string[] = data?.nights ?? [];
  const roomTypes = data?.roomTypes ?? [];
  const inv: Map<string, number> = data?.inventory ?? new Map();
  const bookings = data?.bookings ?? [];

  const getReserved = (rtId: string, night: string) =>
    inv.get(`${rtId}:${night}`) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link to="/my-hotels" className="text-sm text-gray-500 hover:text-primary-600">
            ← My Hotels
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">Occupancy Calendar</h1>
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <div>
            <label className="text-xs text-gray-600">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border rounded-md px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-600">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border rounded-md px-2 py-1 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto bg-white border rounded-lg shadow-sm">
        <table className="min-w-[800px] w-full text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white p-2 text-left border-b">Room Type</th>
              {nights.map((n) => (
                <th key={n} className="p-1 text-center border-b whitespace-nowrap">
                  {n.slice(5)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roomTypes.map((rt: any) => (
              <tr key={rt._id}>
                <td className="sticky left-0 bg-white p-2 border-b font-medium">
                  {rt.name}
                  <div className="text-xs text-gray-500">{rt.roomCount} total</div>
                </td>
                {nights.map((n) => {
                  const res = getReserved(rt._id, n);
                  const pct = rt.roomCount > 0 ? Math.min(100, (res / rt.roomCount) * 100) : 0;
                  const cls = pct >= 100 ? "bg-red-200" : pct >= 50 ? "bg-yellow-100" : "bg-green-50";
                  return (
                    <td key={n} className="p-0.5 border-b text-center">
                      <div className={`rounded-sm py-1 ${cls}`}>
                        {res}/{rt.roomCount}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default OccupancyCalendar;
