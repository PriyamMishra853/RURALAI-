import React, { useState, useEffect, useCallback } from 'react';
import { UserCog, Database, Plus, Stethoscope, BarChart3, Users, AlertCircle, Loader2 } from 'lucide-react';
import { TrendChart, RiskChart, BarList, VisitFunnel } from '../components/admin/Charts';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { ROLES } from '../config/roles';

/**
 * Admin console.
 *
 * Scope is decided by the server from the caller's own profile, not by this
 * page — a state admin gets their state, a district admin their district, a
 * super admin the country. Nothing here can widen that.
 *
 * v2 API responses are envelopes: /admin/users returns { total, users: [...] },
 * /admin/audit returns { total, logs: [...] }. Reading `res.data` as an array
 * put an object into a `.map()` and white-screened the whole dashboard, which
 * is why the super admin appeared to load for a moment and then break.
 */

const ROLE_LABEL = {
  SUPER_ADMIN: 'Super Administrator',
  STATE_ADMIN: 'State Administrator',
  DISTRICT_ADMIN: 'District Administrator',
  DOCTOR: 'Doctor',
  CLINIC_ASSISTANT: 'Clinic Assistant',
  AUDITOR: 'Auditor'
};

/** Which roles this admin may create, mirroring CREATABLE_ROLES on the server. */
const CREATABLE = {
  SUPER_ADMIN: ['STATE_ADMIN', 'DISTRICT_ADMIN', 'DOCTOR', 'CLINIC_ASSISTANT', 'AUDITOR'],
  STATE_ADMIN: ['DISTRICT_ADMIN', 'DOCTOR', 'CLINIC_ASSISTANT', 'AUDITOR'],
  DISTRICT_ADMIN: ['DOCTOR', 'CLINIC_ASSISTANT']
};

