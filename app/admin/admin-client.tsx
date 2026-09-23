"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, HardDrive, RefreshCw, Search, Settings2, Trash2, UserPlus, Users, X } from "lucide-react";
import { api, formatBytes } from "@/app/lib/client-api";
import { invitationUrl } from "@/app/lib/public-url";
import ThemeToggle from "@/app/ui/theme-toggle";

type User = { id: string; email: string; status: "active" | "disabled"; is_admin: boolean };
type Invite = { id: string; token: string; used_at: string | null; expires_at: string; created_at: string };
type Quota = { user_id: string; email: string; allocated_bytes: string; used_bytes: string };
type Audit = { id: string; actor_user_id: string | null; action: string; entity_type: string; entity_id: string | null; created_at: string };
type Tab = "users" | "invites" | "quotas" | "audit";

const when = (value: string) => new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export default function AdminClient({ publicAppUrl }: { publicAppUrl: string | null }) {
  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<User[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [quotas, setQuotas] = useState<Quota[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [filter, setFilter] = useState("");
  const [hours, setHours] = useState("24");
  const [quotaDrafts, setQuotaDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (current: Tab) => {
    try {
      if (current === "users") setUsers(await api<User[]>("/api/admin/users"));
      if (current === "invites") setInvites(await api<Invite[]>("/api/admin/invite"));
      if (current === "quotas") { const rows = await api<Quota[]>("/api/admin/quotas"); setQuotas(rows); setQuotaDrafts(Object.fromEntries(rows.map(q => [q.user_id, String(Number(q.allocated_bytes) / 1024 ** 3)]))); }
      if (current === "audit") setAudit(await api<Audit[]>("/api/admin/audit?limit=500"));
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load data"); }
  }, []);
  useEffect(() => { void load(tab); }, [tab, load]);
  const displayedUsers = useMemo(() => users.filter(u => u.email.toLowerCase().includes(filter.toLowerCase())), [users, filter]);
  const displayedInvites = useMemo(() => invites.filter(i => i.token.toLowerCase().includes(filter.toLowerCase())), [invites, filter]);
  const displayedQuotas = useMemo(() => quotas.filter(q => q.email.toLowerCase().includes(filter.toLowerCase())), [quotas, filter]);
  const displayedAudit = useMemo(() => audit.filter(a => `${a.action} ${a.entity_type} ${a.actor_user_id ?? ""}`.toLowerCase().includes(filter.toLowerCase())), [audit, filter]);
  async function action(task: () => Promise<unknown>, success: string) {
    setBusy(true); setError(""); setNotice("");
    try { await task(); setNotice(success); await load(tab); }
    catch (err) { setError(err instanceof Error ? err.message : "Action failed"); }
    finally { setBusy(false); }
  }
  function createInvite() { void action(() => api("/api/admin/invite", { method: "POST", body: JSON.stringify({ expiresInHours: Number(hours) }) }), "Invite created"); }
  function copyInvite(invite: Invite) { const value = publicAppUrl ? invitationUrl(publicAppUrl, invite.token) : invite.token; void navigator.clipboard.writeText(value).then(() => setNotice(publicAppUrl ? "Invitation link copied" : "Invitation code copied")).catch(() => setError("Could not copy invitation")); }
  function updateUser(user: User, field: "status" | "role") { const next = field === "status" ? { status: user.status === "active" ? "disabled" : "active" } : { isAdmin: !user.is_admin }; void action(() => api("/api/admin/users", { method: "PATCH", body: JSON.stringify({ userIdToUpdate: user.id, ...next }) }), "User updated"); }
  function deleteUser(user: User) { if (!confirm(`Delete ${user.email} and all their files permanently?`)) return; void action(() => api("/api/admin/users", { method: "DELETE", body: JSON.stringify({ userIdToDelete: user.id }) }), "User deleted"); }
  function updateQuota(quota: Quota) { const gb = Number(quotaDrafts[quota.user_id]); const bytes = Math.round(gb * 1024 ** 3); if (!Number.isSafeInteger(bytes) || bytes < 0) { setError("Enter a valid quota in GB"); return; } void action(() => api("/api/admin/quotas", { method: "PATCH", body: JSON.stringify({ userId: quota.user_id, allocatedBytes: bytes }) }), "Quota updated"); }
  const tabs: { id: Tab; label: string }[] = [{ id: "users", label: "Users" }, { id: "invites", label: "Invitations" }, { id: "quotas", label: "Storage limits" }, { id: "audit", label: "Activity" }];

  return <div className="admin-app"><aside className="admin-sidebar"><Link className="brand" href="/"><img className="brand-mark" src="/enderchest-mark.png" alt="" width={30} height={30}/><span>EnderChest</span></Link><div className="admin-side-label">Administration</div><nav className="side-nav" aria-label="Administration">{tabs.map(t => <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => { setTab(t.id); setFilter(""); }}>{t.id === "users" ? <Users size={18}/> : t.id === "invites" ? <UserPlus size={18}/> : t.id === "quotas" ? <HardDrive size={18}/> : <Settings2 size={18}/>} {t.label}</button>)}</nav><Link className="admin-back" href="/"><ArrowLeft size={17}/> Back to files</Link></aside>
    <div className="admin-main"><header className="admin-top"><span>Administration</span><div className="top-actions"><ThemeToggle/><button className="icon-button" title="Refresh" onClick={() => void load(tab)}><RefreshCw size={18}/></button></div></header><main className="admin-content"><div className="admin-heading"><div><h1>{tabs.find(t => t.id === tab)?.label}</h1><p>{tab === "users" ? "Manage who can access this server." : tab === "invites" ? "Invite people to create an account." : tab === "quotas" ? "Set how much storage each user can use." : "Recent administrative activity."}</p></div>{tab === "invites" && <div className="admin-create"><label>Expires in <input type="number" min="1" max="720" value={hours} onChange={e => setHours(e.target.value)}/> hours</label><button className="primary-button" onClick={createInvite} disabled={busy}><UserPlus size={17}/> New invitation</button></div>}</div>
      {error && <div className="alert error" role="alert"><span>{error}</span><button title="Dismiss" onClick={() => setError("")}><X size={16}/></button></div>}{notice && <div className="alert success" role="status"><Check size={16}/><span>{notice}</span><button title="Dismiss" onClick={() => setNotice("")}><X size={16}/></button></div>}
      {tab === "invites" && <p className="admin-instance-url">{publicAppUrl ? <>Invitation address: <a href={publicAppUrl} target="_blank" rel="noopener noreferrer">{publicAppUrl}</a></> : "Local-only setup. Copy an invitation code for local registration; configure a public HTTPS address for remote links."}</p>}
      <div className="admin-toolbar"><div className="search-wrap"><Search size={17}/><input aria-label="Filter rows" placeholder={`Search ${tabs.find(t => t.id === tab)?.label.toLowerCase()}`} value={filter} onChange={e => setFilter(e.target.value)}/></div><span>{tab === "users" ? displayedUsers.length : tab === "invites" ? displayedInvites.length : tab === "quotas" ? displayedQuotas.length : displayedAudit.length} items</span></div>
      <div className="admin-table-wrap"><table className={`admin-table ${tab}`}><thead>{tab === "users" ? <tr><th>Email</th><th>Status</th><th>Role</th><th>Actions</th></tr> : tab === "invites" ? <tr><th>Invitation</th><th>Expires</th><th>Status</th><th>Actions</th></tr> : tab === "quotas" ? <tr><th>User</th><th>Used</th><th>Limit</th><th>Change limit</th></tr> : <tr><th>Action</th><th>Type</th><th>Actor</th><th>Time</th></tr>}</thead><tbody>
        {tab === "users" && displayedUsers.map(user => <tr key={user.id}><td className="strong-cell">{user.email}</td><td><span className={`status ${user.status}`}>{user.status}</span></td><td>{user.is_admin ? "Admin" : "User"}</td><td className="table-actions"><button disabled={busy} onClick={() => updateUser(user, "status")}>{user.status === "active" ? "Suspend" : "Activate"}</button><button disabled={busy} onClick={() => updateUser(user, "role")}>{user.is_admin ? "Remove admin" : "Make admin"}</button><button className="red-text" title="Delete user" disabled={busy} onClick={() => deleteUser(user)}><Trash2 size={16}/></button></td></tr>)}
        {tab === "invites" && displayedInvites.map(invite => { const state = invite.used_at ? "Used" : new Date(invite.expires_at) <= new Date() ? "Expired" : "Open"; return <tr key={invite.id}><td className="strong-cell mono">{invite.token.slice(0, 16)}...</td><td>{when(invite.expires_at)}</td><td><span className={`status ${state.toLowerCase()}`}>{state}</span></td><td className="table-actions"><button title={publicAppUrl ? "Copy invitation link" : "Copy invitation code"} disabled={state !== "Open"} onClick={() => copyInvite(invite)}><Copy size={16}/> {publicAppUrl ? "Copy link" : "Copy code"}</button><button disabled={busy || state !== "Open"} onClick={() => void action(() => api("/api/admin/invite", { method: "PATCH", body: JSON.stringify({ inviteId: invite.id }) }), "Invite revoked")}>Revoke</button><button className="red-text" title="Delete invite" disabled={busy || state === "Used"} onClick={() => void action(() => api("/api/admin/invite", { method: "DELETE", body: JSON.stringify({ inviteId: invite.id }) }), "Invite deleted")}><Trash2 size={16}/></button></td></tr>; })}
        {tab === "quotas" && displayedQuotas.map(q => <tr key={q.user_id}><td className="strong-cell">{q.email}</td><td>{formatBytes(q.used_bytes)}</td><td>{formatBytes(q.allocated_bytes)}</td><td className="table-actions"><input className="quota-input" type="number" min="0" step="0.1" aria-label={`Quota for ${q.email} in GB`} value={quotaDrafts[q.user_id] ?? ""} onChange={e => setQuotaDrafts(previous => ({ ...previous, [q.user_id]: e.target.value }))}/><span>GB</span><button disabled={busy} onClick={() => updateQuota(q)}>Save</button></td></tr>)}
        {tab === "audit" && displayedAudit.map(a => <tr key={a.id}><td className="strong-cell">{a.action}</td><td>{a.entity_type}</td><td className="mono">{a.actor_user_id?.slice(0, 8) ?? "System"}</td><td>{when(a.created_at)}</td></tr>)}
      </tbody></table>{(tab === "users" ? displayedUsers.length : tab === "invites" ? displayedInvites.length : tab === "quotas" ? displayedQuotas.length : displayedAudit.length) === 0 && <div className="admin-empty">No records found.</div>}</div>
    </main></div></div>;
}
