import React, { useState, useEffect } from 'react';
import {
  Users, CreditCard, AlertCircle, FileText, Plus, RefreshCw, BarChart3, Shield, Bug, Lightbulb, UserCheck, Crown, TrendingUp, Gift, Activity, Search, UserPlus, Lock, Check, X, ShieldAlert, DollarSign, Copy, CheckCheck, Wallet, Sparkles,
} from 'lucide-react';
import { SupportTicket, Announcement } from '../types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import SubAdminConsole from './SubAdminConsole';

/**
 * The Pro list price, in rupees.
 *
 * The panel had 399 written into four places — a revenue fallback, the MRR
 * fallback, the subscriber caption and the record-payment default — so after
 * the plan moved to ₹499 the admin's own dashboard quoted the old price back
 * at them. It mirrors the server's PRO_PLAN_AMOUNT_PAISE / 100.
 */
const PRO_PRICE_INR = 499;

function formatDateTime(iso?: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Never';
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(d);
}

interface AdminPanelProps {
  onPublishAnnouncement: () => void;
  onInspectUser?: (user: any) => void;
  role?: string;
}

const DEFAULT_PERMISSIONS_BY_ROLE: Record<string, string[]> = {
  SUPER_ADMIN: [
    'users.read', 'users.manage', 'users.roles',
    'tickets.read', 'tickets.manage',
    'announcements.manage', 'billing.read', 'audit.read', 'dashboard.read',
    'assigned.read', 'subadmin.assign', 'partner.manage', 'partner.self',
  ],
  ADMIN: [
    'users.read', 'users.manage',
    'tickets.read', 'tickets.manage',
    'announcements.manage', 'dashboard.read', 'partner.self',
  ],
  SUB_ADMIN: [
    'users.read', 'assigned.read',
    'tickets.read', 'tickets.manage',
    'dashboard.read', 'partner.self',
  ],
  PARTNER: [
    'users.read', 'assigned.read', 'partner.self',
  ],
  SUPPORT: [
    'users.read', 'tickets.read', 'tickets.manage', 'dashboard.read'
  ],
  USER: [],
};

