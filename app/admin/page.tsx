"use client";

import { useEffect, useMemo, useState } from "react";

const tabs = ["users", "invites", "quotas", "audit"] as const;

type TabKey = (typeof tabs)[number];

type UserRow = {
  id: string;
  email: string;
  status: "active" | "disabled";
  is_admin: boolean;
};

type InviteRow = {
  id: string;
  token: string;
  created_by: string;
  used_by: string | null;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

type QuotaRow = {
  user_id: string;
  email: string;
  allocated_bytes: number;
  used_bytes: number;
  updated_at: string;
};

type AuditRow = {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

function getCookie(name: string) {
  if (typeof document === "undefined") return "";
  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.trim().split("=");
    if (key === name) {
      return rest.join("=");
    }
  }
  return "";
}

async function fetchJson<T>(
  path: string,
  options?: RequestInit & { json?: unknown; csrfToken?: string }
): Promise<T> {
  const headers = new Headers(options?.headers ?? {});
  headers.set("accept", "application/json");

  if (options?.json !== undefined) {
    headers.set("content-type", "application/json");
  }

  if (options?.csrfToken) {
    headers.set("x-csrf-token", options.csrfToken);
  }

  const response = await fetch(path, {
    ...options,
    headers,
    body: options?.json !== undefined ? JSON.stringify(options.json) : undefined,
    credentials: "include",
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = data?.error ?? "Request failed";
    throw new Error(error);
  }

  return data as T;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return "-";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(1)} ${units[index]}`;
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<TabKey>("users");
  const [csrfToken, setCsrfToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [quotas, setQuotas] = useState<QuotaRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([]);

  const [inviteHours, setInviteHours] = useState("24");
  const [quotaDrafts, setQuotaDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    setCsrfToken(getCookie("csrf"));
  }, []);

  useEffect(() => {
    setError(null);
    if (activeTab === "users") {
      void loadUsers();
    }
    if (activeTab === "invites") {
      void loadInvites();
    }
    if (activeTab === "quotas") {
      void loadQuotas();
    }
    if (activeTab === "audit") {
      void loadAudit();
    }
  }, [activeTab]);

  const stats = useMemo(() => {
    const totalUsers = users.length;
    const admins = users.filter((user) => user.is_admin).length;
    const suspended = users.filter((user) => user.status === "disabled").length;
    return { totalUsers, admins, suspended };
  }, [users]);

  async function loadUsers() {
    setLoading(true);
    try {
      const data = await fetchJson<UserRow[]>("/api/admin/users");
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  async function loadInvites() {
    setLoading(true);
    try {
      const data = await fetchJson<InviteRow[]>("/api/admin/invite");
      setInvites(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invites");
    } finally {
      setLoading(false);
    }
  }

  async function loadQuotas() {
    setLoading(true);
    try {
      const data = await fetchJson<QuotaRow[]>("/api/admin/quotas");
      setQuotas(data);
      setQuotaDrafts((prev) => {
        const next = { ...prev };
        for (const row of data) {
          if (!next[row.user_id]) {
            next[row.user_id] = String(row.allocated_bytes);
          }
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load quotas");
    } finally {
      setLoading(false);
    }
  }

  async function loadAudit() {
    setLoading(true);
    try {
      const data = await fetchJson<AuditRow[]>("/api/admin/audit?limit=200");
      setAuditLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }

  async function updateUser(payload: { userIdToUpdate: string; status?: string; isAdmin?: boolean }) {
    setLoading(true);
    setError(null);
    try {
      await fetchJson("/api/admin/users", {
        method: "PATCH",
        json: payload,
        csrfToken,
      });
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setLoading(false);
    }
  }

  async function deleteUser(userIdToDelete: string) {
    if (!confirm("Delete this user and all related data?")) return;
    setLoading(true);
    setError(null);
    try {
      await fetchJson("/api/admin/users", {
        method: "DELETE",
        json: { userIdToDelete },
        csrfToken,
      });
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setLoading(false);
    }
  }

  async function createInvite() {
    setLoading(true);
    setError(null);
    try {
      const hours = Number(inviteHours);
      await fetchJson("/api/admin/invite", {
        method: "POST",
        json: { expiresInHours: hours },
        csrfToken,
      });
      await loadInvites();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite creation failed");
    } finally {
      setLoading(false);
    }
  }

  async function revokeInvite(inviteId: string) {
    setLoading(true);
    setError(null);
    try {
      await fetchJson("/api/admin/invite", {
        method: "PATCH",
        json: { inviteId },
        csrfToken,
      });
      await loadInvites();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite revoke failed");
    } finally {
      setLoading(false);
    }
  }

  async function deleteInvite(inviteId: string) {
    setLoading(true);
    setError(null);
    try {
      await fetchJson("/api/admin/invite", {
        method: "DELETE",
        json: { inviteId },
        csrfToken,
      });
      await loadInvites();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite delete failed");
    } finally {
      setLoading(false);
    }
  }

  async function updateQuota(userId: string) {
    setLoading(true);
    setError(null);
    try {
      const value = Number(quotaDrafts[userId]);
      await fetchJson("/api/admin/quotas", {
        method: "PATCH",
        json: { userId, allocatedBytes: value },
        csrfToken,
      });
      await loadQuotas();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Quota update failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="admin-shell">
      <style>{`
        .admin-shell {
          min-height: 100vh;
          padding: 48px 24px 80px;
          background: radial-gradient(circle at top, rgba(255, 217, 147, 0.3), transparent 55%),
            radial-gradient(circle at 80% 20%, rgba(90, 170, 255, 0.25), transparent 45%),
            #0c0c0c;
          color: #f5f0e8;
          font-family: "Gill Sans", "Trebuchet MS", sans-serif;
        }
        .panel {
          background: rgba(15, 15, 18, 0.88);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
          border-radius: 20px;
        }
        .brand-title {
          font-family: "Georgia", "Times New Roman", serif;
          letter-spacing: 0.02em;
        }
        .tab-button {
          transition: all 200ms ease;
        }
        .tab-button.active {
          background: #f5f0e8;
          color: #101010;
        }
        .fade-in {
          animation: fadeUp 450ms ease;
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <section className="max-w-6xl mx-auto">
        <header className="panel p-8 mb-6 fade-in">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-amber-200">Control Center</p>
              <h1 className="brand-title text-4xl md:text-5xl">EnderChest Admin</h1>
              <p className="text-slate-300 mt-2 max-w-xl">
                Manage users, invites, quotas, and audit trails from a single, focused command surface.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="panel p-3">
                <div className="text-2xl font-semibold">{stats.totalUsers}</div>
                <div className="text-xs text-slate-300">Users</div>
              </div>
              <div className="panel p-3">
                <div className="text-2xl font-semibold">{stats.admins}</div>
                <div className="text-xs text-slate-300">Admins</div>
              </div>
              <div className="panel p-3">
                <div className="text-2xl font-semibold">{stats.suspended}</div>
                <div className="text-xs text-slate-300">Suspended</div>
              </div>
            </div>
          </div>
        </header>

        <nav className="panel p-3 flex flex-wrap gap-3 mb-6 fade-in">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`tab-button px-4 py-2 rounded-full text-sm uppercase tracking-[0.2em] ${
                activeTab === tab ? "active" : "bg-transparent border border-white/10"
              }`}
            >
              {tab}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => {
                if (activeTab === "users") void loadUsers();
                if (activeTab === "invites") void loadInvites();
                if (activeTab === "quotas") void loadQuotas();
                if (activeTab === "audit") void loadAudit();
              }}
              className="px-4 py-2 text-sm rounded-full border border-white/10"
            >
              Refresh
            </button>
          </div>
        </nav>

        {error && (
          <div className="panel p-4 mb-6 border border-red-400/40 bg-red-500/10 text-red-100 fade-in">
            {error}
          </div>
        )}

        {loading && (
          <div className="panel p-4 mb-6 text-slate-300 fade-in">
            Loading...
          </div>
        )}

        {activeTab === "users" && (
          <section className="panel p-6 fade-in">
            <h2 className="text-xl font-semibold mb-4">Users</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-300">
                  <tr>
                    <th className="py-2">Email</th>
                    <th>Status</th>
                    <th>Admin</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-t border-white/10">
                      <td className="py-3 text-slate-100">{user.email}</td>
                      <td>{user.status}</td>
                      <td>{user.is_admin ? "Yes" : "No"}</td>
                      <td className="text-right space-x-2">
                        <button
                          className="px-3 py-1 text-xs rounded-full border border-white/10"
                          onClick={() =>
                            updateUser({
                              userIdToUpdate: user.id,
                              status: user.status === "active" ? "disabled" : "active",
                            })
                          }
                        >
                          {user.status === "active" ? "Suspend" : "Activate"}
                        </button>
                        <button
                          className="px-3 py-1 text-xs rounded-full border border-white/10"
                          onClick={() =>
                            updateUser({
                              userIdToUpdate: user.id,
                              isAdmin: !user.is_admin,
                            })
                          }
                        >
                          {user.is_admin ? "Remove Admin" : "Make Admin"}
                        </button>
                        <button
                          className="px-3 py-1 text-xs rounded-full border border-red-400/50 text-red-200"
                          onClick={() => deleteUser(user.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "invites" && (
          <section className="panel p-6 fade-in">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-xl font-semibold">Invites</h2>
                <p className="text-slate-300 text-sm">
                  Generate and manage invitation tokens for new users.
                </p>
              </div>
              <div className="flex gap-2">
                <input
                  value={inviteHours}
                  onChange={(event) => setInviteHours(event.target.value)}
                  type="number"
                  min={1}
                  className="bg-black/40 border border-white/10 rounded-full px-3 py-2 text-sm"
                  placeholder="Hours"
                />
                <button
                  className="px-4 py-2 rounded-full text-sm bg-amber-200 text-black"
                  onClick={createInvite}
                >
                  Create Invite
                </button>
              </div>
            </div>
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-300">
                  <tr>
                    <th className="py-2">Token</th>
                    <th>Expires</th>
                    <th>Used</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((invite) => {
                    const isUsed = Boolean(invite.used_at);
                    const isExpired = new Date(invite.expires_at) < new Date();
                    return (
                      <tr key={invite.id} className="border-t border-white/10">
                        <td className="py-3 text-slate-100">
                          <span className="font-mono text-xs">{invite.token.slice(0, 12)}...</span>
                        </td>
                        <td>{formatDate(invite.expires_at)}</td>
                        <td>{isUsed ? "Used" : isExpired ? "Expired" : "Open"}</td>
                        <td className="text-right space-x-2">
                          <button
                            className="px-3 py-1 text-xs rounded-full border border-white/10"
                            disabled={isUsed}
                            onClick={() => revokeInvite(invite.id)}
                          >
                            Revoke
                          </button>
                          <button
                            className="px-3 py-1 text-xs rounded-full border border-red-400/50 text-red-200"
                            disabled={isUsed}
                            onClick={() => deleteInvite(invite.id)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "quotas" && (
          <section className="panel p-6 fade-in">
            <h2 className="text-xl font-semibold mb-4">Quotas</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-300">
                  <tr>
                    <th className="py-2">User</th>
                    <th>Allocated</th>
                    <th>Used</th>
                    <th className="text-right">Update</th>
                  </tr>
                </thead>
                <tbody>
                  {quotas.map((quota) => (
                    <tr key={quota.user_id} className="border-t border-white/10">
                      <td className="py-3 text-slate-100">{quota.email}</td>
                      <td>{formatBytes(quota.allocated_bytes)}</td>
                      <td>{formatBytes(quota.used_bytes)}</td>
                      <td className="text-right">
                        <div className="flex justify-end gap-2">
                          <input
                            value={quotaDrafts[quota.user_id] ?? String(quota.allocated_bytes)}
                            onChange={(event) =>
                              setQuotaDrafts((prev) => ({
                                ...prev,
                                [quota.user_id]: event.target.value,
                              }))
                            }
                            className="bg-black/40 border border-white/10 rounded-full px-3 py-1 text-xs w-36"
                          />
                          <button
                            className="px-3 py-1 text-xs rounded-full border border-white/10"
                            onClick={() => updateQuota(quota.user_id)}
                          >
                            Save
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "audit" && (
          <section className="panel p-6 fade-in">
            <h2 className="text-xl font-semibold mb-4">Audit Log</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-300">
                  <tr>
                    <th className="py-2">Action</th>
                    <th>Entity</th>
                    <th>Actor</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="border-t border-white/10">
                      <td className="py-3 text-slate-100">{log.action}</td>
                      <td>{log.entity_type}</td>
                      <td className="text-xs text-slate-300">
                        {log.actor_user_id ?? "system"}
                      </td>
                      <td>{formatDate(log.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