export default function AdminDashboard({ auditOnly = false }) {
  const { user } = useAuth();
  const isAuditor = user?.role === ROLES.AUDITOR;

  const [activeTab, setActiveTab] = useState(auditOnly || isAuditor ? 'audit' : 'analytics');
  const [analytics, setAnalytics] = useState(null);
  const [users, setUsers] = useState([]);
  const [userTotal, setUserTotal] = useState(0);
  const [auditLogs, setAuditLogs] = useState([]);
  const [regions, setRegions] = useState({ states: [], districts: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [roleFilter, setRoleFilter] = useState('DOCTOR');

  const creatable = CREATABLE[user?.role] || [];
  const [newUser, setNewUser] = useState({
    full_name: '', email: '', phone: '', role: 'DOCTOR', password: '', district_id: '', state_id: ''
  });
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState(null);

  const fetchAdminData = useCallback(async () => {
    try {
      const [uRes, aRes, statRes, rRes] = await Promise.all([
        api.get('/admin/users', { params: { role: roleFilter, pageSize: 50 } }).catch(() => ({ data: { users: [], total: 0 } })),
        api.get('/admin/audit', { params: { pageSize: 100 } }).catch(() => ({ data: { logs: [] } })),
        api.get('/admin/analytics').catch(() => ({ data: null })),
        api.get('/admin/regions').catch(() => ({ data: { states: [], districts: [] } }))
      ]);

      setUsers(uRes.data?.users ?? []);
      setUserTotal(uRes.data?.total ?? 0);
      setAuditLogs(aRes.data?.logs ?? []);
      setAnalytics(statRes.data ?? null);
      setRegions({ states: rRes.data?.states ?? [], districts: rRes.data?.districts ?? [] });
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load the admin console.');
    } finally {
      setLoading(false);
    }
  }, [roleFilter]);

  useEffect(() => { fetchAdminData(); }, [fetchAdminData]);

  const handleAddUser = async (e) => {
    e.preventDefault();
    setCreating(true);
    setCreateMsg(null);
    try {
      await api.post('/admin/users', newUser);
      setCreateMsg({ ok: true, text: `${newUser.full_name} created as ${ROLE_LABEL[newUser.role]}.` });
      setNewUser({ full_name: '', email: '', phone: '', role: creatable[0] || 'DOCTOR', password: '', district_id: '', state_id: '' });
      fetchAdminData();
    } catch (err) {
      setCreateMsg({ ok: false, text: err.response?.data?.error || 'Account could not be created.' });
    } finally {
      setCreating(false);
    }
  };


  const tabs = [
    ...(isAuditor ? [] : [
      { id: 'analytics', label: 'Platform Metrics', icon: <BarChart3 className="w-4 h-4" /> },
      { id: 'staff', label: 'Staff Accounts', icon: <Stethoscope className="w-4 h-4" /> }
    ]),
    { id: 'audit', label: 'Audit Logs', icon: <Database className="w-4 h-4" /> }
  ];

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center text-sm text-ink-muted flex items-center justify-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading the admin console…
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 lg:px-8 py-8 space-y-6">

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-ink flex items-center gap-2">
            <UserCog className="w-5 h-5 text-gov-600" /> Admin Console
          </h1>
          <p className="text-xs text-ink-muted">
            {ROLE_LABEL[user?.role]}
            {user?.district ? ` · ${user.district} district` : user?.state ? ` · ${user.state}` : ' · nationwide'}
          </p>
        </div>
        <span className="px-3 py-1.5 rounded-field bg-surface-sunken border border-line text-[11px] font-semibold text-ink-muted">
          Scope: {analytics?.scope || (user?.district ? 'district' : user?.state ? 'state' : 'national')}
        </span>
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-field bg-tier-emergencyBg border border-tier-emergency/30 text-xs text-tier-emergency flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="flex overflow-x-auto gap-2 border-b border-line pb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 rounded-field font-semibold text-xs flex items-center gap-2 whitespace-nowrap transition-colors ${
              activeTab === t.id
                ? 'bg-gov-50 text-gov-600 border border-gov-200'
                : 'text-ink-muted hover:text-ink bg-surface-raised border border-line'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'analytics' && (
        <div className="space-y-5">
          {/* Network inventory — what exists. Stat tiles, because five
              unrelated totals share no scale worth plotting against. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
            {[
              { label: 'Patients', value: analytics?.patients, hint: 'Registered' },
              { label: 'Doctors', value: analytics?.doctors, hint: 'Active' },
              { label: 'Clinic assistants', value: analytics?.clinic_assistants, hint: 'Active' },
              { label: 'Districts', value: analytics?.districts_total, hint: 'Covered' },
              { label: 'States / UTs', value: analytics?.states_total, hint: 'In the register' }
            ].map((s) => (
              <div key={s.label} className="bg-surface-raised rounded-card border border-line shadow-sm p-3">
                <div className="text-xl font-bold text-ink tabular-nums">
                  {s.value === undefined || s.value === null ? '—' : new Intl.NumberFormat('en-IN').format(s.value)}
                </div>
                <div className="text-[11px] font-semibold text-ink mt-0.5">{s.label}</div>
                <div className="text-[10px] text-ink-subtle">{s.hint}</div>
              </div>
            ))}
          </div>

          {/* What the network is doing, as opposed to what it contains. */}
          <VisitFunnel visits={analytics?.visits || {}} />

          <TrendChart data={analytics?.trend || []} />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <RiskChart distribution={analytics?.risk_distribution || {}} />
            <BarList
              title="Busiest districts"
              subtitle="Visits recorded, highest first"
              valueLabel="Visits"
              items={analytics?.top_districts || []}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <BarList
              title="Patients by age"
              subtitle="Derived from date of birth, never stored"
              valueLabel="Patients"
              items={analytics?.demographics?.age_bands || []}
            />
            <BarList
              title="Patients by sex"
              valueLabel="Patients"
              items={Object.entries(analytics?.demographics?.gender || {})
                .map(([label, count]) => ({ label: label[0].toUpperCase() + label.slice(1), count }))
                .filter((g) => g.count > 0)}
            />
          </div>

          <p className="text-[11px] text-ink-muted">
            Aggregate counts only. No admin role can open a patient record — that
            restriction is enforced in the API and in the database. Withdrawn
            visits are excluded from every figure on this page.
          </p>
        </div>
      )}

      {activeTab === 'staff' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          <form onSubmit={handleAddUser} className="bg-surface-raised p-6 rounded-field border border-line shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-ink flex items-center gap-2">
              <Plus className="w-4 h-4 text-gov-600" /> Provision staff account
            </h3>
            <p className="text-[11px] text-ink-muted">
              The only way an account comes into existence. There is no public sign-up.
            </p>

            {createMsg && (
              <div className={`p-2.5 rounded-field border text-[11px] ${
                createMsg.ok ? 'bg-tier-lowBg border-tier-low/30 text-tier-low' : 'bg-tier-emergencyBg border-tier-emergency/30 text-tier-emergency'
              }`}>
                {createMsg.text}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-ink-muted mb-1">Full name</label>
              <input type="text" required value={newUser.full_name}
                onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })}
                placeholder="e.g. Dr. Rajesh Verma"
                className="w-full bg-surface-raised border border-line-strong rounded-field px-3 py-2 text-xs text-ink focus:border-gov-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-muted mb-1">Email</label>
              <input type="email" required value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                className="w-full bg-surface-raised border border-line-strong rounded-field px-3 py-2 text-xs text-ink focus:border-gov-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-muted mb-1">Role</label>
              <select value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                className="w-full bg-surface-raised border border-line-strong rounded-field px-3 py-2 text-xs text-ink focus:border-gov-500 outline-none">
                {creatable.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <p className="mt-1 text-[10px] text-ink-subtle">
                Your role may create: {creatable.map((r) => ROLE_LABEL[r]).join(', ') || 'no roles'}.
              </p>
            </div>

            {['DOCTOR', 'CLINIC_ASSISTANT', 'DISTRICT_ADMIN'].includes(newUser.role) && (
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">District</label>
                <select required value={newUser.district_id}
                  onChange={(e) => setNewUser({ ...newUser, district_id: e.target.value })}
                  className="w-full bg-surface-raised border border-line-strong rounded-field px-3 py-2 text-xs text-ink focus:border-gov-500 outline-none">
                  <option value="">Select a district</option>
                  {regions.districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            )}
            {newUser.role === 'STATE_ADMIN' && (
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">State</label>
                <select required value={newUser.state_id}
                  onChange={(e) => setNewUser({ ...newUser, state_id: e.target.value })}
                  className="w-full bg-surface-raised border border-line-strong rounded-field px-3 py-2 text-xs text-ink focus:border-gov-500 outline-none">
                  <option value="">Select a state</option>
                  {regions.states.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-ink-muted mb-1">Initial password</label>
              <input type="text" required minLength={12} value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                placeholder="At least 12 characters"
                className="w-full bg-surface-raised border border-line-strong rounded-field px-3 py-2 text-xs text-ink focus:border-gov-500 outline-none font-mono" />
              <p className="mt-1 text-[10px] text-ink-subtle">
                Set per account and handed over directly — there is no shared default password.
              </p>
            </div>

            <button type="submit" disabled={creating || !creatable.length}
              className="w-full py-2.5 rounded-field bg-gov-600 hover:bg-gov-700 disabled:opacity-50 text-white font-semibold text-xs shadow-sm flex items-center justify-center gap-2">
              {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {creating ? 'Creating…' : 'Create staff account'}
            </button>
          </form>

          <div className="lg:col-span-2 bg-surface-raised p-6 rounded-field border border-line shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                <Users className="w-4 h-4 text-tier-low" /> Roster
                <span className="font-normal text-ink-subtle">({userTotal} total)</span>
              </h3>
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
                className="bg-surface-raised border border-line-strong rounded-field px-3 py-1.5 text-xs text-ink focus:border-gov-500 outline-none">
                {Object.keys(ROLE_LABEL).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </div>

            {users.length === 0 ? (
              <p className="text-xs text-ink-muted p-6 text-center border border-dashed border-line rounded-field">
                No {ROLE_LABEL[roleFilter]?.toLowerCase()} accounts in your region.
              </p>
            ) : (
              <div className="space-y-2 max-h-[32rem] overflow-y-auto">
                {users.map((u) => (
                  <div key={u.id} className="p-3 rounded-field bg-surface-sunken border border-line flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-xs text-ink truncate">{u.full_name}</div>
                      <div className="text-[11px] text-ink-muted truncate">{u.email}</div>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border shrink-0 ${
                      u.status === 'active'
                        ? 'bg-tier-lowBg text-tier-low border-tier-low/30'
                        : 'bg-surface-sunken text-ink-muted border-line'
                    }`}>
                      {u.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="bg-surface-raised p-6 rounded-field border border-line shadow-sm space-y-4">
          <div>
            <h3 className="text-sm font-bold text-ink">Compliance audit trail</h3>
            <p className="text-[11px] text-ink-muted">
              Append-only. No role can edit or delete an entry — there is no UPDATE or DELETE policy on this table.
              Identifiers are redacted at write time.
            </p>
          </div>
          {auditLogs.length === 0 ? (
            <p className="text-xs text-ink-muted p-6 text-center border border-dashed border-line rounded-field">
              No audit entries yet.
            </p>
          ) : (
            <div className="overflow-x-auto max-h-[36rem]">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-sunken text-ink-muted uppercase text-[10px] border-b border-line sticky top-0">
                  <tr>
                    <th className="px-4 py-2">Timestamp</th>
                    <th className="px-4 py-2">Actor Role</th>
                    <th className="px-4 py-2">Action</th>
                    <th className="px-4 py-2">Entity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line font-mono text-[11px]">
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="px-4 py-2 text-ink-muted whitespace-nowrap">{new Date(log.created_at).toLocaleString()}</td>
                      <td className="px-4 py-2 text-gov-600 font-semibold">{log.actor_role || '—'}</td>
                      <td className="px-4 py-2 text-gov-600 font-bold">{log.action}</td>
                      <td className="px-4 py-2 text-ink-muted">{log.entity_type || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
