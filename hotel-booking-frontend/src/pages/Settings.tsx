import { useEffect, useState } from "react";
import * as apiClient from "../api-client";
import useAppContext from "../hooks/useAppContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Separator } from "../components/ui/separator";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";

type Fee = { id: string; name: string; type: "percent" | "fixed"; value: number; active: boolean };

const PREPAY_MODES = ["none", "percent", "fixed", "full"] as const;
const TIMEZONES = [
  "Africa/Addis_Ababa",
  "Africa/Nairobi",
  "UTC",
  "Europe/London",
  "America/New_York",
  "Asia/Dubai",
];

const feeId = () => `fee_${Math.random().toString(36).slice(2, 9)}`;

export default function Settings() {
  const { user, showToast } = useAppContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<any>(null);
  const [providers, setProviders] = useState<apiClient.AdminPaymentProvider[]>([]);
  const [providerSaving, setProviderSaving] = useState<string | null>(null);
  const [testingTelegram, setTestingTelegram] = useState(false);

  const isManager = user?.role === "admin" || user?.role === "hotel_owner";

  const load = async () => {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([
        apiClient.fetchSettings(),
        apiClient.fetchAdminPaymentProviders(),
      ]);
      setSettings(s);
      setProviders(p.providers || []);
    } catch (e: any) {
      showToast({
        title: "Failed to load settings",
        description: e?.response?.data?.message || e?.message || "Request failed",
        type: "ERROR",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isManager) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (!isManager) {
    return (
      <div className="container mx-auto py-12 text-center">
        <p className="text-gray-600">Only managers can view settings.</p>
      </div>
    );
  }

  if (loading || !settings) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="animate-spin h-8 w-8 text-blue-600" />
      </div>
    );
  }

  const set = (key: string, value: any) =>
    setSettings((prev: any) => ({ ...prev, [key]: value }));

  const setProperty = (key: string, value: string) =>
    setSettings((prev: any) => ({ ...prev, property: { ...prev.property, [key]: value } }));

  const setFeature = (key: string, value: boolean) =>
    setSettings((prev: any) => ({ ...prev, features: { ...prev.features, [key]: value } }));

  const setPrepayment = (key: string, value: any) =>
    setSettings((prev: any) => ({ ...prev, prepayment: { ...prev.prepayment, [key]: value } }));

  const addFee = () =>
    setSettings((prev: any) => ({
      ...prev,
      fees: [...(prev.fees || []), { id: feeId(), name: "New fee", type: "percent", value: 0, active: true }],
    }));

  const updateFee = (idx: number, patch: Partial<Fee>) =>
    setSettings((prev: any) => ({
      ...prev,
      fees: prev.fees.map((f: Fee, i: number) => (i === idx ? { ...f, ...patch } : f)),
    }));

  const removeFee = (idx: number) =>
    setSettings((prev: any) => ({ ...prev, fees: prev.fees.filter((_: Fee, i: number) => i !== idx) }));

  const saveSettings = async () => {
    setSaving(true);
    try {
      const updated = await apiClient.updateSettings(settings);
      setSettings(updated);
      showToast({ title: "Settings saved", description: "Your changes are live.", type: "SUCCESS" });
    } catch (e: any) {
      showToast({
        title: "Save failed",
        description: e?.response?.data?.message || e?.message || "Request failed",
        type: "ERROR",
      });
    } finally {
      setSaving(false);
    }
  };

  const saveProvider = async (p: apiClient.AdminPaymentProvider) => {
    setProviderSaving(p.id);
    try {
      const updated = await apiClient.updateAdminPaymentProvider(p.id, {
        enabled: p.enabled,
        sortOrder: p.sortOrder,
        config: p.config,
        displayName: p.displayName,
      });
      setProviders((prev) => prev.map((x) => (x.id === p.id ? updated : x)));
      showToast({ title: "Payment method saved", description: updated.displayName, type: "SUCCESS" });
    } catch (e: any) {
      showToast({
        title: "Save failed",
        description: e?.response?.data?.message || e?.message || "Request failed",
        type: "ERROR",
      });
    } finally {
      setProviderSaving(null);
    }
  };

  const sendTestTelegram = async () => {
    setTestingTelegram(true);
    try {
      const res = await apiClient.testTelegram();
      showToast({
        title: res.ok ? "Test message sent" : "Test failed",
        description: res.botUsername ? `Bot: @${res.botUsername}` : res.message,
        type: res.ok ? "SUCCESS" : "ERROR",
      });
    } catch (e: any) {
      showToast({
        title: "Test failed",
        description: e?.response?.data?.message || e?.message || "Request failed",
        type: "ERROR",
      });
    } finally {
      setTestingTelegram(false);
    }
  };

  const setProviderField = (id: string, patch: Partial<apiClient.AdminPaymentProvider>) =>
    setProviders((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const setProviderConfig = (id: string, key: string, value: any) =>
    setProviders((prev) =>
      prev.map((x) => (x.id === id ? { ...x, config: { ...x.config, [key]: value } } : x))
    );

  const inputCls = "border rounded-md px-3 py-2 w-full text-sm";

  return (
    <div className="container mx-auto py-8 max-w-5xl space-y-6 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Site settings</h1>
          <p className="text-gray-600 text-sm">
            Currency, policy, branding and payment methods — no code changes needed.
          </p>
        </div>
        <Button onClick={saveSettings} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save settings
        </Button>
      </div>

      {/* PROPERTY / BRANDING */}
      <Card>
        <CardHeader><CardTitle className="text-base">Property &amp; branding</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Property name</Label>
            <Input className={inputCls} value={settings.property?.name || ""} onChange={(e) => setProperty("name", e.target.value)} placeholder="Grand Hotel" />
          </div>
          <div>
            <Label>Phone</Label>
            <Input className={inputCls} value={settings.property?.phone || ""} onChange={(e) => setProperty("phone", e.target.value)} placeholder="+251..." />
          </div>
          <div>
            <Label>Email</Label>
            <Input className={inputCls} value={settings.property?.email || ""} onChange={(e) => setProperty("email", e.target.value)} />
          </div>
          <div>
            <Label>Telegram handle</Label>
            <Input className={inputCls} value={settings.property?.telegramHandle || ""} onChange={(e) => setProperty("telegramHandle", e.target.value)} placeholder="@hotel" />
          </div>
          <div className="md:col-span-2">
            <Label>Address</Label>
            <Textarea className={inputCls} rows={2} value={settings.property?.address || ""} onChange={(e) => setProperty("address", e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* CURRENCY */}
      <Card>
        <CardHeader><CardTitle className="text-base">Currency &amp; display</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>Stored currency</Label>
            <Input className={inputCls} value={settings.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} />
          </div>
          <div>
            <Label>Display currencies (comma separated)</Label>
            <Input
              className={inputCls}
              value={(settings.displayCurrencies || []).join(", ")}
              onChange={(e) =>
                set("displayCurrencies", e.target.value.split(",").map((x: string) => x.trim()).filter(Boolean))
              }
            />
          </div>
          <div>
            <Label>USD exchange rate (units per 1 USD, 0 = off)</Label>
            <Input type="number" min={0} className={inputCls} value={settings.usdRate} onChange={(e) => set("usdRate", Number(e.target.value))} />
          </div>
        </CardContent>
      </Card>

      {/* TIMEZONE / STAY */}
      <Card>
        <CardHeader><CardTitle className="text-base">Timezone &amp; stay rules</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>Timezone</Label>
            <select className={inputCls} value={settings.timezone} onChange={(e) => set("timezone", e.target.value)}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div>
            <Label>Check-in time</Label>
            <Input className={inputCls} value={settings.checkInTime} onChange={(e) => set("checkInTime", e.target.value)} placeholder="14:00" />
          </div>
          <div>
            <Label>Check-out time</Label>
            <Input className={inputCls} value={settings.checkOutTime} onChange={(e) => set("checkOutTime", e.target.value)} placeholder="11:00" />
          </div>
          <div>
            <Label>Min nights</Label>
            <Input type="number" min={0} className={inputCls} value={settings.minNights} onChange={(e) => set("minNights", Number(e.target.value))} />
          </div>
          <div>
            <Label>Max nights</Label>
            <Input type="number" min={0} className={inputCls} value={settings.maxNights} onChange={(e) => set("maxNights", Number(e.target.value))} />
          </div>
          <div>
            <Label>Free cancellation (hours before check-in)</Label>
            <Input type="number" min={0} className={inputCls} value={settings.freeCancellationHours} onChange={(e) => set("freeCancellationHours", Number(e.target.value))} />
          </div>
        </CardContent>
      </Card>

      {/* PREPAYMENT */}
      <Card>
        <CardHeader><CardTitle className="text-base">Prepayment &amp; payment at property</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <Label>Prepayment mode</Label>
            <select className={inputCls} value={settings.prepayment?.mode} onChange={(e) => setPrepayment("mode", e.target.value)}>
              {PREPAY_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <Label>Prepayment value ({settings.prepayment?.mode === "percent" ? "%" : settings.currency})</Label>
            <Input type="number" min={0} className={inputCls} value={settings.prepayment?.value} onChange={(e) => setPrepayment("value", Number(e.target.value))} />
          </div>
          <div className="flex items-center gap-2 py-2">
            <input
              id="allowPayAtProperty"
              type="checkbox"
              className="h-4 w-4"
              checked={Boolean(settings.allowPayAtProperty)}
              onChange={(e) => set("allowPayAtProperty", e.target.checked)}
            />
            <Label htmlFor="allowPayAtProperty">Allow pay at property</Label>
          </div>
        </CardContent>
      </Card>

      {/* FEES */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Fees</CardTitle>
          <Button variant="outline" size="sm" onClick={addFee}><Plus className="h-4 w-4 mr-1" /> Add fee</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {(settings.fees || []).length === 0 && (
            <p className="text-sm text-gray-500">No fees configured.</p>
          )}
          {(settings.fees || []).map((fee: Fee, idx: number) => (
            <div key={fee.id} className="flex flex-wrap gap-2 items-end border rounded-md p-3">
              <div className="flex-1 min-w-[160px]">
                <Label>Name</Label>
                <Input className={inputCls} value={fee.name} onChange={(e) => updateFee(idx, { name: e.target.value })} />
              </div>
              <div className="w-28">
                <Label>Type</Label>
                <select className={inputCls} value={fee.type} onChange={(e) => updateFee(idx, { type: e.target.value as Fee["type"] })}>
                  <option value="percent">percent</option>
                  <option value="fixed">fixed</option>
                </select>
              </div>
              <div className="w-24">
                <Label>Value</Label>
                <Input type="number" min={0} className={inputCls} value={fee.value} onChange={(e) => updateFee(idx, { value: Number(e.target.value) })} />
              </div>
              <label className="flex items-center gap-1 text-sm pb-2">
                <input type="checkbox" className="h-4 w-4" checked={fee.active} onChange={(e) => updateFee(idx, { active: e.target.checked })} />
                Active
              </label>
              <Button variant="ghost" size="sm" onClick={() => removeFee(idx)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* FEATURES */}
      <Card>
        <CardHeader><CardTitle className="text-base">Feature toggles</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            ["phoneLogin", "Phone sign-in"],
            ["otpEnabled", "OTP verification"],
            ["reviewsEnabled", "Guest reviews"],
            ["telegramEnabled", "Telegram integration"],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={Boolean((settings.features || {})[key as string])}
                onChange={(e) => setFeature(key as string, e.target.checked)}
              />
              {label}
            </label>
          ))}
          <div>
            <Label>Telegram bot token (write-only)</Label>
            <Input className={inputCls} type="password" placeholder={settings.telegram?.botTokenConfigured ? "•••••••• (configured)" : "not configured"} onChange={(e) => set("telegram", { ...(settings.telegram || {}), botToken: e.target.value })} />
          </div>
          <div>
            <Label>Telegram chat id</Label>
            <Input className={inputCls} value={settings.telegram?.chatId || ""} onChange={(e) => set("telegram", { ...(settings.telegram || {}), chatId: e.target.value })} />
          </div>
          <div>
            <Label>Webhook secret (write-only)</Label>
            <Input
              className={inputCls}
              type="password"
              placeholder={settings.telegram?.webhookSecretConfigured ? "•••••••• (configured)" : "not configured"}
              onChange={(e) => set("telegram", { ...(settings.telegram || {}), webhookSecret: e.target.value })}
            />
            <p className="text-xs text-gray-500 mt-1">Random string; also part of the webhook URL below. Telegram must reach it.</p>
          </div>
          <div>
            <Label>Public base URL</Label>
            <Input
              className={inputCls}
              value={settings.publicBaseUrl || ""}
              onChange={(e) => set("publicBaseUrl", e.target.value)}
              placeholder="https://your-hotel.example.com"
            />
            <p className="text-xs text-gray-500 mt-1">Used to register the Telegram webhook (must be HTTPS & publicly reachable).</p>
          </div>
          <div className="md:col-span-2">
            <Label>Webhook URL (register this with Telegram)</Label>
            <div className="flex gap-2 items-center flex-wrap mt-1">
              <code className="text-xs bg-gray-100 rounded px-2 py-1 break-all">
                {(settings.publicBaseUrl || "<public-base-url>").replace(/\/+$/, "")}/api/webhooks/telegram/
                {settings.telegram?.webhookSecretConfigured ? "{secret}" : "<secret>"}
              </code>
              <Button
                variant="outline"
                size="sm"
                disabled={testingTelegram}
                onClick={sendTestTelegram}
              >
                {testingTelegram ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send test message"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* PAYMENT METHODS */}
      <Card>
        <CardHeader><CardTitle className="text-base">Payment methods</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {providers.map((p) => (
            <div key={p.id} className="border rounded-md p-4 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.displayName}</span>
                  <Badge variant="outline">{p.kind}</Badge>
                  {!p.available && <Badge className="bg-amber-100 text-amber-800">not configured</Badge>}
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={p.enabled}
                      onChange={(e) => setProviderField(p.id, { enabled: e.target.checked })}
                    />
                    Enabled
                  </label>
                  <div className="flex items-center gap-1 text-sm">
                    <Label>Order</Label>
                    <Input
                      type="number"
                      min={0}
                      className="w-20 border rounded-md px-2 py-1 text-sm"
                      value={p.sortOrder}
                      onChange={(e) => setProviderField(p.id, { sortOrder: Number(e.target.value) })}
                    />
                  </div>
                  <Button size="sm" onClick={() => saveProvider(p)} disabled={providerSaving === p.id}>
                    {providerSaving === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {Object.entries(p.config || {}).map(([key, value]) => (
                  <div key={key}>
                    <Label>{key}</Label>
                    {typeof value === "boolean" ? (
                      <input
                        type="checkbox"
                        className="h-4 w-4 mt-1"
                        checked={value}
                        onChange={(e) => setProviderConfig(p.id, key, e.target.checked)}
                      />
                    ) : key === "mode" ? (
                      <select className={inputCls} value={String(value)} onChange={(e) => setProviderConfig(p.id, key, e.target.value)}>
                        <option value="mock">mock</option>
                        <option value="live">live</option>
                      </select>
                    ) : (
                      <Input
                        className={inputCls}
                        type={/secret|key|password|token/i.test(key) ? "password" : "text"}
                        value={String(value ?? "")}
                        onChange={(e) => setProviderConfig(p.id, key, e.target.value)}
                      />
                    )}
                  </div>
                ))}
                {Object.keys(p.config || {}).length === 0 && (
                  <p className="text-sm text-gray-500 col-span-2">No configuration options.</p>
                )}
              </div>
            </div>
          ))}
          {providers.length === 0 && <p className="text-sm text-gray-500">No payment providers found.</p>}
          <Separator />
          <p className="text-xs text-gray-500">
            Disabled methods disappear from checkout. Disabled methods are not
            charged until re-enabled.
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={saveSettings} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save settings
        </Button>
      </div>
    </div>
  );
}

