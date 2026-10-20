import { useState } from "react";
import { useQueryClient } from "react-query";
import * as apiClient from "../api-client";
import { useQueryWithLoading, useMutationWithLoading } from "../hooks/useLoadingHooks";
import useAppContext from "../hooks/useAppContext";

const statusStyles: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  sent: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-600",
};

const Notifications = () => {
  const queryClient = useQueryClient();
  const { showToast } = useAppContext();
  const [status, setStatus] = useState<string>("");

  const { data, isLoading } = useQueryWithLoading(
    ["admin-notifications", status],
    () => apiClient.fetchAdminNotifications(status || undefined),
    { onError: () => {} }
  );

  const notifications = data?.notifications ?? [];

  const refresh = () =>
    queryClient.invalidateQueries(["admin-notifications"]);

  const processMutation = useMutationWithLoading(
    () => apiClient.processAdminNotifications(),
    {
      onSuccess: () => {
        showToast({ title: "Outbox processed", type: "SUCCESS" });
        refresh();
      },
      onError: () =>
        showToast({ title: "Unable to process outbox", type: "ERROR" }),
    }
  );

  const reminderMutation = useMutationWithLoading(
    () => apiClient.queueAdminReminders(),
    {
      onSuccess: (res) => {
        showToast({
          title: `Queued ${res.queued} reminder${res.queued === 1 ? "" : "s"}`,
          type: "SUCCESS",
        });
        refresh();
      },
      onError: () =>
        showToast({ title: "Unable to queue reminders", type: "ERROR" }),
    }
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          <p className="text-sm text-gray-500">
            Outbox of guest and staff messages queued by bookings and payments.
          </p>
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <div>
            <label className="text-xs text-gray-600 block">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="border rounded-md px-2 py-1 text-sm"
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => reminderMutation.mutate(undefined as void)}
            disabled={reminderMutation.isLoading}
            className="border rounded-md px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Queue check-in reminders
          </button>
          <button
            type="button"
            onClick={() => processMutation.mutate(undefined as void)}
            disabled={processMutation.isLoading}
            className="bg-primary-600 text-white rounded-md px-3 py-1.5 text-sm hover:bg-primary-700 disabled:opacity-50"
          >
            Process outbox
          </button>
        </div>
      </div>

      <div className="overflow-x-auto bg-white border rounded-lg shadow-sm">
        <table className="min-w-[800px] w-full text-sm">
          <thead>
            <tr className="text-left text-gray-600 border-b">
              <th className="p-2">When</th>
              <th className="p-2">Type</th>
              <th className="p-2">Channel</th>
              <th className="p-2">To</th>
              <th className="p-2">Subject</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && notifications.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-gray-500">
                  No notifications.
                </td>
              </tr>
            )}
            {notifications.map((n) => (
              <tr key={n._id} className="border-b last:border-0">
                <td className="p-2 whitespace-nowrap text-gray-500">
                  {n.createdAt
                    ? new Date(n.createdAt).toLocaleString()
                    : "—"}
                </td>
                <td className="p-2 whitespace-nowrap">{n.type}</td>
                <td className="p-2 whitespace-nowrap">{n.channel}</td>
                <td className="p-2 whitespace-nowrap">{n.to ?? "—"}</td>
                <td className="p-2 max-w-[280px] truncate" title={n.subject ?? ""}>
                  {n.subject ?? "—"}
                </td>
                <td className="p-2">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      statusStyles[n.status] ?? "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {n.status}
                  </span>
                  {n.status === "failed" && n.error && (
                    <div className="text-xs text-red-600 mt-1 max-w-[240px] truncate" title={n.error}>
                      {n.error}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Notifications;
