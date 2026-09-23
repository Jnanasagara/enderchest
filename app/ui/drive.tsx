"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, csrfToken, formatBytes } from "@/app/lib/client-api";
import ThemeToggle from "@/app/ui/theme-toggle";
import { ArrowLeft, ArrowUp, Check, ChevronRight, Clock3, Download, File, FileImage, FileText, Folder, FolderPlus, HardDrive, LogOut, Menu, MoreHorizontal, RefreshCw, Search, Settings2, Trash2, Upload, X } from "lucide-react";

type Folder = { id: string; name: string; parent_id?: string; updated_at?: string; deleted_at?: string };
type DriveFile = { id: string; name: string; size: number; mimeType?: string; mime_type?: string; updatedAt?: string; updated_at?: string; folder_id?: string; deleted_at?: string; downloadUrl?: string };
type FolderList = { path: Folder[]; folders: Folder[]; files: DriveFile[] };
type Library = { quota: { allocated_bytes: string; used_bytes: string }; folders: Folder[]; files: DriveFile[] };
type TreeFolder = Folder & { parent_id: string | null };
type Item = { kind: "file" | "folder"; id: string; name: string; file?: DriveFile; folder?: Folder };
type Modal = { type: "create" | "rename" | "move" | "copy" | "preview" | "delete" | "purge"; item?: Item } | null;

function date(value?: string) { return value ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)) : "--"; }
function fileIcon(file: DriveFile) { const mime = file.mimeType || file.mime_type || ""; return mime.startsWith("image/") ? FileImage : mime === "application/pdf" || mime.startsWith("text/") ? FileText : File; }
function previewable(file: DriveFile) { const mime = file.mimeType || file.mime_type || ""; return mime === "application/pdf" || mime === "text/plain" || /^image\/(png|jpeg|gif|webp)$/.test(mime); }