export default function AdminPanel({ onPublishAnnouncement, onInspectUser, role }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'users' | 'assigned' | 'team' | 'billing' | 'tickets' | 'bugs' | 'features' | 'announcements' | 'audit'>('dashboard');

  // What this operator may actually do. The server enforces it either way;
  // this is so the console does not offer buttons that would come back 403.
  const [myRole, setMyRole] = useState<string>(role || 'USER');
  const isSubAdmin = myRole === 'SUB_ADMIN';
  const [myPermissions, setMyPermissions] = useState<string[]>(() => {
    return DEFAULT_PERMISSIONS_BY_ROLE[role || 'USER'] || [];
  });

  useEffect(() => {
    if (role && role !== myRole) {
      setMyRole(role);
      setMyPermissions(DEFAULT_PERMISSIONS_BY_ROLE[role] || []);
    }
  }, [role]);
  const [partnerBusy, setPartnerBusy] = useState<string | null>(null);
  const [rolePermissions, setRolePermissions] = useState<Record<string, string[]>>({});

  // Assignment editor: which sub-admin is open, and who they can see.
  const [assignFor, setAssignFor] = useState<{ id: string; email: string } | null>(null);
  const [assignedUsers, setAssignedUsers] = useState<any[]>([]);
  const [assignEmail, setAssignEmail] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState('');
  
  const [dashboardStats, setDashboardStats] = useState<any>({});
  const [users, setUsers] = useState<any[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [bugs, setBugs] = useState<any[]>([]);
  const [features, setFeatures] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [partnerTotals, setPartnerTotals] = useState<any>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [billingData, setBillingData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // User search & filtering
  const [userSearch, setUserSearch] = useState('');
  const [planFilter, setPlanFilter] = useState<'ALL' | 'PRO' | 'FREE'>('ALL');

  // Billing search & filters
  const [billingSearch, setBillingSearch] = useState('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'ALL' | 'captured' | 'pending' | 'failed'>('ALL');
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  // Manual payment recording modal
  const [showRecordPaymentModal, setShowRecordPaymentModal] = useState(false);
  const [recordEmail, setRecordEmail] = useState('');
  const [recordAmount, setRecordAmount] = useState(String(PRO_PRICE_INR));
  const [recordMethod, setRecordMethod] = useState<'upi' | 'card' | 'bank_transfer' | 'cash'>('upi');
  const [recordNotes, setRecordNotes] = useState('');
  const [recordDays, setRecordDays] = useState('30');
  const [recordSubmitting, setRecordSubmitting] = useState(false);

  // Super Admin: Grant / Manage Pro modal
  const [grantProModalUser, setGrantProModalUser] = useState<any | null>(null);
  const [grantProDays, setGrantProDays] = useState<string>('30');
  const [grantProSubmitting, setGrantProSubmitting] = useState(false);

  // Team management form
  const [roleEmail, setRoleEmail] = useState('');
  const [roleSelect, setRoleSelect] = useState('SUB_ADMIN');
  const [roleSubmitting, setRoleSubmitting] = useState(false);

  // Announcement fields
  const [annTitle, setAnnTitle] = useState('');
  const [annContent, setAnnContent] = useState('');

  // Partner Payout Management in Billing tab
  const [adminPayouts, setAdminPayouts] = useState<any[]>([]);
  const [adminPayoutsSummary, setAdminPayoutsSummary] = useState<any>(null);
  const [payoutFilter, setPayoutFilter] = useState<'ALL' | 'PENDING' | 'PAID' | 'REJECTED'>('ALL');
  const [selectedPayout, setSelectedPayout] = useState<any | null>(null);
  const [processModalAction, setProcessModalAction] = useState<'PAID' | 'REJECTED'>('PAID');
  const [payoutUtrInput, setPayoutUtrInput] = useState('');
  const [payoutNotesInput, setPayoutNotesInput] = useState('');
  const [processingPayout, setProcessingPayout] = useState(false);
  const [copiedDetail, setCopiedDetail] = useState<string | null>(null);

  // Auth headers — must be sent to all admin API calls
  const getAuthHeaders = (): Record<string, string> => {
    const userId = sessionStorage.getItem('auth_user_id') || '';
    const email = sessionStorage.getItem('auth_email') || '';
    const headers: Record<string, string> = {};
    if (userId) headers['x-auth-user-id'] = userId;
    if (email) headers['x-auth-email'] = email;
    return headers;
  };

  const copyWebhookUrl = () => {
    const url = `${window.location.origin}/api/payments/webhook`;
    navigator.clipboard.writeText(url);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2200);
  };
  const fetchData = async () => {
    setLoading(true);
    const authHeaders = getAuthHeaders();
    try {
      // Always fetch dashboard summary and user registry so counters are live across all tabs
      const [dashRes, usersRes, checkRes, payoutsSummaryRes] = await Promise.all([
        fetch('/api/admin/dashboard', { headers: authHeaders }),
        fetch('/api/admin/users', { headers: authHeaders }),
        fetch('/api/admin/check', { headers: authHeaders }),
        fetch('/api/admin/payouts', { headers: authHeaders }),
      ]);
      if (checkRes.ok) {
        const check = await checkRes.json();
        setMyRole(check.role || 'USER');
        setMyPermissions(check.permissions || []);
      }
      if (dashRes.ok) setDashboardStats(await dashRes.json());
      if (usersRes.ok) {
        const data = await usersRes.json();
        if (data.users) setUsers(data.users);
      }
      if (payoutsSummaryRes.ok) {
        const pData = await payoutsSummaryRes.json();
        setAdminPayouts(pData.requests || []);
        setAdminPayoutsSummary(pData.summary || null);
      }

      if (activeTab === 'assigned' && myRole !== 'SUB_ADMIN') {
        // The partner roster is only meaningful to a full admin; a sub-admin
        // has no partner.manage permission and the server would refuse it.
        const res = await fetch('/api/admin/partners', { headers: authHeaders });
        if (res.ok) {
          const data = await res.json();
          setPartners(data.partners || []);
          setPartnerTotals(data.totals || null);
        }
      } else if (activeTab === 'team') {
        const res = await fetch('/api/admin/team', { headers: authHeaders });
        if (res.ok) {
          const data = await res.json();
          if (data.team) setTeam(data.team);
          // Drive the capability matrix from the server's own table so the
          // two can never drift apart.
          if (data.permissions) setRolePermissions(data.permissions);
        }
      } else if (activeTab === 'billing') {
        const [res, pRes] = await Promise.all([
          fetch('/api/admin/billing', { headers: authHeaders }),
          fetch('/api/admin/payouts', { headers: authHeaders }),
        ]);
        if (res.ok) {
          const data = await res.json();
          setBillingData(data);
        }
        if (pRes.ok) {
          const pData = await pRes.json();
          setAdminPayouts(pData.requests || []);
          setAdminPayoutsSummary(pData.summary || null);
        }
      } else if (activeTab === 'audit') {
        const res = await fetch('/api/admin/audit', { headers: authHeaders });
        if (res.ok) {
          const data = await res.json();
          if (data.entries) setAuditLogs(data.entries);
        }
      } else if (activeTab === 'tickets') {
        const res = await fetch('/api/tickets', { headers: authHeaders });
        if (res.ok) {
          const data = await res.json();
          if (data.tickets) setTickets(data.tickets);
        }
      } else if (activeTab === 'announcements') {
        const res = await fetch('/api/announcements', { headers: authHeaders });
        if (res.ok) {
          const data = await res.json();
          if (data.announcements) setAnnouncements(data.announcements);
        }
      } else if (activeTab === 'bugs') {
        const res = await fetch('/api/admin/bugs', { headers: authHeaders });
        if (res.ok) {
          const data = await res.json();
          if (data.bugs) setBugs(data.bugs);
        }
      } else if (activeTab === 'features') {
        const res = await fetch('/api/admin/features', { headers: authHeaders });
        if (res.ok) {
          const data = await res.json();
          if (data.features) setFeatures(data.features);
        }
      }
    } catch (e) {
      console.error('Error loading admin data:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recordEmail) return alert('Enter trader email address');
    setRecordSubmitting(true);
    try {
      const res = await fetch('/api/admin/payments/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          userEmail: recordEmail.trim(),
          amount: Number(recordAmount) || PRO_PRICE_INR,
          method: recordMethod,
          notes: recordNotes,
          days: Number(recordDays) || 30
        })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message || 'Payment successfully recorded and Pro access activated!');
        setShowRecordPaymentModal(false);
        setRecordEmail('');
        setRecordNotes('');
        fetchData();
        if (activeTab === 'billing') {
          const bRes = await fetch('/api/admin/billing', { headers: getAuthHeaders() });
          if (bRes.ok) setBillingData(await bRes.json());
        }
      } else {
        alert(data.error || 'Failed to record manual payment.');
      }
    } catch (err: any) {
      alert('Error recording payment: ' + (err?.message || err));
    } finally {
      setRecordSubmitting(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  // A sub-admin's job is their assigned users, so open there rather than on a
  // platform dashboard scoped down to almost nothing. Keyed on the role so it
  // fires once, not on every tab change.
  useEffect(() => {
    if (myRole === 'SUB_ADMIN') setActiveTab('assigned');
  }, [myRole]);

  /**
   * Upgrade to Partner.
   *
   * One call on the server does all three things the role implies — sets the
   * role, grants Pro, and mints a referral code — on the user's existing
   * account. No second account is created and nothing they already own is
   * touched.
   */
  const handleUpgradeToPartner = async (u: any) => {
    if (!confirm(
      `Make ${u.email} a Partner?

They keep this account and everything in it, ` +
      `get Pro access, and receive their own referral link and code.`
    )) return;
    setPartnerBusy(u.id);
    try {
      const res = await fetch(`/api/admin/users/${u.id}/partner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not upgrade this user.');
      setUsers(prev => prev.map(x => x.id === u.id
        ? { ...x, role: 'PARTNER', isPro: true, partnerCode: body.referralCode }
        : x));
      alert(`${u.email} is now a Partner.

Referral code: ${body.referralCode}`);
    } catch (e: any) {
      alert(e.message || 'Could not upgrade this user.');
    } finally {
      setPartnerBusy(null);
    }
  };

  // Pro is deliberately left in place: it may have been paid for, and taking
  // a paid plan away as a side effect of a role change is the kind of thing
  // nobody notices until the customer complains.
  const handleRemovePartner = async (u: any) => {
    if (!confirm(
      `Remove Partner access from ${u.email}?

Their referral link stops working and ` +
      `they lose the Partner Portal. Their Pro plan and their own data are not affected.`
    )) return;
    setPartnerBusy(u.id);
    try {
      const res = await fetch(`/api/admin/users/${u.id}/partner`, {
        method: 'DELETE',
        headers: { ...getAuthHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not remove partner access.');
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, role: 'USER', partnerCode: null } : x));
    } catch (e: any) {
      alert(e.message || 'Could not remove partner access.');
    } finally {
      setPartnerBusy(null);
    }
  };

  const handleUpdateUserStatus = async (userId: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, status: newStatus } : u));
      }
    } catch (e) {
      alert('Failed to modify user status.');
    }
  };

  const handleToggleUserPlan = async (userId: string, currentIsPro: boolean) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ isPro: !currentIsPro, days: 30 })
      });
      if (res.ok) {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, isPro: !currentIsPro } : u));
      }
    } catch (e) {
      alert('Failed to change user plan.');
    }
  };

  const handleConfirmGrantPro = async (isPro: boolean) => {
    if (!grantProModalUser) return;
    setGrantProSubmitting(true);
    try {
      const days = Number(grantProDays) || 30;
      const res = await fetch(`/api/admin/users/${grantProModalUser.id}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ isPro, days })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message || (isPro ? `Pro activated for ${grantProModalUser.name || grantProModalUser.email} (${days} days)!` : 'Pro status revoked.'));
        setUsers(prev => prev.map(u => u.id === grantProModalUser.id ? {
          ...u,
          isPro,
          proUntil: data.proUntil || (isPro ? new Date(Date.now() + days * 86400000).toISOString() : null)
        } : u));
        setGrantProModalUser(null);
        fetchData();
      } else {
        alert(data.error || 'Failed to update user plan.');
      }
    } catch (e: any) {
      alert(e?.message || 'Network error updating user plan.');
    } finally {
      setGrantProSubmitting(false);
    }
  };

  const handleUpdateTeamRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleEmail) return alert('Enter a user email.');
    setRoleSubmitting(true);
    try {
      const res = await fetch('/api/admin/team/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ email: roleEmail, role: roleSelect })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message || `Role updated successfully to ${roleSelect}.`);
        setRoleEmail('');
        fetchData();
      } else {
        alert(data.error || 'Failed to update role.');
      }
    } catch (e) {
      alert('Network error while assigning role.');
    } finally {
      setRoleSubmitting(false);
    }
  };

  // ── Sub-admin assignments ───────────────────────────────────────────────

  const openAssignFor = async (member: { id: string; email: string }) => {
    setAssignFor(member);
    setAssignEmail('');
    setAssignError('');
    setAssignedUsers([]);
    try {
      const res = await fetch(`/api/admin/assignments?subAdminId=${encodeURIComponent(member.id)}`, {
        headers: getAuthHeaders(), credentials: 'include',
      });
      const data = await res.json();
      if (res.ok) setAssignedUsers(data.assigned || []);
      else setAssignError(data.error || 'Could not load assignments.');
    } catch {
      setAssignError('Network error while loading assignments.');
    }
  };

  const handleAssignUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignFor || !assignEmail.trim()) return;
    setAssignBusy(true);
    setAssignError('');
    try {
      const res = await fetch('/api/admin/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({ subAdminId: assignFor.id, userEmail: assignEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setAssignError(data.error || 'Could not assign that user.'); return; }
      setAssignEmail('');
      await openAssignFor(assignFor);
    } catch {
      setAssignError('Network error while assigning.');
    } finally {
      setAssignBusy(false);
    }
  };

  const handleUnassignUser = async (userId: string) => {
    if (!assignFor) return;
    setAssignBusy(true);
    try {
      await fetch('/api/admin/assignments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({ subAdminId: assignFor.id, userId }),
      });
      setAssignedUsers(prev => prev.filter(u => u.id !== userId));
    } finally {
      setAssignBusy(false);
    }
  };

  const handleCloseTicket = async (ticketId: string) => {
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ status: 'Closed' })
      });
      if (res.ok) {
        setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status: 'Closed' } : t));
      }
    } catch (e) {
      alert('Failed to update support ticket.');
    }
  };

  const handleCreateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!annTitle || !annContent) return alert('Fill in all fields');
    
    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ title: annTitle, content: annContent })
      });
      if (res.ok) {
        alert('Global announcement broadcasted successfully!');
        setAnnTitle('');
        setAnnContent('');
        onPublishAnnouncement();
        fetchData();
      }
    } catch (e) {
      alert('Failed to submit announcement.');
    }
  };

  // Filtered users list
  const filteredUsers = users.filter(u => {
    const matchesSearch = !userSearch || 
      (u.name || '').toLowerCase().includes(userSearch.toLowerCase()) ||
      (u.email || '').toLowerCase().includes(userSearch.toLowerCase()) ||
      (u.referralCode || '').toLowerCase().includes(userSearch.toLowerCase());
    const matchesPlan = planFilter === 'ALL' ? true : planFilter === 'PRO' ? !!u.isPro : !u.isPro;
    return matchesSearch && matchesPlan;
  });

  const totalProCount = users.filter(u => !!u.isPro).length;
  const totalFreeCount = users.filter(u => !u.isPro).length;
  const totalReferralEarnings = users.reduce((acc, u) => acc + (u.referralIncome || 0), 0);

  return (
    <div id="admin-management-panel" className="dx-dark-surface bg-[#0b0f19] text-slate-200 border border-slate-800/80 rounded-2xl p-6 shadow-2xl backdrop-blur-xl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-800/80 pb-5 mb-6 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
              <span className="p-2 rounded-xl bg-gradient-to-br from-violet-600/20 to-purple-600/20 border border-violet-500/30 text-violet-400">
                <Shield className="h-5 w-5" />
              </span>
              {isSubAdmin ? 'FX Journal Pro Partner Portal' : 'FX Journal Pro Operations Console'}
            </h2>
            <span className={`text-[11px] ${isSubAdmin ? 'bg-violet-500/10 text-violet-400 border-violet-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'} font-bold px-2.5 py-1 rounded-full border tracking-wide uppercase`}>
              {isSubAdmin ? 'Partner Portal' : 'Admin'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {isSubAdmin 
              ? 'Mentor & partner operations portal, assigned traders inspection and performance telemetry'
              : 'Global SaaS metrics, user registry, mentor read-only inspection, sub-admin console & payment telemetry'}
          </p>
        </div>
        
        <button
          onClick={fetchData}
          disabled={loading}
          className="bg-slate-800/80 border border-slate-700/80 hover:bg-slate-700/80 text-white font-semibold text-xs rounded-xl py-2 px-4 transition flex items-center gap-2 shadow-sm self-start md:self-auto"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-violet-400' : ''}`} />
          Refresh Live Data
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800/80 overflow-x-auto mb-6 gap-1.5 pb-1 scrollbar-hide">
        {[
          { id: 'dashboard', label: 'Dashboard', icon: BarChart3, need: 'dashboard.read' },
          { id: 'assigned', label: isSubAdmin ? 'Partner Console' : 'Sub-Admin Console', icon: UserCheck, need: 'assigned.read', highlight: true },
          { id: 'users', label: 'User Registry', icon: Users, need: 'users.read', badge: users.length ? String(users.length) : undefined },
          { id: 'team', label: 'Team & Roles', icon: Shield, need: 'users.roles' },
          { id: 'billing', label: 'Billing & Payments', icon: CreditCard, need: 'billing.read', badge: adminPayouts.filter(p => p.status === 'PENDING').length ? `${adminPayouts.filter(p => p.status === 'PENDING').length} Payouts` : undefined },
          { id: 'tickets', label: 'Tickets', icon: AlertCircle, need: 'tickets.read', badge: tickets.filter(t => t.status === 'Open').length || undefined },
          { id: 'bugs', label: 'Bugs', icon: Bug, need: 'dashboard.read' },
          { id: 'features', label: 'Features', icon: Lightbulb, need: 'dashboard.read' },
          { id: 'announcements', label: 'Alerts', icon: FileText, need: 'announcements.manage' },
          { id: 'audit', label: 'Audit Trail', icon: ShieldAlert, need: 'audit.read' }
        // Hide what this role cannot use. The routes behind each tab check the
        // same permission, so hiding is cosmetic, not the control.
        ].filter(tab => {
          if (isSubAdmin && ['tickets', 'bugs', 'features'].includes(tab.id)) {
            return false;
          }
          return myPermissions.includes(tab.need);
        }).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`py-2.5 px-4 text-xs font-bold rounded-xl transition flex items-center gap-2 whitespace-nowrap border ${
              activeTab === tab.id 
                ? 'bg-violet-600/20 text-violet-300 border-violet-500/40 shadow-sm shadow-violet-500/10' 
                : tab.highlight
                  // text-violet-700 in light: violet-400 at 90% on the white
                  // console surface measured 2.54:1.
                  ? 'border-violet-500/20 text-violet-700 dark:text-violet-400/90 hover:bg-violet-600/10'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <tab.icon className={`h-4 w-4 ${activeTab === tab.id ? 'text-violet-400' : ''}`} />
            <span>{tab.label}</span>
            {tab.badge && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-300 font-mono border border-slate-700">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 1. DASHBOARD TAB */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Metrics Grid */}
          <div className={`grid grid-cols-2 ${isSubAdmin ? 'md:grid-cols-3 lg:grid-cols-3' : 'md:grid-cols-4 lg:grid-cols-4'} gap-4`}>
            {/* Total Users */}
            <div className="p-5 bg-slate-900/60 rounded-2xl border border-slate-800/90 hover:border-slate-700/80 transition shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Total Users</span>
                <span className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  <Users className="h-4 w-4" />
                </span>
              </div>
              <div className="text-3xl font-black text-white font-mono">{dashboardStats?.totalUsers || 0}</div>
              <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                <span className="text-blue-400 font-semibold">{dashboardStats?.activeUsers || 0}</span> active now
              </div>
            </div>

            {/* Paid Users (Pro) */}
            <div className="p-5 bg-slate-900/60 rounded-2xl border border-violet-500/20 hover:border-violet-500/40 transition shadow-sm bg-gradient-to-br from-violet-950/20 to-transparent">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-violet-300 font-bold uppercase tracking-wider">Paid Users (Pro)</span>
                <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <Crown className="h-4 w-4" />
                </span>
              </div>
              <div className="text-3xl font-black text-violet-300 font-mono">{dashboardStats?.paidUsers ?? totalProCount}</div>
              <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                <span className="text-emerald-400 font-semibold">₹499/mo</span> subscriber base
              </div>
            </div>

            {/* Free Plan Users */}
            <div className="p-5 bg-slate-900/60 rounded-2xl border border-slate-800/90 hover:border-slate-700/80 transition shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Free Plan Users</span>
                <span className="p-1.5 rounded-lg bg-slate-700/40 text-slate-400 border border-slate-600/30">
                  <UserCheck className="h-4 w-4" />
                </span>
              </div>
              <div className="text-3xl font-black text-slate-300 font-mono">{dashboardStats?.freeUsers ?? totalFreeCount}</div>
              <div className="text-[11px] text-slate-500 mt-1">Standard free tier accounts</div>
            </div>

            {/* Referral Income */}
            <div className="p-5 bg-slate-900/60 rounded-2xl border border-emerald-500/20 hover:border-emerald-500/40 transition shadow-sm bg-gradient-to-br from-emerald-950/20 to-transparent">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-emerald-300 font-bold uppercase tracking-wider">Referral Income</span>
                <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Gift className="h-4 w-4" />
                </span>
              </div>
              <div className="text-3xl font-black text-emerald-400 font-mono">
                ₹{dashboardStats?.referralIncome ?? totalReferralEarnings}
              </div>
              <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                <span className="text-emerald-400 font-semibold">Dynamic payout</span> (Up to ₹300 on ₹499)
              </div>
            </div>

            {/* Total Trades */}
            <div className="p-5 bg-slate-900/60 rounded-2xl border border-slate-800/90 hover:border-slate-700/80 transition shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Total Trades</span>
                <span className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <Activity className="h-4 w-4" />
                </span>
              </div>
              <div className="text-3xl font-black text-cyan-400 font-mono">{dashboardStats?.totalTrades || 0}</div>
              <div className="text-[11px] text-slate-500 mt-1">Logged across all accounts</div>
            </div>

            {/* Total Revenue */}
            <div className="p-5 bg-slate-900/60 rounded-2xl border border-slate-800/90 hover:border-slate-700/80 transition shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Total Revenue</span>
                <span className="p-1.5 rounded-lg bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                  <DollarSign className="h-4 w-4" />
                </span>
              </div>
              <div className="text-3xl font-black text-yellow-400 font-mono">₹{dashboardStats?.totalRevenue || 0}</div>
              <div className="text-[11px] text-slate-500 mt-1">Platform gross subscriptions</div>
            </div>

            {/* Pending Tickets - Admin Only */}
            {!isSubAdmin && (
              <div className="p-5 bg-slate-900/60 rounded-2xl border border-slate-800/90 hover:border-slate-700/80 transition shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Pending Tickets</span>
                  <span className="p-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20">
                    <AlertCircle className="h-4 w-4" />
                  </span>
                </div>
                <div className="text-3xl font-black text-red-400 font-mono">{dashboardStats?.pendingTickets || 0}</div>
                <div className="text-[11px] text-slate-500 mt-1">Awaiting mentor/support review</div>
              </div>
            )}

            {/* Staff & Mentors - Admin Only */}
            {!isSubAdmin && (
              <div className="p-5 bg-slate-900/60 rounded-2xl border border-slate-800/90 hover:border-slate-700/80 transition shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Staff & Mentors</span>
                  <span className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
                    <Shield className="h-4 w-4" />
                  </span>
                </div>
                <div className="text-3xl font-black text-purple-300 font-mono">
                  {team.length > 0 ? team.length : 3}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">Admins, sub-admins & support</div>
              </div>
            )}
          </div>

          {/* User Growth Chart */}
          <div className="p-6 bg-slate-900/60 border border-slate-800/90 rounded-2xl shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">User Growth & Acquisition</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">Cumulative registered traders over time</p>
              </div>
              <span className="text-[11px] px-2.5 py-1 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20 font-semibold">
                Live Analytics
              </span>
            </div>
            {dashboardStats?.userGrowth?.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={dashboardStats.userGrowth} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} stroke="#334155" />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} stroke="#334155" allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: 12, fontSize: 12, color: '#f8fafc' }}
                    labelStyle={{ color: '#94a3b8' }}
                  />
                  <Line type="monotone" dataKey="count" stroke="#8b5cf6" strokeWidth={2.5} dot={{ fill: '#8b5cf6', r: 4 }} activeDot={{ r: 6, fill: '#a78bfa' }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center min-h-[220px] text-slate-500 text-xs">
                <BarChart3 className="h-8 w-8 text-slate-600 mb-2" />
                <span>Tracking platform growth — data registers as users join.</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. USER REGISTRY TAB */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          {/* Top Quick Stats Strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-4 bg-slate-900/70 border border-slate-800/90 rounded-2xl flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Users</span>
                <span className="text-2xl font-black text-white font-mono">{users.length}</span>
              </div>
              <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <Users className="h-4 w-4" />
              </div>
            </div>

            <div className="p-4 bg-slate-900/70 border border-violet-500/20 rounded-2xl flex items-center justify-between bg-gradient-to-br from-violet-950/20 to-transparent">
              <div>
                <span className="text-[10px] font-bold text-violet-300 uppercase tracking-wider block">Paid Users (Pro)</span>
                <span className="text-2xl font-black text-violet-300 font-mono">{totalProCount}</span>
              </div>
              <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Crown className="h-4 w-4" />
              </div>
            </div>

            <div className="p-4 bg-slate-900/70 border border-slate-800/90 rounded-2xl flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Free Plan Users</span>
                <span className="text-2xl font-black text-slate-300 font-mono">{totalFreeCount}</span>
              </div>
              <div className="p-2 rounded-xl bg-slate-700/40 text-slate-400 border border-slate-600/30">
                <UserCheck className="h-4 w-4" />
              </div>
            </div>

            <div className="p-4 bg-slate-900/70 border border-emerald-500/20 rounded-2xl flex items-center justify-between bg-gradient-to-br from-emerald-950/20 to-transparent">
              <div>
                <span className="text-[10px] font-bold text-emerald-300 uppercase tracking-wider block">Referral Income</span>
                <span className="text-2xl font-black text-emerald-400 font-mono">₹{totalReferralEarnings}</span>
              </div>
              <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Gift className="h-4 w-4" />
              </div>
            </div>
          </div>

          {/* Search and Filters Toolbar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 bg-slate-900/60 rounded-2xl border border-slate-800/90">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder={isSubAdmin ? "Search by trader name or referral code..." : "Search by name, email, or referral code..."}
                className="w-full pl-9 pr-4 py-2 bg-slate-800/80 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 transition"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="flex rounded-xl bg-slate-800/80 p-1 border border-slate-700/80 text-xs">
                {(['ALL', 'PRO', 'FREE'] as const).map(filter => (
                  <button
                    key={filter}
                    onClick={() => setPlanFilter(filter)}
                    className={`px-3 py-1 rounded-lg font-semibold transition ${
                      planFilter === filter
                        ? 'bg-violet-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {filter === 'ALL' ? `All (${users.length})` : filter === 'PRO' ? `Pro (${totalProCount})` : `Free (${totalFreeCount})`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* User Table */}
          {/* User Table */}
          <div className="overflow-x-auto bg-[#0a0d17]/80 rounded-2xl border border-white/[0.08] shadow-2xl backdrop-blur-xl">
            <table className="min-w-[1120px] w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/[0.08] text-slate-400 uppercase tracking-wider font-extrabold bg-white/[0.02] text-[10px]">
                  <th className="py-3 px-4 min-w-[210px]">User Details</th>
                  <th className="py-3 px-4 min-w-[130px]">Plan Tier</th>
                  <th className="py-3 px-4 min-w-[150px]">Last Activity</th>
                  <th className="py-3 px-4 min-w-[130px]">Trading Profile</th>
                  <th className="py-3 px-4 text-center min-w-[190px]">Accounts &amp; Trades</th>
                  <th className="py-3 px-4 min-w-[150px]">Referral Info</th>
                  <th className="py-3 px-4 text-center min-w-[110px]">Status</th>
                  <th className="py-3 px-4 text-right min-w-[230px]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-500 font-medium">
                      No matching users found in registry.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-white/[0.025] transition-colors group">
                      {/* User Details */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-white flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-bold text-white tracking-tight">{u.name || 'Trader'}</span>
                          {u.authProvider === 'google' && (
                            <span title="Google Account" className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/[0.06] text-slate-300 border border-white/10 font-bold">
                              G
                            </span>
                          )}
                          {u.role && u.role !== 'USER' && (
                            <span className="text-[9.5px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-violet-500/15 text-violet-300 border border-violet-500/25">
                              {u.role === 'SUPER_ADMIN' ? 'Super Admin' : u.role}
                            </span>
                          )}
                        </div>
                        {!isSubAdmin && (
                          <div className="text-[11px] text-slate-400 font-mono mt-0.5 truncate max-w-[220px]" title={u.email}>
                            {u.email}
                          </div>
                        )}
                      </td>

                      {/* Plan Tier with Super Admin Action */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1.5">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap shadow-xs ${
                            u.isPro 
                              ? 'bg-amber-400/[0.08] text-amber-300 border border-amber-400/25' 
                              : 'bg-slate-800/60 text-slate-400 border border-slate-700/50'
                          }`}>
                            {u.isPro ? <Crown className="h-3 w-3 text-amber-400 fill-amber-400/80 shrink-0" /> : null}
                            {u.isPro ? 'Pro Member' : 'Free Basic'}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {u.isPro ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setGrantProModalUser(u)}
                                  className="text-[10.5px] text-amber-400 hover:text-amber-300 font-semibold hover:underline cursor-pointer"
                                  title="Extend or manage Pro duration"
                                >
                                  Extend Pro
                                </button>
                                <span className="text-slate-600 text-xs">•</span>
                                <button
                                  type="button"
                                  onClick={() => handleToggleUserPlan(u.id, true)}
                                  className="text-[10.5px] text-slate-400 hover:text-red-400 font-medium hover:underline cursor-pointer"
                                  title="Revoke Pro"
                                >
                                  Revoke
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setGrantProModalUser(u)}
                                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/25 text-[11px] font-semibold transition cursor-pointer active:scale-95 shadow-xs"
                                title="Grant Pro access to this user"
                              >
                                <Sparkles className="w-2.5 h-2.5 text-amber-400" />
                                <span>Make Pro</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Last Activity */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="text-slate-200 font-medium text-xs">{formatDateTime(u.lastLogin)}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          Joined: {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'N/A'}
                        </div>
                      </td>

                      {/* Trading Profile */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="text-slate-200 font-medium text-xs">{u.tradingStyle || 'Discretionary'}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">{u.experience || 'Intermediate'}</div>
                      </td>

                      {/* Accounts & Trades Count */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-indigo-500/10 text-indigo-300 text-xs font-semibold whitespace-nowrap">
                            {u.accountsCount || 0} acc
                          </span>
                          <button
                            type="button"
                            onClick={() => onInspectUser?.(u)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 hover:text-emerald-200 border border-emerald-500/20 hover:border-emerald-500/35 text-xs font-semibold transition-all whitespace-nowrap cursor-pointer shadow-xs active:scale-95"
                            title="Click to inspect all trades & journal"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 ring-2 ring-emerald-400/25 shrink-0" />
                            <span>{u.tradesCount || 0} trades</span>
                          </button>
                        </div>
                      </td>

                      {/* Referral Info */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5 text-xs font-mono text-violet-300 bg-violet-500/10 px-2 py-0.5 rounded-lg border border-violet-500/20 whitespace-nowrap">
                          <Gift className="h-3 w-3 text-violet-400 shrink-0" />
                          <span className="font-bold">{u.referralCode || 'FX-100'}</span>
                        </div>
                        <div className="text-[10.5px] text-slate-400 mt-1 flex items-center gap-1.5 whitespace-nowrap">
                          <span>Ref: <strong className="text-white font-semibold">{u.referralCount || 0}</strong></span>
                          <span className="text-slate-600">•</span>
                          <span>Earned: <strong className="text-emerald-400 font-semibold">₹{u.referralIncome || 0}</strong></span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        {u.role === 'PARTNER' && (
                          <span className="mb-1 block mx-auto w-fit px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider bg-violet-500/15 text-violet-300 border border-violet-500/25 whitespace-nowrap">
                            Partner
                          </span>
                        )}
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-extrabold tracking-wider uppercase whitespace-nowrap ${
                          !u.status || u.status === 'ACTIVE' 
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                            : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${(!u.status || u.status === 'ACTIVE') ? 'bg-emerald-400' : 'bg-red-400'}`} />
                          {u.status || 'ACTIVE'}
                        </span>
                      </td>

                      {/* Actions: Analysis Icon on the right side */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                          {/* MENTOR ANALYSIS ICON BUTTON */}
                          <button
                            onClick={() => onInspectUser?.(u)}
                            className="px-3.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm hover:shadow-violet-600/30 hover:scale-[1.02] active:scale-95 shrink-0 border border-violet-400/30 cursor-pointer"
                            title="Inspect User Dashboard & Analysis (Mentor Read-Only Mode)"
                          >
                            <BarChart3 className="h-3.5 w-3.5 text-white" />
                            <span>Analysis</span>
                          </button>

                          {/* Partner role */}
                          {myPermissions.includes('partner.manage') &&
                           !['SUPER_ADMIN', 'ADMIN'].includes(u.role) && (
                            u.role === 'PARTNER' ? (
                              <button
                                onClick={() => handleRemovePartner(u)}
                                disabled={partnerBusy === u.id}
                                title="Remove Partner access"
                                className="text-[11px] font-semibold px-2.5 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] text-slate-300 border border-white/[0.08] transition disabled:opacity-40 cursor-pointer"
                              >
                                Remove Partner
                              </button>
                            ) : (
                              <button
                                onClick={() => handleUpgradeToPartner(u)}
                                disabled={partnerBusy === u.id}
                                title="Make this user a Partner — grants Pro and a referral link"
                                className="text-[11px] font-semibold px-2.5 py-1.5 rounded-xl bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 border border-violet-500/25 transition disabled:opacity-40 cursor-pointer"
                              >
                                {partnerBusy === u.id ? 'Working…' : 'Upgrade to Partner'}
                              </button>
                            )
                          )}

                          {/* Suspend / Reactivate */}
                          {!isSubAdmin && myPermissions.includes('users.manage') && (
                            (!u.status || u.status === 'ACTIVE') ? (
                              <button
                                onClick={() => handleUpdateUserStatus(u.id, 'SUSPENDED')}
                                className="text-[11px] font-semibold px-2.5 py-1.5 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition cursor-pointer"
                              >
                                Suspend
                              </button>
                            ) : (
                              <button
                                onClick={() => handleUpdateUserStatus(u.id, 'ACTIVE')}
                                className="text-[11px] font-semibold px-2.5 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 transition cursor-pointer"
                              >
                                Reactivate
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. SUB-ADMIN CONSOLE TAB */}
      {/* SUB-ADMIN CONSOLE TAB */}
      {activeTab === 'assigned' && (
        <div className="space-y-5">
          <div className="p-5 rounded-2xl bg-gradient-to-r from-violet-950/40 via-purple-900/20 to-slate-900/60 border border-violet-500/30 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-violet-600/20 text-violet-400 border border-violet-500/30">
                  <UserCheck className="h-5 w-5" />
                </span>
                <h3 className="text-base font-extrabold text-white">{isSubAdmin ? 'Partner Console' : 'Sub-Admin Console'}</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 uppercase flex items-center gap-1">
                  <Lock className="h-3 w-3" /> Read only
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1 max-w-2xl">
                {myRole === 'SUB_ADMIN'
                  ? 'The users assigned to you. Open a card to see that trader’s history, analysis, activity and journal. Nothing here can be edited.'
                  : 'Previewing a sub-admin’s view. Pick a sub-admin in Team & Roles to see exactly what they can see.'}
              </p>
            </div>
          </div>
          {/* Partner roster. Answers the three questions an admin actually has
              about the referral programme: who the partners are, how many
              users each brought in, and what each has earned. */}
          {myRole !== 'SUB_ADMIN' && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="p-2 rounded-xl bg-emerald-600/15 text-emerald-400 border border-emerald-500/30">
                    <Users className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-extrabold text-white">Partners</h3>
                    <p className="text-[11px] text-slate-400">
                      Referral income is each student's payment minus the ₹{partnerTotals?.platformFloor ?? 199} platform floor.
                    </p>
                  </div>
                </div>
                {partnerTotals && (
                  <div className="flex items-center gap-5 text-right">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Partners</p>
                      <p className="text-base font-extrabold text-white">{partnerTotals.partners}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Linked users</p>
                      <p className="text-base font-extrabold text-white">{partnerTotals.linkedUsers}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Paid</p>
                      <p className="text-base font-extrabold text-white">{partnerTotals.paidReferrals}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Total payout</p>
                      <p className="text-base font-extrabold text-emerald-400">₹{partnerTotals.referralIncome.toLocaleString('en-IN')}</p>
                    </div>
                  </div>
                )}
              </div>

              {partners.length === 0 ? (
                <p className="px-5 py-8 text-center text-xs text-slate-500">
                  No partners yet. Upgrade a user to Partner from the User Registry.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[640px]">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                        <th className="px-5 py-3 font-bold">Partner</th>
                        <th className="px-4 py-3 font-bold">Code</th>
                        <th className="px-4 py-3 font-bold text-center">Users</th>
                        <th className="px-4 py-3 font-bold text-center">Sharing trades</th>
                        <th className="px-4 py-3 font-bold text-center">Paid</th>
                        <th className="px-5 py-3 font-bold text-right">Referral income</th>
                      </tr>
                    </thead>
                    <tbody>
                      {partners.map((p) => (
                        <tr key={p.id} className="border-b border-slate-800/60 last:border-0">
                          <td className="px-5 py-3">
                            <p className="font-semibold text-slate-200">{p.name}</p>
                            <p className="text-[11px] text-slate-500">{p.email}</p>
                          </td>
                          <td className="px-4 py-3">
                            {p.referralCode
                              ? <span className="font-mono text-[11px] text-violet-300">{p.referralCode}</span>
                              : <span className="text-slate-600">—</span>}
                          </td>
                          <td className="px-4 py-3 text-center font-bold text-slate-200">{p.linkedUsers}</td>
                          {/* Consent is per user, so this is always <= Users. */}
                          <td className="px-4 py-3 text-center text-slate-400">{p.sharingTrades}</td>
                          <td className="px-4 py-3 text-center text-slate-400">{p.paidReferrals}</td>
                          <td className="px-5 py-3 text-right font-extrabold text-emerald-400">
                            ₹{Number(p.referralIncome || 0).toLocaleString('en-IN')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <SubAdminConsole subAdminId={myRole === 'SUB_ADMIN' ? undefined : (assignFor?.id || undefined)} />
          {myRole !== 'SUB_ADMIN' && !assignFor && (
            <p className="text-[11px] text-slate-500">
              No sub-admin selected, so this shows nothing. Open Team &amp; Roles and choose one.
            </p>
          )}
        </div>
      )}

      {activeTab === 'team' && (
        <div className="space-y-6">
          {/* Sub-Admin Header Banner */}
          <div className="p-5 rounded-2xl bg-gradient-to-r from-violet-950/40 via-purple-900/20 to-slate-900/60 border border-violet-500/30 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-violet-600/20 text-violet-400 border border-violet-500/30">
                  <Shield className="h-5 w-5" />
                </span>
                <h3 className="text-base font-extrabold text-white">Team &amp; Roles</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 uppercase">
                  Role Tier System
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1 max-w-2xl">
                Promote staff, and decide which users each sub-admin can see. A sub-admin
                with no assigned users sees nothing at all — assignment is what grants access,
                and the server filters every response by it.
              </p>
            </div>

            {/* Quick Role Assign Form */}
            <form onSubmit={handleUpdateTeamRole} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-2 shrink-0 w-full lg:w-auto">
              <input
                type="email"
                required
                value={roleEmail}
                onChange={(e) => setRoleEmail(e.target.value)}
                placeholder="User email to promote..."
                className="px-3.5 py-2.5 sm:py-2 bg-slate-900/90 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 w-full sm:w-56"
              />
              <select
                value={roleSelect}
                onChange={(e) => setRoleSelect(e.target.value)}
                className="px-3.5 py-2.5 sm:py-2 bg-slate-900/90 border border-slate-700/80 rounded-xl text-xs text-white focus:outline-none focus:border-violet-500 w-full sm:w-auto cursor-pointer"
              >
                <option value="SUB_ADMIN">SUB_ADMIN</option>
                <option value="ADMIN">ADMIN</option>
                <option value="SUPPORT">SUPPORT</option>
                <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                <option value="USER">USER (Remove)</option>
              </select>
              <button
                type="submit"
                disabled={roleSubmitting}
                className="px-4 py-2.5 sm:py-2 bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs rounded-xl transition flex items-center gap-1.5 shadow-sm shrink-0 w-full sm:w-auto justify-center cursor-pointer active:scale-95 disabled:opacity-50"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>Assign Role</span>
              </button>
            </form>
          </div>

          {/* Team Members Directory (Desktop Table: hidden on mobile) */}
          <div className="hidden sm:block overflow-x-auto bg-slate-900/60 rounded-2xl border border-slate-800/90 shadow-sm">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h4 className="font-bold text-xs text-slate-300 uppercase tracking-wider">Active Staff & Sub-Admins</h4>
              <span className="text-[11px] text-slate-500">{team.length} Team Members</span>
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider font-bold bg-slate-900/90">
                  <th className="py-3 px-4">Member Name</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Assigned Role</th>
                  <th className="py-3 px-4">Last Login</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Quick Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {team.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      No custom team roles assigned yet. Promote any registered user above.
                    </td>
                  </tr>
                ) : (
                  team.map((m) => (
                    <tr key={m.id || m.email} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4 font-bold text-white">{m.name || 'Staff Member'}</td>
                      <td className="py-3 px-4 font-mono text-slate-400">{m.email}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2.5 py-0.5 rounded-full font-extrabold text-[10px] tracking-wide uppercase ${
                          m.role === 'SUPER_ADMIN' ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' :
                          m.role === 'ADMIN' ? 'bg-blue-500/15 text-blue-300 border border-blue-500/30' :
                          m.role === 'SUB_ADMIN' ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30' :
                          'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                        }`}>
                          {m.role}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-400">{formatDateTime(m.lastLogin)}</td>
                      <td className="py-3 px-4 text-center">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400">
                          {m.status || 'ACTIVE'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {m.role === 'SUB_ADMIN' && (
                          <button
                            onClick={() => openAssignFor({ id: m.id, email: m.email })}
                            className={`text-[11px] font-semibold px-2 py-1 rounded transition mr-1 ${
                              assignFor?.id === m.id
                                ? 'bg-violet-600/25 text-violet-200'
                                : 'text-violet-400 hover:text-violet-300 hover:bg-violet-500/10'
                            }`}
                          >
                            Assigned Users
                          </button>
                        )}
                        {m.role !== 'SUPER_ADMIN' && (
                          <button
                            onClick={async () => {
                              if (confirm(`Remove staff privileges from ${m.email}?`)) {
                                await fetch('/api/admin/team/role', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                                  body: JSON.stringify({ email: m.email, role: 'USER' })
                                });
                                fetchData();
                              }
                            }}
                            className="text-[11px] text-red-400 hover:text-red-300 font-semibold px-2 py-1 rounded hover:bg-red-500/10 transition"
                          >
                            Remove Role
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Team Members Directory (Mobile Cards: sm:hidden) */}
          <div className="sm:hidden flex flex-col gap-2.5">
            <div className="flex items-center justify-between px-1">
              <h4 className="font-bold text-xs text-slate-300 uppercase tracking-wider">Active Staff &amp; Sub-Admins</h4>
              <span className="text-[11px] text-slate-500">{team.length} Members</span>
            </div>

            {team.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-center text-xs text-slate-500">
                No custom team roles assigned yet. Promote any registered user above.
              </div>
            ) : (
              team.map((m) => (
                <div key={m.id || m.email} className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-white truncate">{m.name || 'Staff Member'}</div>
                      <div className="font-mono text-xs text-slate-400 truncate">{m.email}</div>
                    </div>
                    <span className={`shrink-0 px-2.5 py-0.5 rounded-full font-extrabold text-[10px] tracking-wide uppercase ${
                      m.role === 'SUPER_ADMIN' ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' :
                      m.role === 'ADMIN' ? 'bg-blue-500/15 text-blue-300 border border-blue-500/30' :
                      m.role === 'SUB_ADMIN' ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30' :
                      'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    }`}>
                      {m.role}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] pt-2 border-t border-slate-800/80 text-slate-400">
                    <div>
                      <span>Last Login: </span>
                      <span className="text-slate-300 font-medium">{formatDateTime(m.lastLogin)}</span>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[9.5px] font-bold bg-emerald-500/10 text-emerald-400">
                      {m.status || 'ACTIVE'}
                    </span>
                  </div>

                  {(m.role === 'SUB_ADMIN' || m.role !== 'SUPER_ADMIN') && (
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                      {m.role === 'SUB_ADMIN' && (
                        <button
                          type="button"
                          onClick={() => openAssignFor({ id: m.id, email: m.email })}
                          className={`flex-1 text-xs font-semibold py-1.5 px-3 rounded-lg transition text-center ${
                            assignFor?.id === m.id
                              ? 'bg-violet-600/25 text-violet-200 border border-violet-500/30'
                              : 'text-violet-400 hover:text-violet-300 bg-violet-500/10 hover:bg-violet-500/20'
                          }`}
                        >
                          Assigned Users
                        </button>
                      )}
                      {m.role !== 'SUPER_ADMIN' && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (confirm(`Remove staff privileges from ${m.email}?`)) {
                              await fetch('/api/admin/team/role', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                                body: JSON.stringify({ email: m.email, role: 'USER' })
                              });
                              fetchData();
                            }
                          }}
                          className="text-xs text-red-400 hover:text-red-300 font-semibold py-1.5 px-3 rounded-lg bg-red-500/10 hover:bg-red-500/20 transition"
                        >
                          Remove Role
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Assigned users for the selected sub-admin */}
          {assignFor && (
            <div className="p-5 bg-slate-900/60 border border-violet-500/25 rounded-2xl">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <h4 className="font-bold text-xs text-slate-300 uppercase tracking-wider">Users assigned to</h4>
                  <p className="text-sm font-bold text-white font-mono">{assignFor.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveTab('assigned')}
                    className="text-[11px] font-bold text-violet-300 bg-violet-600/15 border border-violet-500/30 rounded-lg px-3 py-1.5 hover:bg-violet-600/25 transition"
                  >
                    Preview their console
                  </button>
                  <button
                    onClick={() => setAssignFor(null)}
                    className="text-[11px] font-semibold text-slate-400 hover:text-slate-200 px-2 py-1.5"
                  >
                    Close
                  </button>
                </div>
              </div>

              <form onSubmit={handleAssignUser} className="flex flex-col sm:flex-row gap-2 mb-4">
                <input
                  type="email"
                  required
                  value={assignEmail}
                  onChange={(e) => setAssignEmail(e.target.value)}
                  placeholder="Email of the user to assign…"
                  className="flex-1 px-3 py-2 bg-slate-900/90 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
                />
                <button
                  type="submit"
                  disabled={assignBusy}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white font-bold text-xs rounded-xl transition flex items-center gap-1.5 justify-center"
                >
                  <Plus className="h-3.5 w-3.5" /> Assign
                </button>
              </form>

              {assignError && (
                <p className="text-[11px] text-red-400 mb-3 flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" /> {assignError}
                </p>
              )}

              {assignedUsers.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center border border-dashed border-slate-800 rounded-xl">
                  No users assigned yet — this sub-admin currently sees nothing.
                </p>
              ) : (
                <ul className="divide-y divide-slate-800/70 border border-slate-800/80 rounded-xl overflow-hidden">
                  {assignedUsers.map((u) => (
                    <li key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5 bg-slate-900/40">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white truncate">{u.name || u.email}</p>
                        <p className="text-[11px] text-slate-500 font-mono truncate">{u.email}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                          u.isPro
                            ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}>
                          {u.isPro ? 'PREMIUM' : 'FREE'}
                        </span>
                        <button
                          onClick={() => handleUnassignUser(u.id)}
                          disabled={assignBusy}
                          className="text-[11px] text-red-400 hover:text-red-300 font-semibold px-2 py-1 rounded hover:bg-red-500/10 transition"
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Granular Permissions Matrix */}
          <div className="p-6 bg-slate-900/60 border border-slate-800/90 rounded-2xl shadow-sm">
            <h4 className="font-bold text-xs text-slate-300 uppercase tracking-wider mb-2">Role Permissions Matrix</h4>
            <p className="text-xs text-slate-500 mb-4">
              Read straight from the server's own permission table, so this cannot drift out of
              date. A sub-admin's user access is additionally narrowed to their assigned users.
            </p>

            {Object.keys(rolePermissions).length > 0 && (
              <div className="overflow-x-auto mb-8">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 uppercase font-bold">
                      <th className="py-2.5 px-3">Capability</th>
                      {['SUPER_ADMIN', 'ADMIN', 'SUB_ADMIN', 'SUPPORT'].map((r) => (
                        <th key={r} className={`py-2.5 px-3 text-center ${
                          r === 'SUPER_ADMIN' ? 'text-amber-400' :
                          r === 'ADMIN' ? 'text-blue-400' :
                          r === 'SUB_ADMIN' ? 'text-purple-400 font-extrabold' : 'text-emerald-400'
                        }`}>{r}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300">
                    {Array.from(new Set(Object.values(rolePermissions).flat())).sort().map((perm) => (
                      <tr key={perm}>
                        <td className="py-2.5 px-3 font-semibold font-mono text-[11px]">{perm}</td>
                        {['SUPER_ADMIN', 'ADMIN', 'SUB_ADMIN', 'SUPPORT'].map((r) => (
                          <td key={r} className="py-2.5 px-3 text-center">
                            {(rolePermissions[r] || []).includes(perm)
                              ? <Check className="h-4 w-4 mx-auto text-emerald-400" />
                              : <X className="h-4 w-4 mx-auto text-slate-600" />}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h4 className="font-bold text-xs text-slate-300 uppercase tracking-wider mb-4">In plain English</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase font-bold">
                    <th className="py-2.5 px-3">Capability / Access</th>
                    <th className="py-2.5 px-3 text-center text-amber-400">SUPER_ADMIN</th>
                    <th className="py-2.5 px-3 text-center text-blue-400">ADMIN</th>
                    <th className="py-2.5 px-3 text-center text-purple-400 font-extrabold">SUB_ADMIN</th>
                    <th className="py-2.5 px-3 text-center text-emerald-400">SUPPORT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  <tr>
                    <td className="py-2.5 px-3 font-semibold">
                      User Registry &amp; Search
                      <span className="block text-[10px] font-normal text-slate-500">Sub-admin: assigned users only</span>
                    </td>
                    <td className="py-2.5 px-3 text-center text-emerald-400"><Check className="h-4 w-4 mx-auto" /></td>
                    <td className="py-2.5 px-3 text-center text-emerald-400"><Check className="h-4 w-4 mx-auto" /></td>
                    <td className="py-2.5 px-3 text-center text-emerald-400 font-bold"><Check className="h-4 w-4 mx-auto" /></td>
                    <td className="py-2.5 px-3 text-center text-emerald-400"><Check className="h-4 w-4 mx-auto" /></td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-semibold">Mentor Read-Only Dashboard Inspection</td>
                    <td className="py-2.5 px-3 text-center text-emerald-400"><Check className="h-4 w-4 mx-auto" /></td>
                    <td className="py-2.5 px-3 text-center text-emerald-400"><Check className="h-4 w-4 mx-auto" /></td>
                    <td className="py-2.5 px-3 text-center text-emerald-400 font-bold"><Check className="h-4 w-4 mx-auto" /></td>
                    <td className="py-2.5 px-3 text-center text-emerald-400"><Check className="h-4 w-4 mx-auto" /></td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-semibold">Support Tickets Management</td>
                    <td className="py-2.5 px-3 text-center text-emerald-400"><Check className="h-4 w-4 mx-auto" /></td>
                    <td className="py-2.5 px-3 text-center text-emerald-400"><Check className="h-4 w-4 mx-auto" /></td>
                    <td className="py-2.5 px-3 text-center text-emerald-400 font-bold"><Check className="h-4 w-4 mx-auto" /></td>
                    <td className="py-2.5 px-3 text-center text-emerald-400"><Check className="h-4 w-4 mx-auto" /></td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-semibold">
                      Global Broadcast Announcements
                      <span className="block text-[10px] font-normal text-slate-500">A broadcast is not a scoped power</span>
                    </td>
                    <td className="py-2.5 px-3 text-center text-emerald-400"><Check className="h-4 w-4 mx-auto" /></td>
                    <td className="py-2.5 px-3 text-center text-emerald-400"><Check className="h-4 w-4 mx-auto" /></td>
                    <td className="py-2.5 px-3 text-center text-slate-600"><X className="h-4 w-4 mx-auto" /></td>
                    <td className="py-2.5 px-3 text-center text-slate-600"><X className="h-4 w-4 mx-auto" /></td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-semibold">User Account Suspension & Plan Granting</td>
                    <td className="py-2.5 px-3 text-center text-emerald-400"><Check className="h-4 w-4 mx-auto" /></td>
                    <td className="py-2.5 px-3 text-center text-emerald-400"><Check className="h-4 w-4 mx-auto" /></td>
                    <td className="py-2.5 px-3 text-center text-slate-600"><X className="h-4 w-4 mx-auto" /></td>
                    <td className="py-2.5 px-3 text-center text-slate-600"><X className="h-4 w-4 mx-auto" /></td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-semibold">Billing Telemetry & MRR Access</td>
                    <td className="py-2.5 px-3 text-center text-emerald-400"><Check className="h-4 w-4 mx-auto" /></td>
                    <td className="py-2.5 px-3 text-center text-slate-600"><X className="h-4 w-4 mx-auto" /></td>
                    <td className="py-2.5 px-3 text-center text-slate-600"><X className="h-4 w-4 mx-auto" /></td>
                    <td className="py-2.5 px-3 text-center text-slate-600"><X className="h-4 w-4 mx-auto" /></td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-semibold">Role Promotion & Owner Demotion</td>
                    <td className="py-2.5 px-3 text-center text-emerald-400"><Check className="h-4 w-4 mx-auto" /></td>
                    <td className="py-2.5 px-3 text-center text-slate-600"><X className="h-4 w-4 mx-auto" /></td>
                    <td className="py-2.5 px-3 text-center text-slate-600"><X className="h-4 w-4 mx-auto" /></td>
                    <td className="py-2.5 px-3 text-center text-slate-600"><X className="h-4 w-4 mx-auto" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 4. BILLING & PAYMENTS TAB */}
      {activeTab === 'billing' && (
        <div className="space-y-6">
          {/* Payment Gateway Integration Telemetry Card */}
          <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-violet-950/30 to-slate-900 border border-violet-500/30 shadow-xl flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="p-2 rounded-xl bg-violet-600/20 text-violet-300 border border-violet-500/30">
                  <CreditCard className="h-5 w-5" />
                </span>
                <h3 className="text-base font-extrabold text-white tracking-tight">Payment Gateway Integration</h3>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  Razorpay PG API Active
                </span>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
                  Monthly Pro ₹499/mo
                </span>
              </div>

              <p className="text-xs text-slate-300">
                Live billing powered by Razorpay. Pro is sold as a 30-day pass: UPI (Google Pay, PhonePe, Paytm), Credit/Debit Cards and NetBanking, with every payment confirmed against Razorpay and a signed webhook.
              </p>

              {/* Webhook Endpoint Strip */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
                <span className="text-[11px] text-slate-400 font-semibold shrink-0">Incoming Webhook URL:</span>
                <div className="flex items-center gap-2 bg-slate-950/80 px-3 py-1.5 rounded-xl border border-slate-800 font-mono text-[11px] text-violet-300 max-w-full overflow-hidden">
                  <span className="truncate">{typeof window !== 'undefined' ? `${window.location.origin}/api/payments/webhook` : '/api/payments/webhook'}</span>
                  <button
                    onClick={copyWebhookUrl}
                    className="text-slate-400 hover:text-white transition shrink-0 p-1 hover:bg-slate-800 rounded"
                    title="Copy Webhook Endpoint URL"
                  >
                    {copiedWebhook ? <CheckCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                {copiedWebhook && <span className="text-[11px] text-emerald-400 font-bold">Copied!</span>}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <button
                onClick={() => setShowRecordPaymentModal(true)}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs flex items-center gap-2 transition shadow-lg shadow-emerald-600/20 hover:scale-105 active:scale-95 cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>Record Offline / UPI Payment</span>
              </button>
            </div>
          </div>

          {/* 5 Financial & User KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {/* Total Revenue */}
            <div className="p-5 bg-slate-900/60 rounded-2xl border border-slate-800 hover:border-slate-700 transition">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Gross Platform Revenue</span>
                <span className="p-1.5 rounded-lg bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                  <DollarSign className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="text-2xl font-black text-yellow-400 font-mono">
                {/* No `|| totalProCount * 399` tail: it invented revenue for a
                    platform with no payments, at a price that has not applied
                    since Pro became ₹499. The server now reports captured
                    payments, and 0 is the honest answer when there are none. */}
                ₹{billingData?.totalRevenue ?? dashboardStats?.totalRevenue ?? 0}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">Platform gross subscriptions</div>
            </div>

            {/* Monthly Recurring Revenue */}
            <div className="p-5 bg-slate-900/60 rounded-2xl border border-emerald-500/20 hover:border-emerald-500/40 transition bg-gradient-to-br from-emerald-950/20 to-transparent">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-emerald-300 font-bold uppercase tracking-wider">Monthly MRR</span>
                <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <TrendingUp className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="text-2xl font-black text-emerald-400 font-mono">
                ₹{billingData?.mrr ?? (totalProCount * PRO_PRICE_INR)}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">Active monthly run-rate</div>
            </div>

            {/* Paid Users (Pro) */}
            <div className="p-5 bg-slate-900/60 rounded-2xl border border-violet-500/20 hover:border-violet-500/40 transition bg-gradient-to-br from-violet-950/20 to-transparent">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-violet-300 font-bold uppercase tracking-wider">Paid Subscribers</span>
                <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <Crown className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="text-2xl font-black text-violet-300 font-mono">
                {billingData?.activeCount ?? totalProCount}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">Paying ₹{PRO_PRICE_INR}/mo Pro tier</div>
            </div>

            {/* Free Plan Users */}
            <div className="p-5 bg-slate-900/60 rounded-2xl border border-slate-800 hover:border-slate-700 transition">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Free Plan Users</span>
                <span className="p-1.5 rounded-lg bg-slate-700/40 text-slate-400 border border-slate-600/30">
                  <UserCheck className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="text-2xl font-black text-slate-300 font-mono">
                {billingData?.freeCount ?? totalFreeCount}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">Upgrade pipeline opportunity</div>
            </div>

            {/* Referral Commission */}
            <div className="p-5 bg-slate-900/60 rounded-2xl border border-purple-500/20 hover:border-purple-500/40 transition bg-gradient-to-br from-purple-950/20 to-transparent">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-purple-300 font-bold uppercase tracking-wider">Referral Income</span>
                <span className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  <Gift className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="text-2xl font-black text-purple-300 font-mono">
                ₹{billingData?.totalReferralIncome ?? totalReferralEarnings}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">60% commission (₹300 / sub)</div>
            </div>
          </div>

          {/* Referral Program Telemetry & Top Referrers */}
          <div className="bg-slate-900/60 rounded-2xl border border-slate-800/90 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div>
                <h4 className="font-extrabold text-xs text-white uppercase tracking-wider flex items-center gap-2">
                  <Gift className="h-4 w-4 text-purple-400" />
                  Affiliate & Referral Partner Telemetry
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Mentors & Partners receive 60% monthly commission (₹300 on ₹500 payment) for each trader they introduce who maintains an active Pro plan.
                </p>
              </div>
              <span className="text-[11px] px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20 font-mono font-bold self-start sm:self-auto">
                Commission: 60% (₹300 / Pro sub)
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider font-bold bg-slate-900/90">
                    <th className="py-2.5 px-4">Partner Name & Email</th>
                    <th className="py-2.5 px-4">Referral Code</th>
                    <th className="py-2.5 px-4 text-center">Total Referred</th>
                    <th className="py-2.5 px-4 text-center">Active Pro Subscribers</th>
                    <th className="py-2.5 px-4 text-right">Accumulated Earnings</th>
                    <th className="py-2.5 px-4 text-center">Payout Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {(!billingData?.referralLeaderboard || billingData.referralLeaderboard.length === 0) ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-500">
                        No active referrers recorded yet. User referral links automatically register when friends sign up.
                      </td>
                    </tr>
                  ) : (
                    billingData.referralLeaderboard.map((ref: any) => (
                      <tr key={ref.userId || ref.referralCode} className="hover:bg-slate-800/40 transition">
                        <td className="py-3 px-4">
                          <div className="font-bold text-white">{ref.name}</div>
                          <div className="text-[11px] text-slate-400 font-mono">{ref.email}</div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded font-mono font-bold bg-violet-500/10 text-violet-300 border border-violet-500/20">
                            {ref.referralCode}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center font-bold text-slate-200">{ref.referralsCount} users</td>
                        <td className="py-3 px-4 text-center">
                          <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold">
                            {ref.paidReferralsCount} Pro
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-black text-emerald-400">₹{ref.referralIncome}</td>
                        <td className="py-3 px-4 text-center">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase">
                            Active
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Partner Withdrawal & Payout Requests ───────────────────────── */}
          <div className="bg-slate-900/60 rounded-2xl border border-slate-800 overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-emerald-400" />
                  <h4 className="font-bold text-xs text-white uppercase tracking-wider">
                    Partner Withdrawal & Payout Requests
                  </h4>
                  {adminPayouts.filter((p: any) => p.status === 'PENDING').length > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 animate-pulse">
                      {adminPayouts.filter((p: any) => p.status === 'PENDING').length} Pending
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Process affiliate commission settlements directly to partner UPI IDs or Bank Accounts.
                </p>
              </div>

              {/* Status Filter Pills */}
              <div className="flex items-center gap-1.5 p-1 bg-slate-950/80 rounded-xl border border-slate-800 self-start md:self-auto overflow-x-auto">
                {(['ALL', 'PENDING', 'PAID', 'REJECTED'] as const).map((st) => (
                  <button
                    key={st}
                    onClick={() => setPayoutFilter(st)}
                    className={`px-3 py-1 rounded-lg text-[11px] font-bold transition whitespace-nowrap ${
                      payoutFilter === st
                        ? 'bg-violet-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {st === 'ALL' ? 'All' : st === 'PENDING' ? 'Pending' : st === 'PAID' ? 'Paid' : 'Rejected'}
                    {st === 'PENDING' && adminPayouts.filter((p: any) => p.status === 'PENDING').length > 0 && (
                      <span className="ml-1.5 px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 font-mono text-[9px]">
                        {adminPayouts.filter((p: any) => p.status === 'PENDING').length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Payouts Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider font-bold bg-slate-950/60">
                    <th className="py-2.5 px-4">Partner</th>
                    <th className="py-2.5 px-4 text-right">Amount</th>
                    <th className="py-2.5 px-4">Payout Method & Details</th>
                    <th className="py-2.5 px-4">Requested At</th>
                    <th className="py-2.5 px-4 text-center">Status</th>
                    <th className="py-2.5 px-4 text-center">Actions / Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {adminPayouts
                    .filter((p: any) => (payoutFilter === 'ALL' ? true : p.status === payoutFilter))
                    .length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        No withdrawal requests found for this filter.
                      </td>
                    </tr>
                  ) : (
                    adminPayouts
                      .filter((p: any) => (payoutFilter === 'ALL' ? true : p.status === payoutFilter))
                      .map((req: any) => (
                        <tr key={req.id} className="hover:bg-slate-800/40 transition">
                          <td className="py-3 px-4">
                            <div className="font-bold text-white">{req.partnerName}</div>
                            <div className="text-[11px] text-slate-400 font-mono">{req.partnerEmail}</div>
                            {req.partnerCode && (
                              <span className="inline-block mt-0.5 px-1.5 py-0.2 text-[10px] font-mono font-bold rounded bg-violet-500/10 text-violet-300 border border-violet-500/20">
                                {req.partnerCode}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-black text-emerald-400 whitespace-nowrap">
                            ₹{req.amount?.toLocaleString()}
                          </td>
                          <td className="py-3 px-4">
                            {req.method === 'UPI' ? (
                              <div className="flex items-center gap-1.5">
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-500/15 text-violet-300 border border-violet-500/20">
                                  UPI
                                </span>
                                <span className="font-mono text-white text-[11px] font-semibold">
                                  {req.payoutDetails?.upiId}
                                </span>
                                <button
                                  onClick={() => {
                                    if (req.payoutDetails?.upiId) {
                                      navigator.clipboard.writeText(req.payoutDetails.upiId);
                                      setCopiedDetail(req.id);
                                      setTimeout(() => setCopiedDetail(null), 1800);
                                    }
                                  }}
                                  className="text-slate-400 hover:text-white p-1 rounded transition"
                                  title="Copy UPI ID"
                                >
                                  {copiedDetail === req.id ? (
                                    <Check className="h-3 w-3 text-emerald-400" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </button>
                              </div>
                            ) : (
                              <div className="text-[11px] space-y-0.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/15 text-blue-300 border border-blue-500/20">
                                    BANK
                                  </span>
                                  <span className="font-semibold text-white">
                                    {req.payoutDetails?.accountHolderName}
                                  </span>
                                </div>
                                <div className="font-mono text-slate-400 text-[10px]">
                                  A/C: {req.payoutDetails?.accountNumber} | IFSC: {req.payoutDetails?.ifsc}
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-400 whitespace-nowrap text-[11px]">
                            {new Date(req.requestedAt).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="py-3 px-4 text-center whitespace-nowrap">
                            {req.status === 'PAID' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                                Paid & Completed
                              </span>
                            )}
                            {req.status === 'PENDING' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/25">
                                Pending Action
                              </span>
                            )}
                            {req.status === 'REJECTED' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/25">
                                Rejected
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center whitespace-nowrap">
                            {req.status === 'PENDING' ? (
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => {
                                    setSelectedPayout(req);
                                    setProcessModalAction('PAID');
                                    setPayoutUtrInput('');
                                    setPayoutNotesInput('');
                                  }}
                                  className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition shadow-sm cursor-pointer"
                                >
                                  Mark as Paid
                                </button>
                                <button
                                  onClick={() => {
                                    setSelectedPayout(req);
                                    setProcessModalAction('REJECTED');
                                    setPayoutUtrInput('');
                                    setPayoutNotesInput('');
                                  }}
                                  className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-red-500/40 text-red-300 hover:bg-red-500/20 transition cursor-pointer"
                                >
                                  Reject
                                </button>
                              </div>
                            ) : req.status === 'PAID' ? (
                              <div className="text-[11px] font-mono text-slate-300">
                                {req.utrNumber ? (
                                  <span className="px-2 py-0.5 rounded bg-slate-800 text-emerald-300 border border-slate-700">
                                    UTR: {req.utrNumber}
                                  </span>
                                ) : (
                                  <span>Processed</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[11px] text-red-400/90 italic">
                                {req.adminNotes || 'Rejected'}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Modal for processing payout */}
          {selectedPayout && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Wallet className="h-5 w-5 text-violet-400" />
                    {processModalAction === 'PAID' ? 'Confirm Payout Transfer' : 'Reject Payout Request'}
                  </h3>
                  <button
                    onClick={() => setSelectedPayout(null)}
                    className="text-slate-400 hover:text-white font-bold text-lg"
                  >
                    ✕
                  </button>
                </div>

                <div className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Partner:</span>
                    <span className="font-bold text-white">{selectedPayout.partnerName} ({selectedPayout.partnerEmail})</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Payout Amount:</span>
                    <span className="font-mono font-black text-emerald-400 text-sm">₹{selectedPayout.amount?.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center pt-1 border-t border-slate-800/80">
                    <span className="text-slate-400">Destination:</span>
                    {selectedPayout.method === 'UPI' ? (
                      <span className="font-mono font-bold text-violet-300">
                        UPI: {selectedPayout.payoutDetails?.upiId}
                      </span>
                    ) : (
                      <span className="font-mono text-blue-300">
                        A/C: {selectedPayout.payoutDetails?.accountNumber} ({selectedPayout.payoutDetails?.ifsc})
                      </span>
                    )}
                  </div>
                </div>

                {processModalAction === 'PAID' ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                        UTR / Transaction Reference Number
                      </label>
                      <input
                        type="text"
                        value={payoutUtrInput}
                        onChange={(e) => setPayoutUtrInput(e.target.value)}
                        placeholder="e.g. UPI/423985729103 or IMPS reference"
                        className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none"
                        required
                        autoFocus
                      />
                      <p className="text-[10px] text-slate-500 mt-1">
                        Enter the transaction reference from Google Pay, PhonePe, or your bank portal.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                        Internal Note (Optional)
                      </label>
                      <input
                        type="text"
                        value={payoutNotesInput}
                        onChange={(e) => setPayoutNotesInput(e.target.value)}
                        placeholder="Optional remarks"
                        className="w-full bg-slate-950 border border-slate-700 focus:border-slate-500 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none"
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                      Rejection Reason (Visible to Partner)
                    </label>
                    <textarea
                      value={payoutNotesInput}
                      onChange={(e) => setPayoutNotesInput(e.target.value)}
                      placeholder="e.g. Invalid UPI ID, please update your details in Payout Settings and re-request."
                      className="w-full bg-slate-950 border border-slate-700 focus:border-red-500 rounded-xl p-3 text-xs text-white focus:outline-none h-24"
                      required
                      autoFocus
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      Rejecting will return the amount back to the partner's available withdrawal balance.
                    </p>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setSelectedPayout(null)}
                    className="px-4 py-2 rounded-xl border border-slate-700 text-xs font-bold text-slate-300 hover:bg-slate-800 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={processingPayout || (processModalAction === 'PAID' && !payoutUtrInput.trim()) || (processModalAction === 'REJECTED' && !payoutNotesInput.trim())}
                    onClick={async () => {
                      if (!selectedPayout) return;
                      setProcessingPayout(true);
                      try {
                        const res = await fetch(`/api/admin/payouts/${selectedPayout.id}/process`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                          body: JSON.stringify({
                            action: processModalAction,
                            utrNumber: payoutUtrInput.trim(),
                            adminNotes: payoutNotesInput.trim(),
                          }),
                        });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error || 'Failed to process payout.');
                        setSelectedPayout(null);
                        setPayoutUtrInput('');
                        setPayoutNotesInput('');
                        fetchData();
                      } catch (err: any) {
                        alert(err.message || 'Error processing payout');
                      } finally {
                        setProcessingPayout(false);
                      }
                    }}
                    className={`px-4 py-2 rounded-xl text-xs font-bold text-white transition flex items-center gap-1.5 cursor-pointer shadow-sm ${
                      processModalAction === 'PAID'
                        ? 'bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40'
                        : 'bg-red-600 hover:bg-red-500 disabled:opacity-40'
                    }`}
                  >
                    {processingPayout ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Processing…
                      </>
                    ) : processModalAction === 'PAID' ? (
                      'Confirm & Mark Paid'
                    ) : (
                      'Confirm Rejection'
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Transactions Table with Search & Status Filters */}
          <div className="overflow-x-auto bg-slate-900/60 rounded-2xl border border-slate-800">
            <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="font-bold text-xs text-slate-300 uppercase tracking-wider">Payment & Subscription Transactions</h4>
                <p className="text-[11px] text-slate-500 mt-0.5">Verified gateway charges and manual payment receipts</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                  <input
                    type="text"
                    value={billingSearch}
                    onChange={(e) => setBillingSearch(e.target.value)}
                    placeholder="Search transactions..."
                    className="pl-8 pr-3 py-1.5 bg-slate-800/80 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 w-48"
                  />
                </div>

                {/* Status Filter */}
                <div className="flex rounded-xl bg-slate-800/80 p-1 border border-slate-700/80 text-xs">
                  {(['ALL', 'captured', 'pending', 'failed'] as const).map((st) => (
                    <button
                      key={st}
                      onClick={() => setPaymentStatusFilter(st)}
                      className={`px-2.5 py-0.5 rounded-lg font-semibold transition capitalize ${
                        paymentStatusFilter === st
                          ? 'bg-violet-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider font-bold bg-slate-900/90">
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Payment ID / Ref</th>
                  <th className="py-3 px-4">Plan Tier</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">Method</th>
                  <th className="py-3 px-4 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {(() => {
                  const filtered = (billingData?.payments || []).filter((p: any) => {
                    const matchesSearch = !billingSearch ||
                      (p.userEmail || '').toLowerCase().includes(billingSearch.toLowerCase()) ||
                      (p.id || '').toLowerCase().includes(billingSearch.toLowerCase()) ||
                      (p.userName || '').toLowerCase().includes(billingSearch.toLowerCase());
                    const matchesStatus = paymentStatusFilter === 'ALL' || (p.status || '').toLowerCase() === paymentStatusFilter.toLowerCase();
                    return matchesSearch && matchesStatus;
                  });

                  if (filtered.length === 0) {
                    return (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-500">
                          No transactions match your search criteria.
                        </td>
                      </tr>
                    );
                  }

                  return filtered.map((p: any) => {
                    // Amounts are stored in rupees. The old `> 1000 ? / 100`
                    // guess divided any genuine payment over ₹1,000 by a
                    // hundred, and `: 399` showed money for a row that had none.
                    const amt = Number(p.amount) || 0;
                    return (
                      <tr key={p.id} className="hover:bg-slate-800/40 transition">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-white">{p.userName || p.userEmail?.split('@')[0] || 'Subscriber'}</div>
                          <div className="text-[11px] text-slate-400 font-mono">{p.userEmail || 'Unknown account'}</div>
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-400">{p.id}</td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded bg-violet-500/10 text-violet-300 font-semibold text-[10px]">
                            {p.plan === 'pro' || !p.plan ? 'Pro Monthly' : p.plan}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-emerald-400">₹{amt}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            p.status === 'captured' || p.status === 'paid'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : p.status === 'pending'
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              : 'bg-red-500/10 text-red-400 border border-red-500/20'
                          }`}>
                            {p.status || 'captured'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px] uppercase">
                            {p.method || p.provider || 'UPI'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right text-slate-400">{formatDateTime(p.paidAt || p.createdAt)}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>

          {/* Record Offline / UPI Payment Modal */}
          {showRecordPaymentModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <Wallet className="h-4 w-4" />
                    </span>
                    <h3 className="font-extrabold text-sm text-white">Record Offline / Direct UPI Payment</h3>
                  </div>
                  <button
                    onClick={() => setShowRecordPaymentModal(false)}
                    className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <p className="text-xs text-slate-400">
                  Record a direct GPay, PhonePe, Paytm, or bank transfer payment made by a student/trader. This immediately activates their Pro membership and creates a permanent payment receipt in the audit log.
                </p>

                <form onSubmit={handleRecordPayment} className="space-y-3.5">
                  <div>
                    <label className="text-[11px] font-bold text-slate-300 block mb-1">Trader Email *</label>
                    <input
                      type="email"
                      required
                      value={recordEmail}
                      onChange={(e) => setRecordEmail(e.target.value)}
                      placeholder="trader@example.com"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-bold text-slate-300 block mb-1">Amount (INR ₹)</label>
                      <input
                        type="number"
                        required
                        value={recordAmount}
                        onChange={(e) => setRecordAmount(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-violet-500 font-mono"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-bold text-slate-300 block mb-1">Duration</label>
                      <select
                        value={recordDays}
                        onChange={(e) => setRecordDays(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-violet-500"
                      >
                        <option value="30">30 Days (1 Month)</option>
                        <option value="60">60 Days (2 Months)</option>
                        <option value="90">90 Days (Quarterly)</option>
                        <option value="180">180 Days (Half Year)</option>
                        <option value="365">365 Days (1 Year)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-300 block mb-1">Payment Method</label>
                    <select
                      value={recordMethod}
                      onChange={(e) => setRecordMethod(e.target.value as any)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-violet-500"
                    >
                      <option value="upi">Direct UPI (Google Pay, PhonePe, Paytm)</option>
                      <option value="bank_transfer">Bank Transfer (IMPS / NEFT)</option>
                      <option value="card">Card / POS</option>
                      <option value="cash">Cash / In-Person</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-300 block mb-1">Notes / UPI Reference ID</label>
                    <input
                      type="text"
                      value={recordNotes}
                      onChange={(e) => setRecordNotes(e.target.value)}
                      placeholder="e.g. UTR 4293819283 / GPay confirmation"
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => setShowRecordPaymentModal(false)}
                      className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={recordSubmitting}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-emerald-600/30 disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>{recordSubmitting ? 'Recording...' : 'Record Payment & Activate Pro'}</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 5. AUDIT TRAIL TAB */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="overflow-x-auto bg-slate-900/60 rounded-2xl border border-slate-800">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h4 className="font-bold text-xs text-slate-300 uppercase tracking-wider">Admin Action Audit Trail</h4>
                <p className="text-[11px] text-slate-500 mt-0.5">Durable, tamper-proof logs of administrative events</p>
              </div>
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider font-bold bg-slate-900/90">
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Target</th>
                  <th className="py-3 px-4">Details</th>
                  <th className="py-3 px-4 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      No administrative actions logged yet.
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log: any) => (
                    <tr key={log.id} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-white">{log.actorEmail || 'System'}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{log.actorRole || 'SUPER_ADMIN'}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-mono text-violet-300 font-semibold bg-violet-500/10 px-2 py-0.5 rounded text-[11px]">
                          {log.action}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">
                        {log.targetType}: {log.targetId ? log.targetId.slice(0, 16) : 'N/A'}
                      </td>
                      <td className="py-3 px-4 text-slate-400 text-[11px]">
                        {log.detail ? JSON.stringify(log.detail) : '—'}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-400">{formatDateTime(log.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 6. TICKETS TAB */}
      {activeTab === 'tickets' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tickets.map((t) => (
              <div key={t.id} className="p-4 border border-slate-800 bg-slate-900/60 rounded-2xl flex flex-col hover:border-slate-700 transition">
                <div className="flex justify-between items-start mb-2">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                    t.category === 'Support' ? 'bg-blue-500/10 text-blue-400' :
                    t.category === 'Bug' ? 'bg-red-500/10 text-red-400' :
                    t.category === 'Feature Request' ? 'bg-emerald-500/10 text-emerald-400' :
                    t.category === 'Billing' ? 'bg-amber-500/10 text-amber-400' : 'bg-slate-700 text-slate-300'
                  }`}>
                    {t.category}
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    t.status === 'Open' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {t.status}
                  </span>
                </div>
                <h4 className="font-bold text-white text-sm mb-1">{t.title}</h4>
                <p className="text-xs text-slate-400 leading-relaxed flex-1">{t.description}</p>
                <div className="flex justify-between items-center mt-4 pt-3 border-t border-slate-800">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-slate-300 truncate">{t.userName || 'Unknown user'}</div>
                    <div className="text-[10px] text-slate-500 truncate">{t.userEmail}</div>
                    <div className="text-[10px] text-slate-500">{t.date ? new Date(t.date).toLocaleString() : 'N/A'}</div>
                  </div>
                  {t.status !== 'Closed' && (
                    <button
                      onClick={() => handleCloseTicket(t.id)}
                      className="text-[11px] text-emerald-400 hover:text-emerald-300 font-bold shrink-0 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 transition"
                    >
                      Mark Closed
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {tickets.length === 0 && <div className="text-center py-8 text-slate-500 text-xs">No support submissions reported.</div>}
        </div>
      )}

      {/* 7. BUGS TAB */}
      {activeTab === 'bugs' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            {bugs.length === 0 ? <div className="text-center py-8 text-slate-500 text-xs">No bugs reported.</div> : bugs.map((b) => (
              <div key={b.id} className="p-4 border border-slate-800 bg-slate-900/60 rounded-2xl flex flex-col">
                <div className="flex justify-between items-start mb-1.5">
                  <h4 className="font-bold text-white text-sm">{b.title}</h4>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-red-500/10 text-red-400 shrink-0 font-bold">Priority: {b.priority || 'Low'}</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed mb-2 flex-1">{b.description}</p>
                <div className="flex justify-between items-center pt-2 border-t border-slate-800">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-slate-300 truncate">{b.userName || 'Unknown user'}</div>
                    <div className="text-[10px] text-slate-500 truncate">{b.userEmail}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      b.status === 'Open' ? 'bg-red-500/10 text-red-400' : 'bg-slate-800 text-slate-400'
                    }`}>
                      {b.status}
                    </span>
                    <div className="text-[10px] text-slate-500 mt-1">{b.date ? new Date(b.date).toLocaleString() : 'N/A'}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 8. FEATURES TAB */}
      {activeTab === 'features' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            {features.length === 0 ? <div className="text-center py-8 text-slate-500 text-xs">No feature requests.</div> : features.map((f) => (
              <div key={f.id} className="p-4 border border-slate-800 bg-slate-900/60 rounded-2xl flex flex-col">
                <div className="flex justify-between items-start mb-1.5">
                  <h4 className="font-bold text-white text-sm">{f.title}</h4>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 shrink-0">{f.status || 'Open'}</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed mb-2 flex-1">{f.description}</p>
                <div className="flex justify-between items-center pt-2 border-t border-slate-800">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-slate-300 truncate">{f.userName || 'Unknown user'}</div>
                    <div className="text-[10px] text-slate-500 truncate">{f.userEmail}</div>
                  </div>
                  <div className="text-[10px] text-slate-500 shrink-0">{f.date ? new Date(f.date).toLocaleString() : 'N/A'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 9. ANNOUNCEMENTS TAB */}
      {activeTab === 'announcements' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form onSubmit={handleCreateAnnouncement} className="lg:col-span-1 p-5 border border-slate-800 rounded-2xl bg-slate-900/60 space-y-4">
            <h4 className="font-bold text-xs text-slate-300 uppercase tracking-wider mb-2">Publish Announcement</h4>
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">Title</label>
              <input
                type="text"
                required
                value={annTitle}
                onChange={(e) => setAnnTitle(e.target.value)}
                placeholder="Announcing v2.5 Update"
                className="bg-slate-800/80 border border-slate-700/80 text-white text-xs rounded-xl p-2.5 w-full focus:ring-violet-500 focus:border-violet-500"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">Content Body</label>
              <textarea
                required
                rows={4}
                value={annContent}
                onChange={(e) => setAnnContent(e.target.value)}
                placeholder="Type details of your global notification here..."
                className="bg-slate-800/80 border border-slate-700/80 text-white text-xs rounded-xl p-2.5 w-full focus:ring-violet-500 focus:border-violet-500"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs rounded-xl py-2.5 px-4 transition flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Plus className="h-4 w-4" />
              Publish Broadcast
            </button>
          </form>

          <div className="lg:col-span-2 space-y-3">
            <h4 className="font-bold text-xs text-slate-300 uppercase tracking-wider mb-2">Announcement Registry</h4>
            {announcements.map((ann) => (
              <div key={ann.id} className="p-4 border border-slate-800 rounded-2xl bg-slate-900/60 hover:border-slate-700 transition">
                <span className="text-[10px] text-slate-400 block">{new Date(ann.date).toLocaleDateString()} {new Date(ann.date).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</span>
                <h5 className="font-bold text-white text-sm mt-1">{ann.title}</h5>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">{ann.content}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Super Admin: Grant Pro Modal */}
      {grantProModalUser && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="relative w-full max-w-md bg-[#0e111d] border border-amber-500/30 rounded-2xl shadow-2xl p-6 text-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <Crown className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Super Admin: Manage Pro Access</h3>
                  <p className="text-[11px] text-slate-400">Set Pro subscription for this trader</p>
                </div>
              </div>
              <button
                onClick={() => setGrantProModalUser(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-4 space-y-4">
              <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-1">
                <div className="text-xs font-semibold text-white">{grantProModalUser.name || 'Trader'}</div>
                <div className="text-[11px] text-slate-400 font-mono">{grantProModalUser.email}</div>
                <div className="text-[11px] text-slate-400 mt-1">
                  Current Plan: <span className={grantProModalUser.isPro ? "text-amber-400 font-bold" : "text-slate-300 font-medium"}>
                    {grantProModalUser.isPro ? "Pro Member" : "Free Basic"}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  Select Pro Duration:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { days: '30', label: '30 Days (1 Mo)' },
                    { days: '90', label: '90 Days (3 Mo)' },
                    { days: '180', label: '180 Days (6 Mo)' },
                    { days: '365', label: '365 Days (1 Yr)' },
                    { days: '9999', label: 'Lifetime Access' },
                  ].map((d) => (
                    <button
                      key={d.days}
                      type="button"
                      onClick={() => setGrantProDays(d.days)}
                      className={`py-2 px-3 rounded-xl text-xs font-semibold border transition text-left cursor-pointer ${
                        grantProDays === d.days
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                          : 'bg-white/[0.02] text-slate-400 border-white/5 hover:bg-white/[0.05]'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-3">
              {grantProModalUser.isPro ? (
                <button
                  type="button"
                  onClick={() => handleConfirmGrantPro(false)}
                  disabled={grantProSubmitting}
                  className="px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30 text-xs font-semibold transition cursor-pointer"
                >
                  Revoke Pro
                </button>
              ) : <div />}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setGrantProModalUser(null)}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirmGrantPro(true)}
                  disabled={grantProSubmitting}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-amber-500/20 cursor-pointer active:scale-95"
                >
                  {grantProSubmitting ? (
                    <span>Saving...</span>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>{grantProModalUser.isPro ? 'Update Pro' : 'Activate Pro'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
