"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HardDrive, ArrowRight } from "lucide-react";
import { api } from "@/app/lib/client-api";
import ThemeToggle from "@/app/ui/theme-toggle";

export default function AuthForm({ mode, initialInvite = "" }: { mode: "login" | "register"; initialInvite?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteToken, setInviteToken] = useState(initialInvite);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      if (mode === "register") await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password, inviteToken }) });
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      router.push("/");
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not sign in"); }
    finally { setPending(false); }
  }

  return <main className="auth-page">
    <div className="auth-header"><div className="brand"><img className="brand-mark" src="/enderchest-mark.png" alt="" width={30} height={30}/><span>EnderChest</span></div><ThemeToggle/></div>
    <div className="auth-box">
      <h1>{mode === "login" ? "Sign in" : "Create your account"}</h1>
      <p className="auth-subtitle">{mode === "login" ? "Access your private files." : "Use the invitation from your administrator."}</p>
      <form onSubmit={submit} className="auth-form">
        <label>Email address<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label>
        <label>Password<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 12 : undefined} value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" /></label>
        {mode === "register" && <label>Invitation code<input required value={inviteToken} onChange={e => setInviteToken(e.target.value)} placeholder="Paste invitation code" /></label>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button auth-submit" disabled={pending}>{pending ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}<ArrowRight size={17}/></button>
      </form>
      <p className="auth-switch">{mode === "login" ? <>Have an invitation? <Link href="/register">Create an account</Link></> : <>Already have an account? <Link href="/login">Sign in</Link></>}</p>
    </div>
    <p className="auth-foot">Private storage, on your server.</p>
  </main>;
}