export default function Drive() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const refreshId = useRef(0);
  const [view, setView] = useState<"drive" | "recent" | "trash">("drive");
  const [rootId, setRootId] = useState("");
  const [folderId, setFolderId] = useState("");
  const [listing, setListing] = useState<FolderList>({ path: [], folders: [], files: [] });
  const [library, setLibrary] = useState<Library>({ quota: { allocated_bytes: "0", used_bytes: "0" }, folders: [], files: [] });
  const [trash, setTrash] = useState<{ folders: Folder[]; files: DriveFile[] }>({ folders: [], files: [] });
  const [tree, setTree] = useState<TreeFolder[]>([]);
  const [email, setEmail] = useState("");
  const [admin, setAdmin] = useState(false);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [draft, setDraft] = useState("");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [sort, setSort] = useState<"name" | "date" | "size">("name");

  const refresh = useCallback(async (currentFolder: string, currentView: string, query = "") => {
    const requestId = ++refreshId.current;
    try {
      const [nextLibrary, nextListing, nextTrash] = await Promise.all([
        api<Library>(`/api/library?q=${encodeURIComponent(query)}`),
        currentFolder ? api<FolderList>(`/api/folders?parentId=${currentFolder}`) : Promise.resolve(null),
        currentView === "trash" ? api<{ folders: Folder[]; files: DriveFile[] }>("/api/trash") : Promise.resolve(null),
      ]);
      if (requestId !== refreshId.current) return;
      setLibrary(nextLibrary);
      if (nextListing) setListing(nextListing);
      if (nextTrash) setTrash(nextTrash);
    } catch (err) { if (requestId === refreshId.current) setError(err instanceof Error ? err.message : "Could not load files"); }
    finally { if (requestId === refreshId.current) setLoading(false); }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([api<{ user: { email: string; is_admin: boolean } | null }>("/api/auth/me"), api<Folder>("/api/folders/root")])
      .then(([me, root]) => { if (!active) return; if (!me.user) { router.push("/login"); return; } setEmail(me.user.email); setAdmin(me.user.is_admin); setRootId(root.id); setFolderId(root.id); })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : "Could not open drive"); });
    return () => { active = false; };
  }, [router]);

  useEffect(() => { if (folderId) void refresh(folderId, view, search); }, [folderId, view, search, refresh]);

  async function mutate(action: () => Promise<unknown>, message: string) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); setModal(null); setNotice(message); await refresh(folderId, view, search); }
    catch (err) { setError(err instanceof Error ? err.message : "Action failed"); }
    finally { setBusy(false); }
  }

  async function uploadFiles(files: FileList | File[]) {
    if (!folderId) return;
    setBusy(true); setError(""); setNotice("");
    let uploaded = 0;
    try {
      for (const file of Array.from(files)) {
        const body = new FormData(); body.set("file", file); body.set("folderId", folderId);
        setProgress(0);
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/upload");
          xhr.withCredentials = true;
          xhr.setRequestHeader("x-csrf-token", csrfToken());
          xhr.upload.onprogress = event => { if (event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100)); };
          xhr.onerror = () => reject(new Error("Network error during upload"));
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) return resolve();
            let message = "Upload failed";
            try { message = JSON.parse(xhr.responseText).error || message; } catch { /* Non-JSON gateway errors. */ }
            reject(new Error(message));
          };
          xhr.send(body);
        });
        uploaded++;
      }
      setNotice(`${uploaded} file${uploaded === 1 ? "" : "s"} uploaded`);
    } catch (err) { setError(`${uploaded} uploaded. ${err instanceof Error ? err.message : "Upload failed"}`); }
    finally { setBusy(false); setProgress(null); await refresh(folderId, view, search); if (fileInput.current) fileInput.current.value = ""; }
  }

  function switchView(next: typeof view) { setView(next); setSearch(""); setMobileNav(false); setError(""); }
  function openFolder(id: string) { setView("drive"); setSearch(""); setFolderId(id); }
  function openModal(type: NonNullable<Modal>["type"], item?: Item) { setModal({ type, item }); setDraft(type === "copy" ? `Copy of ${item?.name ?? ""}` : item?.name ?? ""); setDestination(folderId); setError(""); if (type === "move" || type === "copy") void api<TreeFolder[]>("/api/folder-tree").then(setTree).catch(err => setError(String(err))); }
  function itemUrl(item: Item) { return item.kind === "file" ? `/api/files/${item.id}` : `/api/folders/${item.id}`; }
  function download(file: DriveFile) { window.location.href = `/api/files/${file.id}/download`; }
  function submitModal() {
    if (!modal) return;
    const item = modal.item;
    if (modal.type === "create") return void mutate(() => api("/api/folders", { method: "POST", body: JSON.stringify({ name: draft, parentId: folderId }) }), "Folder created");
    if (!item) return;
    if (modal.type === "rename") return void mutate(() => api(itemUrl(item), { method: "PATCH", body: JSON.stringify({ name: draft }) }), "Renamed");
    if (modal.type === "move") return void mutate(() => api(itemUrl(item), { method: "PATCH", body: JSON.stringify(item.kind === "file" ? { folderId: destination } : { parentId: destination }) }), "Moved");
    if (modal.type === "copy" && item.kind === "file") return void mutate(() => api(`/api/files/${item.id}/copy`, { method: "POST", body: JSON.stringify({ name: draft, folderId: destination }) }), "File copied");
    if (modal.type === "delete") return void mutate(() => api(itemUrl(item), { method: "DELETE" }), "Moved to trash");
    if (modal.type === "purge") return void mutate(() => api(`/api/trash/${item.kind}/${item.id}`, { method: "DELETE" }), "Permanently deleted");
  }
  function onDrop(event: DragEvent) { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length) void uploadFiles(event.dataTransfer.files); }
  function onFileChange(event: ChangeEvent<HTMLInputElement>) { if (event.target.files?.length) void uploadFiles(event.target.files); }

  const hasSearch = search.trim().length > 0;
  const foldersRaw = view === "trash" ? trash.folders.filter(f => f.name.toLowerCase().includes(search.toLowerCase())) : hasSearch ? library.folders : view === "drive" ? listing.folders : [];
  const filesRaw = view === "trash" ? trash.files.filter(f => f.name.toLowerCase().includes(search.toLowerCase())) : hasSearch || view === "recent" ? library.files : listing.files;
  const folders = [...foldersRaw].sort((a, b) => sort === "date" ? new Date(b.updated_at || b.deleted_at || 0).getTime() - new Date(a.updated_at || a.deleted_at || 0).getTime() : a.name.localeCompare(b.name));
  const files = [...filesRaw].sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "size" ? b.size - a.size : new Date(b.updatedAt || b.updated_at || b.deleted_at || 0).getTime() - new Date(a.updatedAt || a.updated_at || a.deleted_at || 0).getTime());
  const quotaUsed = Number(library.quota.used_bytes), quotaTotal = Number(library.quota.allocated_bytes);

  return <div className="drive-app" onDragEnter={e => { if (e.dataTransfer.types.includes("Files")) setDragging(true); }}>
    {dragging && <div className="drop-zone" onDragOver={e => e.preventDefault()} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }} onDrop={onDrop}>Drop files to upload</div>}
    <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
      <div className="brand"><img className="brand-mark" src="/enderchest-mark.png" alt="" width={30} height={30}/><span>EnderChest</span><button className="icon-button mobile-close" title="Close menu" onClick={() => setMobileNav(false)}><X size={19}/></button></div>
      <button className="new-button" onClick={() => fileInput.current?.click()} disabled={busy}><Upload size={18}/> Upload files</button>
      <nav className="side-nav" aria-label="Main navigation">
        <button className={view === "drive" ? "active" : ""} onClick={() => switchView("drive")}><Folder size={18}/> My files</button>
        <button className={view === "recent" ? "active" : ""} onClick={() => switchView("recent")}><Clock3 size={18}/> Recent</button>
        <button className={view === "trash" ? "active" : ""} onClick={() => switchView("trash")}><Trash2 size={18}/> Trash</button>
      </nav>
      <div className="sidebar-bottom">
        <div className="storage-label"><span>Storage</span><span>{formatBytes(quotaUsed)} of {formatBytes(quotaTotal)}</span></div>
        <div className="storage-track"><div style={{ width: `${quotaTotal ? Math.min(100, quotaUsed / quotaTotal * 100) : 0}%` }} /></div>
        <Link className="side-link" href="/settings"><Settings2 size={18}/> Settings</Link>
        {admin && <Link className="side-link" href="/admin"><Settings2 size={18}/> Administration</Link>}
        <div className="account"><div className="avatar">{email[0]?.toUpperCase() || "E"}</div><span title={email}>{email}</span><button className="icon-button" title="Sign out" onClick={() => void mutate(() => api("/api/auth/logout", { method: "POST" }).then(() => { router.push("/login"); router.refresh(); }), "Signed out")}><LogOut size={17}/></button></div>
      </div>
    </aside>
    <div className="drive-main">
      <header className="topbar"><button className="icon-button menu-button" title="Open menu" onClick={() => setMobileNav(true)}><Menu size={21}/></button><div className="search-wrap"><Search size={18}/><input aria-label="Search files" placeholder="Search files and folders" value={search} onChange={e => setSearch(e.target.value)} />{search && <button className="icon-button" title="Clear search" onClick={() => setSearch("")}><X size={16}/></button>}</div><div className="top-actions"><ThemeToggle/><button className="icon-button" title="Refresh" onClick={() => void refresh(folderId, view, search)}><RefreshCw size={18}/></button><div className="avatar top-avatar" title={email}>{email[0]?.toUpperCase() || "E"}</div></div></header>
      <main className="content">
        <div className="content-head"><div><h1>{hasSearch ? "Search results" : view === "drive" ? "My files" : view === "recent" ? "Recent" : "Trash"}</h1>{view === "drive" && !hasSearch && <div className="breadcrumbs">{listing.path.map((part, i) => <span key={part.id}><button onClick={() => openFolder(part.id)}>{i === 0 ? "My files" : part.name}</button>{i < listing.path.length - 1 && <ChevronRight size={15}/>}</span>)}</div>}</div><div className="head-actions">{view === "drive" && !hasSearch && <><button className="secondary-button" onClick={() => openModal("create")}><FolderPlus size={17}/> New folder</button><button className="primary-button" onClick={() => fileInput.current?.click()} disabled={busy}><Upload size={17}/> Upload</button></>}</div></div>
        {error && <div className="alert error" role="alert"><span>{error}</span><button title="Dismiss" onClick={() => setError("")}><X size={16}/></button></div>}
        {notice && <div className="alert success" role="status"><Check size={16}/><span>{notice}</span><button title="Dismiss" onClick={() => setNotice("")}><X size={16}/></button></div>}
        {progress !== null && <div className="upload-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span>Uploading {progress}%</span><div><i style={{ width: `${progress}%` }}/></div></div>}
        <div className="sort-bar"><label>Sort by <select value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="name">Name</option><option value="date">Modified</option><option value="size">Size</option></select></label></div>
        {view === "drive" && !hasSearch && folderId !== rootId && <button className="back-link" onClick={() => openFolder(listing.path.at(-2)?.id || rootId)}><ArrowLeft size={16}/> Back</button>}
        <div className="file-list"><div className="list-head"><span>Name</span><span>Modified</span><span>File size</span><span></span></div>
          {loading ? <div className="empty-state">Loading files...</div> : folders.length + files.length === 0 ? <div className="empty-state"><Folder size={34} strokeWidth={1.4}/><h2>{view === "trash" ? "Trash is empty" : hasSearch ? "No matches found" : view === "recent" ? "No recent files" : "This folder is empty"}</h2><p>{view === "drive" ? "Upload a file or create a folder to get started." : ""}</p></div> : <>
            {folders.map(folder => { const item: Item = { kind: "folder", id: folder.id, name: folder.name, folder }; return <div className="file-row" key={folder.id}><button className="file-name" onClick={() => view === "trash" ? undefined : openFolder(folder.id)}><span className="file-symbol folder-symbol"><Folder size={19} fill="currentColor" strokeWidth={1.5}/></span><span>{folder.name}</span></button><span className="row-muted">{date(folder.deleted_at || folder.updated_at)}</span><span className="row-muted">--</span><div className="row-actions">{view === "trash" ? <><button className="icon-button" title="Restore folder" onClick={() => void mutate(() => api(`/api/trash/folder/${folder.id}`, { method: "POST" }), "Folder restored")}><ArrowUp size={18}/></button><button className="icon-button danger" title="Delete permanently" onClick={() => openModal("purge", item)}><Trash2 size={18}/></button></> : <details className="item-menu"><summary title="Folder actions"><MoreHorizontal size={19}/></summary><div className="popover"><button onClick={() => openModal("rename", item)}>Rename</button><button onClick={() => openModal("move", item)}>Move</button><button onClick={() => openModal("delete", item)}>Move to trash</button></div></details>}</div></div>; })}
            {files.map(file => { const Icon = fileIcon(file); const item: Item = { kind: "file", id: file.id, name: file.name, file }; return <div className="file-row" key={file.id}><button className="file-name" onClick={() => view === "trash" ? undefined : previewable(file) ? openModal("preview", item) : download(file)}><span className="file-symbol"><Icon size={19}/></span><span>{file.name}</span></button><span className="row-muted">{date(file.deleted_at || file.updatedAt || file.updated_at)}</span><span className="row-muted">{formatBytes(file.size)}</span><div className="row-actions">{view === "trash" ? <><button className="icon-button" title="Restore file" onClick={() => void mutate(() => api(`/api/trash/file/${file.id}`, { method: "POST" }), "File restored")}><ArrowUp size={18}/></button><button className="icon-button danger" title="Delete permanently" onClick={() => openModal("purge", item)}><Trash2 size={18}/></button></> : <><button className="icon-button" title="Download" onClick={() => download(file)}><Download size={17}/></button><details className="item-menu"><summary title="File actions"><MoreHorizontal size={19}/></summary><div className="popover"><button onClick={() => openModal("rename", item)}>Rename</button><button onClick={() => openModal("move", item)}>Move</button><button onClick={() => openModal("copy", item)}>Make a copy</button><button onClick={() => openModal("delete", item)}>Move to trash</button></div></details></>}</div></div>; })}
          </>}
        </div>
      </main>
    </div>
    <input ref={fileInput} className="visually-hidden" type="file" multiple onChange={onFileChange} />
    {modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setModal(null); }}><div className={`dialog ${modal.type === "preview" ? "preview-dialog" : ""}`} role="dialog" aria-modal="true" aria-label={modal.type}><div className="dialog-head"><h2>{modal.type === "create" ? "New folder" : modal.type === "rename" ? "Rename" : modal.type === "move" ? "Move to" : modal.type === "copy" ? "Make a copy" : modal.type === "delete" ? "Move to trash?" : modal.type === "purge" ? "Delete permanently?" : modal.item?.name}</h2><button className="icon-button" title="Close" onClick={() => setModal(null)}><X size={19}/></button></div>
      {modal.type === "preview" && modal.item?.file ? <><div className="preview-content"><iframe title={modal.item.name} src={`/api/files/${modal.item.id}/download?inline=1`} /></div><div className="dialog-actions"><button className="secondary-button" onClick={() => download(modal.item!.file!)}><Download size={17}/> Download</button></div></> : <>
      {error && <div className="alert error" role="alert">{error}</div>}
      {(modal.type === "create" || modal.type === "rename" || modal.type === "copy") && <input className="dialog-input" autoFocus value={draft} maxLength={255} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") submitModal(); }} aria-label="Name" />}
      {(modal.type === "move" || modal.type === "copy") && <select className="dialog-input" value={destination} onChange={e => setDestination(e.target.value)} aria-label="Destination folder">{tree.filter(f => f.id !== modal.item?.id).map(f => { const names = [f.name]; let parent = f.parent_id; for (let i = 0; parent && i < 20; i++) { const found = tree.find(x => x.id === parent); if (!found) break; names.unshift(found.parent_id ? found.name : "My files"); parent = found.parent_id; } return <option key={f.id} value={f.id}>{f.parent_id === null ? "My files" : names.join(" / ")}</option>; })}</select>}
      {(modal.type === "delete" || modal.type === "purge") && <p className="dialog-copy">{modal.type === "purge" ? `Delete “${modal.item?.name}” and its contents permanently? This cannot be undone.` : `Move “${modal.item?.name}” to trash?`}</p>}
      <div className="dialog-actions"><button className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className={modal.type === "purge" ? "danger-button" : "primary-button"} disabled={busy || ((modal.type === "create" || modal.type === "rename" || modal.type === "copy") && !draft.trim())} onClick={submitModal}>{busy ? "Please wait..." : modal.type === "create" ? "Create" : modal.type === "rename" ? "Save" : modal.type === "move" ? "Move" : modal.type === "copy" ? "Copy" : modal.type === "delete" ? "Move to trash" : "Delete permanently"}</button></div></>}
    </div></div>}
  </div>;
}
