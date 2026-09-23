"use client";
import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, HardDrive, LogOut, ShieldCheck } from "lucide-react";
import { api, formatBytes } from "@/app/lib/client-api";
import ThemeToggle from "@/app/ui/theme-toggle";

export default function SettingsClient() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [used, setUsed] = useState("0"), [limit, setLimit] = useState("0");
  const [currentPassword, setCurrentPassword] = useState(""), [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { void Promise.all([api<{ user: { email: string } }>("/api/auth/me"), api<{ quota: { used_bytes: string; allocated_bytes: string } }>("/api/library")]).then(([user, data]) => { setEmail(user.user.email); setUsed(data.quota.used_bytes); setLimit(data.quota.allocated_bytes); }).catch(err => setError(String(err))); }, []);
  async function password(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await api("/api/auth/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }); router.push("/login"); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : "Could not change password"); } finally { setBusy(false); } }
  async function signOutAll() { setBusy(true); setError(""); try { await api("/api/auth/logout-all", { method: "POST" }); router.push("/login"); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : "Could not sign out"); } finally { setBusy(false); } }
  return <main className="settings-page"><header><Link className="brand" href="/"><img className="brand-mark" src="/enderchest-mark.png" alt="" width={30} height={30}/><span>EnderChest</span></Link><div className="top-actions"><ThemeToggle/><Link className="settings-back" href="/"><ArrowLeft size={17}/> Back to files</Link></div></header><div className="settings-content"><h1>Account settings</h1><section><h2>Account</h2><div className="settings-line"><span>Email address</span><strong>{email}</strong></div><div className="settings-line"><span>Storage used</span><strong>{formatBytes(used)} of {formatBytes(limit)}</strong></div></section><section><h2><ShieldCheck size={18}/> Security</h2><form onSubmit={password} className="settings-form"><label>Current password<input type="password" autoComplete="current-password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}/></label><label>New password<input type="password" autoComplete="new-password" required minLength={12} value={newPassword} onChange={e => setNewPassword(e.target.value)}/></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy}>Change password</button></form></section><section><h2>Sessions</h2><p>Sign out on every device connected to your account.</p><button className="secondary-button" disabled={busy} onClick={signOutAll}><LogOut size={16}/> Sign out everywhere</button></section></div></main>;
}
