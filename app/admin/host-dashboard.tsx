"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, CheckCircle2, CircleHelp, Database, ExternalLink, Globe2, HardDrive, RefreshCw, Server, TriangleAlert } from "lucide-react";
import { api, formatBytes } from "@/app/lib/client-api";

type HostStatus = {
  checkedAt: string;
  services: { app: "healthy"; database: "healthy"; garage: "healthy" | "unhealthy" };
  disk: { status: "ok" | "unavailable"; totalBytes: string | null; availableBytes: string | null };
  backup: { status: "found" | "none" | "unavailable"; lastCompletedAt: string | null };
};
type Reachability = "checking" | "reachable" | "unreachable" | "local";

function timestamp(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function indicator(state: "ok" | "warning" | "unknown", label: string) {
  const Icon = state === "ok" ? CheckCircle2 : state === "warning" ? TriangleAlert : CircleHelp;
  return <span className={`host-indicator ${state}`}><Icon size={16} aria-hidden="true"/>{label}</span>;
}

export default function HostDashboard({ publicAppUrl, refreshSignal }: { publicAppUrl: string | null; refreshSignal: number }) {
  const [status, setStatus] = useState<HostStatus | null>(null);
  const [error, setError] = useState("");
  const [reachability, setReachability] = useState<Reachability>(publicAppUrl ? "checking" : "local");

  const refresh = useCallback(async () => {
    try {
      const result = await api<HostStatus>("/api/admin/host");
      setStatus(result);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load host status");
    }
    if (!publicAppUrl) { setReachability("local"); return; }
    setReachability("checking");
    try {
      const response = await fetch(`${publicAppUrl}/api/host/ping`, {
        credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(8000),
      });
      const body = response.ok ? await response.json() as { ok?: boolean } : null;
      setReachability(body?.ok === true ? "reachable" : "unreachable");
    } catch { setReachability("unreachable"); }
  }, [publicAppUrl]);

  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 60000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [refresh, refreshSignal]);

  const disk = status?.disk;
  const total = disk?.totalBytes ? Number(disk.totalBytes) : 0;
  const available = disk?.availableBytes ? Number(disk.availableBytes) : 0;
  const usedPercent = total > 0 ? Math.min(100, Math.max(0, ((total - available) / total) * 100)) : 0;
  const backupTime = status?.backup.lastCompletedAt;
  const backupOld = backupTime && status ? new Date(status.checkedAt).getTime() - new Date(backupTime).getTime() > 7 * 86400000 : false;

  return <div className="host-dashboard">
    <div className="host-snapshot"><span>Instance status</span><div><span>{status ? `Checked ${timestamp(status.checkedAt)}` : "Checking..."}</span><button className="icon-button" title="Refresh host status" aria-label="Refresh host status" onClick={() => void refresh()}><RefreshCw size={16}/></button></div></div>
    {error && <div className="alert error" role="alert">Status refresh failed: {error}. Showing the last available snapshot.</div>}
    <section className="host-section" aria-labelledby="host-services"><h2 id="host-services">Services</h2><div className="host-rows">
      <div className="host-row"><span className="host-row-name"><Server size={17}/> Web app</span>{status ? indicator("ok", "Online") : indicator("unknown", "Checking")}</div>
      <div className="host-row"><span className="host-row-name"><Database size={17}/> Database</span>{status ? indicator("ok", "Connected") : indicator("unknown", "Checking")}</div>
      <div className="host-row"><span className="host-row-name"><HardDrive size={17}/> Object storage</span>{status ? indicator(status.services.garage === "healthy" ? "ok" : "warning", status.services.garage === "healthy" ? "Connected" : "Unavailable") : indicator("unknown", "Checking")}</div>
    </div></section>
    <section className="host-section" aria-labelledby="host-capacity"><h2 id="host-capacity">Storage disk</h2><div className="host-detail-row">
      <div><strong>{disk?.status === "ok" ? `${formatBytes(disk.availableBytes ?? "0")} free` : "Unavailable"}</strong><p>{disk?.status === "ok" ? `of ${formatBytes(disk.totalBytes ?? "0")} on the object storage disk` : "Disk metrics are not available in this installation."}</p></div>
      {disk?.status === "ok" && <span className="host-disk-percent">{Math.round(usedPercent)}% used</span>}
    </div>{disk?.status === "ok" && <div className="host-capacity-track" role="progressbar" aria-label="Storage disk used" aria-valuenow={Math.round(usedPercent)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${usedPercent}%` }}/></div>}
    <p className="host-footnote">This is the disk holding file objects, not individual user quotas.</p></section>
    <section className="host-section" aria-labelledby="host-backups"><h2 id="host-backups">Backups</h2><div className="host-detail-row">
      <div className="host-row-name"><Archive size={18}/><div><strong>{backupTime ? `Last complete: ${timestamp(backupTime)}` : status?.backup.status === "none" ? "No completed backup found" : "Backup status unavailable"}</strong><p>{backupTime ? "Local backup completion marker" : "Run the full backup script to create a recoverable copy."}</p></div></div>
      {backupTime ? indicator(backupOld ? "warning" : "ok", backupOld ? "Older than 7 days" : "Recent") : indicator(status?.backup.status === "none" ? "warning" : "unknown", status?.backup.status === "none" ? "Action needed" : "Unknown")}
    </div><p className="host-footnote">Only completed local backups appear here. Keep another copy off this machine.</p></section>
    <section className="host-section" aria-labelledby="host-address"><h2 id="host-address">Public address</h2><div className="host-detail-row">
      <div className="host-row-name"><Globe2 size={18}/><div><strong className="host-address-value">{publicAppUrl ? <a href={publicAppUrl} target="_blank" rel="noopener noreferrer">{publicAppUrl} <ExternalLink size={14} aria-hidden="true"/></a> : "Not configured"}</strong><p>{publicAppUrl ? "Reachability from this browser" : "Configure a public HTTPS address to share remote invitations."}</p></div></div>
      {indicator(reachability === "reachable" ? "ok" : reachability === "unreachable" ? "warning" : "unknown", reachability === "reachable" ? "Reachable" : reachability === "unreachable" ? "Could not reach" : reachability === "checking" ? "Checking" : "Local only")}
    </div>{publicAppUrl && <p className="host-footnote">For an outside-network check, open the address on a phone using mobile data.</p>}</section>
  </div>;
}
