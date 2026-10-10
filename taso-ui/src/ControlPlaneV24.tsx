import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';

type Role = { id: string; name: string; description: string; permissions: string[]; system: boolean };
type User = { id: string; email: string; displayName: string; roleIds: string[]; active: boolean; owner: boolean; lastLoginAt?: string };
type TrustedDevice = { id: string; label: string; userAgent?: string; createdAt: string; expiresAt: string; lastUsedAt?: string; revokedAt?: string };
type Branding = { assistantName: string; assistantSubtitle: string; iconDataUrl?: string; lightIconDataUrl?: string; animationPreset: string; updatedAt: string };
type Me = { user: User; permissions: string[]; roles: Role[] };

const API_URL = ((import.meta.env.VITE_TASO_API_URL as string | undefined) || '/api').replace(/\/$/, '');

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try { const body = await response.json(); if (body?.error) detail = body.error; } catch { /* noop */ }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    if (!['image/png', 'image/webp'].includes(file.type)) return reject(new Error('Yalnız PNG veya WebP yüklenebilir.'));
    if (file.size > 1_000_000) return reject(new Error('İkon en fazla 1 MB olabilir.'));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Dosya okunamadı.'));
    reader.readAsDataURL(file);
  });
}

export default function ControlPlaneV24() {
  const [tab, setTab] = useState<'users'|'roles'|'security'|'branding'>('users');
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [devices, setDevices] = useState<TrustedDevice[]>([]);
  const [trustedDays, setTrustedDays] = useState(30);
  const [branding, setBranding] = useState<Branding | null>(null);
  const [animationPresets, setAnimationPresets] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', displayName: '', roleId: 'role_viewer' });
  const [newRole, setNewRole] = useState({ name: '', description: '', permissions: [] as string[] });

  const can = (permission: string) => me?.permissions.includes(permission) ?? false;
  const roleMap = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);

  async function refresh() {
    setError('');
    try {
      const mePayload = await api<Me>('/auth/me');
      setMe(mePayload);
      const jobs: Promise<void>[] = [];
      if (mePayload.permissions.includes('users.read')) jobs.push(api<{users: User[]}>('/auth/admin/users').then((p) => setUsers(p.users ?? [])));
      if (mePayload.permissions.includes('roles.read')) {
        jobs.push(api<{roles: Role[]}>('/auth/admin/roles').then((p) => setRoles(p.roles ?? [])));
        jobs.push(api<{permissions: string[]}>('/auth/admin/permissions').then((p) => setPermissions(p.permissions ?? [])));
      }
      if (mePayload.permissions.includes('security.read')) jobs.push(api<{trustedDeviceDays:number;trustedDevices:TrustedDevice[]}>('/auth/security').then((p) => { setTrustedDays(p.trustedDeviceDays); setDevices(p.trustedDevices ?? []); }));
      if (mePayload.permissions.includes('settings.read')) jobs.push(api<{branding: Branding; animationPresets:string[]}>('/control-plane/branding').then((p) => { setBranding(p.branding); setAnimationPresets(p.animationPresets ?? []); }));
      await Promise.all(jobs);
    } catch (cause) { setError((cause as Error).message); }
  }

  useEffect(() => { void refresh(); }, []);

  async function createUser(event: FormEvent) {
    event.preventDefault(); if (!newUser.email.trim()) return;
    setBusy(true); setError('');
    try {
      await api('/auth/admin/users', { method: 'POST', body: JSON.stringify({ email: newUser.email, displayName: newUser.displayName, roleIds: [newUser.roleId] }) });
      setNewUser({ email: '', displayName: '', roleId: 'role_viewer' }); setNotice('Kullanıcı oluşturuldu.'); await refresh();
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }

  async function patchUser(user: User, patch: Partial<Pick<User,'displayName'|'roleIds'|'active'>>) {
    setBusy(true); setError('');
    try { await api(`/auth/admin/users/${user.id}`, { method:'PATCH', body:JSON.stringify(patch) }); setNotice('Kullanıcı güncellendi.'); await refresh(); }
    catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }

  async function createRole(event: FormEvent) {
    event.preventDefault(); if (!newRole.name.trim()) return;
    setBusy(true); setError('');
    try { await api('/auth/admin/roles', { method:'POST', body:JSON.stringify(newRole) }); setNewRole({ name:'', description:'', permissions:[] }); setNotice('Rol oluşturuldu.'); await refresh(); }
    catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }

  async function saveSecurity() {
    setBusy(true); setError('');
    try { await api('/auth/security/policy', { method:'PATCH', body:JSON.stringify({ trustedDeviceDays: trustedDays }) }); setNotice('Trusted device politikası kaydedildi.'); await refresh(); }
    catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }

  async function revokeDevice(id: string) {
    if (!confirm('Bu cihazın güvenini kaldırmak istiyor musunuz?')) return;
    setBusy(true); try { await api(`/auth/trusted-devices/${id}`, { method:'DELETE' }); await refresh(); }
    catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }

  async function uploadIcon(event: ChangeEvent<HTMLInputElement>, light = false) {
    const file = event.target.files?.[0]; if (!file || !branding) return;
    try { const data = await fileToDataUrl(file); setBranding({ ...branding, [light ? 'lightIconDataUrl' : 'iconDataUrl']: data }); }
    catch (cause) { setError((cause as Error).message); }
  }

  async function saveBranding() {
    if (!branding) return; setBusy(true); setError('');
    try {
      const payload = await api<{branding:Branding}>('/control-plane/branding', { method:'PATCH', body:JSON.stringify({ assistantName: branding.assistantName, assistantSubtitle: branding.assistantSubtitle, iconDataUrl: branding.iconDataUrl ?? '', lightIconDataUrl: branding.lightIconDataUrl ?? '', animationPreset: branding.animationPreset }) });
      setBranding(payload.branding); setNotice('Taso kimliği kaydedildi.'); window.dispatchEvent(new CustomEvent('taso:branding-updated', { detail: payload.branding }));
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }

  return <section className="cp24-shell" aria-label="Taso Control Plane">
    <header className="cp24-header"><div><span>CONTROL PLANE</span><h1>Admin Merkezi</h1><p>Kullanıcı, rol, cihaz güveni ve Taso kimliğini tek yerden yönet.</p></div><div className="cp24-identity"><strong>{me?.user.displayName ?? '—'}</strong><small>{me?.roles.map(r=>r.name).join(' · ') || 'Rol yok'}</small></div></header>
    {(error || notice) && <div className={`cp24-message ${error ? 'bad' : 'ok'}`}>{error || notice}</div>}
    <nav className="cp24-tabs">{(['users','roles','security','branding'] as const).map((item) => <button key={item} className={tab===item?'active':''} onClick={()=>{setTab(item);setNotice('');}}>{item==='users'?'Kullanıcılar':item==='roles'?'Roller':item==='security'?'Güvenlik':'Taso Kimliği'}</button>)}</nav>

    {tab==='users' && <div className="cp24-grid">
      <section className="cp24-card wide"><div className="cp24-card-head"><div><span>USERS</span><strong>Ekip erişimi</strong></div><b>{users.length}</b></div><div className="cp24-user-list">{users.map(user => <article key={user.id}><div className="cp24-avatar">{user.displayName.slice(0,1).toUpperCase()}</div><div><strong>{user.displayName}</strong><small>{user.email}</small><em>{user.roleIds.map(id=>roleMap.get(id)?.name ?? id).join(' · ')}</em></div><select disabled={!can('users.write')||user.owner||busy} value={user.roleIds[0] ?? ''} onChange={e=>void patchUser(user,{roleIds:[e.target.value]})}>{roles.map(role=><option key={role.id} value={role.id}>{role.name}</option>)}</select><button disabled={!can('users.write')||user.owner||busy} onClick={()=>void patchUser(user,{active:!user.active})}>{user.active?'Aktif':'Pasif'}</button></article>)}</div></section>
      {can('users.write') && <form className="cp24-card" onSubmit={createUser}><div className="cp24-card-head"><div><span>NEW USER</span><strong>Kullanıcı ekle</strong></div></div><label>E-posta<input type="email" value={newUser.email} onChange={e=>setNewUser({...newUser,email:e.target.value})} required /></label><label>Ad<input value={newUser.displayName} onChange={e=>setNewUser({...newUser,displayName:e.target.value})} /></label><label>Rol<select value={newUser.roleId} onChange={e=>setNewUser({...newUser,roleId:e.target.value})}>{roles.filter(r=>r.id!=='role_owner').map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label><button className="primary" disabled={busy}>Kullanıcı oluştur</button></form>}
    </div>}

    {tab==='roles' && <div className="cp24-grid"><section className="cp24-card wide"><div className="cp24-card-head"><div><span>RBAC</span><strong>Roller ve yetkiler</strong></div></div><div className="cp24-role-grid">{roles.map(role=><article key={role.id}><div><strong>{role.name}</strong>{role.system&&<span>SYSTEM</span>}</div><p>{role.description}</p><small>{role.permissions.length} yetki</small></article>)}</div></section>{can('roles.write')&&<form className="cp24-card" onSubmit={createRole}><div className="cp24-card-head"><div><span>CUSTOM ROLE</span><strong>Yeni rol</strong></div></div><label>Ad<input value={newRole.name} onChange={e=>setNewRole({...newRole,name:e.target.value})}/></label><label>Açıklama<input value={newRole.description} onChange={e=>setNewRole({...newRole,description:e.target.value})}/></label><div className="cp24-permissions">{permissions.map(p=><label key={p}><input type="checkbox" checked={newRole.permissions.includes(p)} onChange={e=>setNewRole({...newRole,permissions:e.target.checked?[...newRole.permissions,p]:newRole.permissions.filter(x=>x!==p)})}/><span>{p}</span></label>)}</div><button className="primary" disabled={busy}>Rol oluştur</button></form>}</div>}

    {tab==='security' && <div className="cp24-grid"><section className="cp24-card"><div className="cp24-card-head"><div><span>TRUST POLICY</span><strong>Trusted device</strong></div></div><label>Güven süresi (gün)<input type="number" min={1} max={365} value={trustedDays} onChange={e=>setTrustedDays(Number(e.target.value))}/></label><button className="primary" disabled={!can('security.write')||busy} onClick={()=>void saveSecurity()}>Politikayı kaydet</button></section><section className="cp24-card wide"><div className="cp24-card-head"><div><span>DEVICES</span><strong>Güvenilen cihazlar</strong></div><b>{devices.filter(d=>!d.revokedAt).length}</b></div><div className="cp24-device-list">{devices.map(d=><article key={d.id}><div><strong>{d.label}</strong><small>{d.userAgent || 'Bilinmeyen tarayıcı'}</small><em>Son kullanım: {d.lastUsedAt ? new Date(d.lastUsedAt).toLocaleString('tr-TR') : '—'}</em></div><button disabled={!can('security.write')||Boolean(d.revokedAt)||busy} onClick={()=>void revokeDevice(d.id)}>{d.revokedAt?'Kaldırıldı':'Güveni kaldır'}</button></article>)}</div></section></div>}

    {tab==='branding' && branding && <div className="cp24-grid"><section className="cp24-card"><div className="cp24-card-head"><div><span>IDENTITY</span><strong>Taso kimliği</strong></div></div><label>Asistan adı<input value={branding.assistantName} onChange={e=>setBranding({...branding,assistantName:e.target.value})}/></label><label>Alt başlık<input value={branding.assistantSubtitle} onChange={e=>setBranding({...branding,assistantSubtitle:e.target.value})}/></label><label>Animasyon<select value={branding.animationPreset} onChange={e=>setBranding({...branding,animationPreset:e.target.value})}>{animationPresets.map(p=><option key={p}>{p}</option>)}</select></label><button className="primary" disabled={!can('settings.write')||busy} onClick={()=>void saveBranding()}>Kimliği kaydet</button></section><section className="cp24-card wide"><div className="cp24-card-head"><div><span>ICON SYSTEM</span><strong>Dark / Light ikon</strong></div></div><div className="cp24-brand-preview"><div className={`cp24-orb preset-${branding.animationPreset}`} style={branding.iconDataUrl?{backgroundImage:`url(${branding.iconDataUrl})`}:undefined}>{!branding.iconDataUrl&&branding.assistantName.slice(0,1)}</div><div><strong>{branding.assistantName}</strong><span>{branding.assistantSubtitle}</span><small>Preset: {branding.animationPreset}</small></div></div><div className="cp24-upload-row"><label>Dark ikon<input type="file" accept="image/png,image/webp" onChange={e=>void uploadIcon(e,false)}/></label><label>Light ikon<input type="file" accept="image/png,image/webp" onChange={e=>void uploadIcon(e,true)}/></label></div></section></div>}
  </section>;
}
