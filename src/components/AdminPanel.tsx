import React, { useState, useEffect } from 'react';
import { 
  Users, CreditCard, AlertCircle, FileText, Plus, CheckCircle, Ban, RefreshCw, Star, 
  BarChart3, Shield, Bug, Lightbulb, UserCheck, Crown, TrendingUp, Gift, Activity,
  Search, Eye, UserPlus, Lock, Check, X, ShieldAlert, DollarSign, Calendar,
  Copy, CheckCheck, Wallet, ArrowUpRight, Filter, Ticket, Link2, Pencil,
  Trash2, ToggleLeft, ToggleRight, Sparkles, Sliders
} from 'lucide-react';
import { SupportTicket, Announcement } from '../types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import SubAdminConsole from './SubAdminConsole';

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
  const isAdmin = myRole === 'SUPER_ADMIN' || myRole === 'ADMIN';
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
  const [recordAmount, setRecordAmount] = useState('399');
  const [recordMethod, setRecordMethod] = useState<'upi' | 'card' | 'bank_transfer' | 'cash'>('upi');
  const [recordNotes, setRecordNotes] = useState('');
  const [recordDays, setRecordDays] = useState('30');
  const [recordSubmitting, setRecordSubmitting] = useState(false);

  // Team management form
  const [roleEmail, setRoleEmail] = useState('');
  const [roleSelect, setRoleSelect] = useState('SUB_ADMIN');
  const [roleSubmitting, setRoleSubmitting] = useState(false);

  // Announcement fields
  const [annTitle, setAnnTitle] = useState('');
  const [annContent, setAnnContent] = useState('');

  // Partner / Mentor Referral Pricing, Coupon & Link states
  interface PartnerReferralLink {
    id: string;
    code: string;
    label?: string;
    offerPrice: number;
    isActive: boolean;
    referralUrl?: string;
    mentorEarns: number;
    studentSaves: number;
    createdAt?: string;
  }

  const [partnerProfile, setPartnerProfile] = useState<{
    referralCode: string;
    referralUrl: string;
    name?: string;
    offerPrice?: number;
    standardPrice?: number;
    mentorEarns?: number;
    links?: PartnerReferralLink[];
  } | null>(null);

  const [copiedCoupon, setCopiedCoupon] = useState<string | null>(null);
  const [copiedRefLink, setCopiedRefLink] = useState<string | null>(null);
  const [editingCoupon, setEditingCoupon] = useState(false);
  const [draftCouponCode, setDraftCouponCode] = useState('');
  const [savingCoupon, setSavingCoupon] = useState(false);
  const [couponSaveMsg, setCouponSaveMsg] = useState<string | null>(null);

  // Student offer price configuration
  const [currentOfferPrice, setCurrentOfferPrice] = useState<number>(499);
  const [savingOfferPrice, setSavingOfferPrice] = useState(false);
  const [offerPriceMsg, setOfferPriceMsg] = useState<string | null>(null);

  // Custom referral links modal & form states
  const [showCreateLinkModal, setShowCreateLinkModal] = useState(false);
  const [newLinkCode, setNewLinkCode] = useState('');
  const [newLinkLabel, setNewLinkLabel] = useState('');
  const [newLinkPrice, setNewLinkPrice] = useState<number>(399);
  const [creatingLink, setCreatingLink] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const [editingLink, setEditingLink] = useState<PartnerReferralLink | null>(null);
  const [editLinkCode, setEditLinkCode] = useState('');
  const [editLinkLabel, setEditLinkLabel] = useState('');
  const [editLinkPrice, setEditLinkPrice] = useState<number>(399);
  const [savingEditLink, setSavingEditLink] = useState(false);

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

  const handleCopyCoupon = (val: string) => {
    navigator.clipboard.writeText(val);
    setCopiedCoupon(val);
    setTimeout(() => setCopiedCoupon(null), 2000);
  };

  const handleCopyRefLink = (val: string) => {
    navigator.clipboard.writeText(val);
    setCopiedRefLink(val);
    setTimeout(() => setCopiedRefLink(null), 2000);
  };

  const handleSaveCouponCode = async () => {
    const next = draftCouponCode.trim().toUpperCase();
    if (!next) return;
    setSavingCoupon(true);
    setCouponSaveMsg(null);
    try {
      const res = await fetch('/api/partner/code', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({ referralCode: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not save that code.');
      setPartnerProfile((prev: any) => ({ ...(prev || {}), referralCode: body.referralCode, referralUrl: body.referralUrl }));
      setEditingCoupon(false);
      setCouponSaveMsg('Coupon code updated successfully!');
      setTimeout(() => setCouponSaveMsg(null), 3000);
    } catch (e: any) {
      alert(e.message || 'Error updating code');
    } finally {
      setSavingCoupon(false);
    }
  };

  const handleSaveOfferPrice = async (targetPrice?: number) => {
    const priceToSave = targetPrice !== undefined ? targetPrice : currentOfferPrice;
    setSavingOfferPrice(true);
    setOfferPriceMsg(null);
    try {
      const res = await fetch('/api/partner/offer-price', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({ offerPrice: priceToSave }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not save offer price.');
      setCurrentOfferPrice(body.offerPrice);
      setPartnerProfile((prev: any) => ({
        ...(prev || {}),
        offerPrice: body.offerPrice,
        mentorEarns: body.mentorEarns
      }));
      setOfferPriceMsg(`Offer price updated to ₹${body.offerPrice}! You earn ₹${body.mentorEarns} per student upgrade.`);
      setTimeout(() => setOfferPriceMsg(null), 3500);
    } catch (e: any) {
      alert(e.message || 'Error updating offer price');
    } finally {
      setSavingOfferPrice(false);
    }
  };

  const handleCreateReferralLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingLink(true);
    setLinkError(null);
    try {
      const res = await fetch('/api/partner/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({
          code: newLinkCode.trim().toUpperCase() || undefined,
          label: newLinkLabel.trim() || undefined,
          offerPrice: newLinkPrice
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not create referral link.');
      setPartnerProfile((prev: any) => ({
        ...(prev || {}),
        links: [body.link, ...((prev && prev.links) || [])]
      }));
      setShowCreateLinkModal(false);
      setNewLinkCode('');
      setNewLinkLabel('');
      setNewLinkPrice(399);
    } catch (e: any) {
      setLinkError(e.message || 'Error creating link');
    } finally {
      setCreatingLink(false);
    }
  };

  const handleUpdateReferralLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLink) return;
    setSavingEditLink(true);
    setLinkError(null);
    try {
      const res = await fetch(`/api/partner/links/${editingLink.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({
          code: editLinkCode.trim().toUpperCase(),
          label: editLinkLabel.trim(),
          offerPrice: editLinkPrice
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not update link.');
      setPartnerProfile((prev: any) => ({
        ...(prev || {}),
        links: (prev?.links || []).map((l: any) => l.id === editingLink.id ? body.link : l)
      }));
      setEditingLink(null);
    } catch (e: any) {
      setLinkError(e.message || 'Error updating link');
    } finally {
      setSavingEditLink(false);
    }
  };

  const handleToggleLinkActive = async (link: PartnerReferralLink) => {
    try {
      const res = await fetch(`/api/partner/links/${link.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({ isActive: !link.isActive }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not toggle link status.');
      setPartnerProfile((prev: any) => ({
        ...(prev || {}),
        links: (prev?.links || []).map((l: any) => l.id === link.id ? body.link : l)
      }));
    } catch (e: any) {
      alert(e.message || 'Error toggling link status');
    }
  };

  const handleDeleteReferralLink = async (link: PartnerReferralLink) => {
    if (!confirm(`Delete referral link ${link.code}? Traders using this link will no longer receive the offer.`)) return;
    try {
      const res = await fetch(`/api/partner/links/${link.id}`, {
        method: 'DELETE',
        headers: { ...getAuthHeaders() },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Could not delete link.');
      setPartnerProfile((prev: any) => ({
        ...(prev || {}),
        links: (prev?.links || []).filter((l: any) => l.id !== link.id)
      }));
    } catch (e: any) {
      alert(e.message || 'Error deleting link');
    }
  };

  const fetchData = async () => {
    setLoading(true);
    const authHeaders = getAuthHeaders();
    try {
      // Always fetch dashboard summary and user registry so counters are live across all tabs
      const [dashRes, usersRes, checkRes] = await Promise.all([
        fetch('/api/admin/dashboard', { headers: authHeaders }),
        fetch('/api/admin/users', { headers: authHeaders }),
        fetch('/api/admin/check', { headers: authHeaders })
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

      // Fetch partner/mentor coupon profile & referral links
      fetch('/api/partner/me', { headers: authHeaders, credentials: 'include' })
        .then(r => r.json())
        .then(data => {
          if (data?.referralCode) {
            setPartnerProfile(data);
            setDraftCouponCode(data.referralCode);
            if (typeof data.offerPrice === 'number') {
              setCurrentOfferPrice(data.offerPrice);
            }
          }
        })
        .catch(() => {});

      if (activeTab === 'team') {
        const res = await fetch('/api/admin/team', { headers: authHeaders });
        if (res.ok) {
          const data = await res.json();
          if (data.team) setTeam(data.team);
          // Drive the capability matrix from the server's own table so the
          // two can never drift apart.
          if (data.permissions) setRolePermissions(data.permissions);
        }
      } else if (activeTab === 'billing') {
        const res = await fetch('/api/admin/billing', { headers: authHeaders });
        if (res.ok) {
          const data = await res.json();
          setBillingData(data);
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
          amount: Number(recordAmount) || 399,
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
        body: JSON.stringify({ isPro: !currentIsPro })
      });
      if (res.ok) {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, isPro: !currentIsPro } : u));
      }
    } catch (e) {
      alert('Failed to change user plan.');
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
              {isSubAdmin ? 'Partner Portal' : 'Admin & Mentor Access'}
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
          { id: 'billing', label: 'Billing & Payments', icon: CreditCard, need: 'billing.read' },
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
                  ? 'border-violet-500/20 text-violet-400/90 hover:bg-violet-600/10'
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
          {/* Mentor Partner Referral Pricing & Console */}
          <div className="p-6 rounded-2xl bg-gradient-to-r from-purple-950/40 via-violet-950/30 to-slate-900/90 border border-purple-500/30 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />
            
            {/* Header */}
            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-purple-500/20">
              <div>
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="p-1.5 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    <Ticket className="h-4 w-4" />
                  </span>
                  <h3 className="text-base font-extrabold text-white tracking-tight">Mentor Referral Pricing & Income Hub</h3>
                  <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 uppercase tracking-wider">
                    Standard Price: ₹499/mo
                  </span>
                </div>
                <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
                  Set student offer prices between <strong className="text-white">₹199 and ₹499</strong>. Students see <span className="line-through text-slate-400">₹499</span> crossed out and pay your offer price. Your referral income is automatically calculated as: <strong className="text-emerald-400">Student Pays - ₹199</strong>.
                </p>
                {couponSaveMsg && (
                  <p className="text-xs text-emerald-400 font-semibold mt-1.5 animate-fade-in flex items-center gap-1.5">
                    <CheckCircle className="h-3.5 w-3.5" /> {couponSaveMsg}
                  </p>
                )}
                {offerPriceMsg && (
                  <p className="text-xs text-emerald-400 font-semibold mt-1.5 animate-fade-in flex items-center gap-1.5">
                    <CheckCircle className="h-3.5 w-3.5" /> {offerPriceMsg}
                  </p>
                )}
              </div>

              {/* Action Hub (Primary Coupon & Link) */}
              <div className="flex flex-wrap items-center gap-2.5">
                {editingCoupon ? (
                  <div className="flex items-center gap-2 bg-slate-950/90 border border-purple-500/50 rounded-xl p-1.5">
                    <input
                      type="text"
                      value={draftCouponCode}
                      onChange={(e) => setDraftCouponCode(e.target.value.toUpperCase())}
                      placeholder="CUSTOMCODE"
                      className="px-2.5 py-1 text-xs font-mono font-bold bg-slate-900 text-white rounded-lg border border-purple-500/40 w-28 uppercase focus:outline-none focus:border-purple-400"
                    />
                    <button
                      type="button"
                      onClick={handleSaveCouponCode}
                      disabled={savingCoupon}
                      className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-lg transition cursor-pointer"
                    >
                      {savingCoupon ? '...' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingCoupon(false)}
                      className="p-1 text-slate-400 hover:text-white transition cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 bg-slate-950/80 border border-purple-500/30 rounded-xl px-3 py-1.5 shadow-sm">
                    <span className="text-[10px] text-slate-400 font-semibold uppercase">Coupon:</span>
                    <span className="font-mono text-sm font-black text-purple-300 tracking-wider">
                      {partnerProfile?.referralCode || 'MENTOR60'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyCoupon(partnerProfile?.referralCode || 'MENTOR60')}
                      className="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-[11px] flex items-center gap-1 transition cursor-pointer"
                    >
                      {copiedCoupon === (partnerProfile?.referralCode || 'MENTOR60') ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      <span>{copiedCoupon === (partnerProfile?.referralCode || 'MENTOR60') ? 'Copied' : 'Copy'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingCoupon(true)}
                      title="Edit custom code"
                      className="p-1 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => handleCopyRefLink(partnerProfile?.referralUrl || `${window.location.origin}/?ref=${partnerProfile?.referralCode || 'MENTOR60'}`)}
                  className="px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm"
                >
                  {copiedRefLink === (partnerProfile?.referralUrl || `${window.location.origin}/?ref=${partnerProfile?.referralCode || 'MENTOR60'}`) ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Link2 className="h-3.5 w-3.5 text-violet-400" />}
                  <span>{copiedRefLink === (partnerProfile?.referralUrl || `${window.location.origin}/?ref=${partnerProfile?.referralCode || 'MENTOR60'}`) ? 'Link Copied!' : 'Copy Referral Link'}</span>
                </button>
              </div>
            </div>

            {/* Dynamic Offer Price Slider & Live Income Calculator */}
            <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
              <div className="lg:col-span-7 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                    <Sliders className="h-3.5 w-3.5 text-purple-400" />
                    Student Offer Price Slider:
                  </label>
                  <span className="text-xs text-slate-400">
                    Range: <strong className="text-slate-200">₹199 – ₹499</strong>
                  </span>
                </div>

                {/* Range Slider */}
                <div className="space-y-2">
                  <input
                    type="range"
                    min={199}
                    max={499}
                    step={10}
                    value={currentOfferPrice}
                    onChange={(e) => setCurrentOfferPrice(Number(e.target.value))}
                    className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-500"
                  />
                  <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                    <span>₹199 (Max Discount)</span>
                    <span>₹299</span>
                    <span>₹399</span>
                    <span>₹499 (Full Price)</span>
                  </div>
                </div>

                {/* Preset Buttons */}
                <div className="flex flex-wrap gap-2 pt-1">
                  {[
                    { price: 499, label: '₹499 (Standard)', earns: 300 },
                    { price: 399, label: '₹399 (20% Off)', earns: 200 },
                    { price: 299, label: '₹299 (40% Off)', earns: 100 },
                    { price: 199, label: '₹199 (Max Discount)', earns: 0 },
                  ].map((p) => (
                    <button
                      key={p.price}
                      type="button"
                      onClick={() => {
                        setCurrentOfferPrice(p.price);
                        handleSaveOfferPrice(p.price);
                      }}
                      className={`px-2.5 py-1 text-[11px] rounded-lg border font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                        currentOfferPrice === p.price
                          ? 'bg-purple-600/30 border-purple-500 text-purple-200 shadow-sm'
                          : 'bg-slate-900/60 border-slate-700/60 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      <span>{p.label}</span>
                      <span className="text-[10px] text-emerald-400 font-bold">Earn ₹{p.earns}</span>
                    </button>
                  ))}
                  {currentOfferPrice !== (partnerProfile?.offerPrice || 499) && (
                    <button
                      type="button"
                      onClick={() => handleSaveOfferPrice(currentOfferPrice)}
                      disabled={savingOfferPrice}
                      className="px-3 py-1 text-[11px] rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition cursor-pointer shadow-sm ml-auto"
                    >
                      {savingOfferPrice ? 'Saving...' : 'Apply Price'}
                    </button>
                  )}
                </div>
              </div>

              {/* Live Preview Display Box */}
              <div className="lg:col-span-5 p-4 rounded-xl bg-slate-950/80 border border-purple-500/25 space-y-3">
                <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                  Live Conversion Preview
                </div>
                <div className="grid grid-cols-2 gap-3 pt-1 border-t border-white/[0.06]">
                  <div>
                    <span className="text-[11px] text-slate-400 block">Student Sees & Pays:</span>
                    <div className="flex items-baseline gap-1.5 mt-0.5">
                      <span className="line-through text-slate-500 text-sm">₹499</span>
                      <span className="text-2xl font-black text-emerald-400 font-display">₹{currentOfferPrice}</span>
                    </div>
                    <span className="text-[10px] text-emerald-300 font-medium">
                      Student saves ₹{499 - currentOfferPrice}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block">Your Referral Income:</span>
                    <div className="text-2xl font-black text-purple-300 font-display mt-0.5">
                      ₹{Math.max(0, currentOfferPrice - 199)}
                    </div>
                    <span className="text-[10px] text-slate-400 font-medium">
                      Platform floor: ₹199
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Custom Referral Links & Campaign Manager */}
            <div className="mt-5 pt-4 border-t border-purple-500/20">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <Link2 className="h-3.5 w-3.5 text-violet-400" />
                    Referral Links & Campaigns
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    Create, edit, manage, or revoke custom referral links with unique offer prices.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreateLinkModal(true)}
                  className="px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-sm self-start sm:self-auto"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create New Referral Link
                </button>
              </div>

              {/* Links Table */}
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-900/90 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">Campaign / Code</th>
                      <th className="py-2.5 px-3">Student Pays</th>
                      <th className="py-2.5 px-3">Your Income</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {/* Primary Link Row */}
                    <tr className="hover:bg-white/[0.02] transition">
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-violet-300 bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/20">
                            {partnerProfile?.referralCode || 'MENTOR60'}
                          </span>
                          <span className="text-[10px] text-slate-400 font-semibold">(Primary Default)</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="line-through text-slate-500 mr-1.5 text-[11px]">₹499</span>
                        <strong className="text-emerald-400 font-bold">₹{currentOfferPrice}</strong>
                      </td>
                      <td className="py-2.5 px-3">
                        <strong className="text-purple-300 font-bold">₹{Math.max(0, currentOfferPrice - 199)}</strong>
                        <span className="text-[10px] text-slate-500 ml-1">/ upgrade</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          Active
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleCopyRefLink(partnerProfile?.referralUrl || `${window.location.origin}/?ref=${partnerProfile?.referralCode || 'MENTOR60'}`)}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold inline-flex items-center gap-1 transition cursor-pointer"
                        >
                          {copiedRefLink === (partnerProfile?.referralUrl || `${window.location.origin}/?ref=${partnerProfile?.referralCode || 'MENTOR60'}`) ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                          Copy Link
                        </button>
                      </td>
                    </tr>

                    {/* Custom Links Rows */}
                    {(partnerProfile?.links || []).map((link) => (
                      <tr key={link.id} className="hover:bg-white/[0.02] transition">
                        <td className="py-2.5 px-3">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-violet-300 bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/20">
                                {link.code}
                              </span>
                              <span className="text-[11px] text-slate-300 font-medium">{link.label || 'Custom Offer'}</span>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="line-through text-slate-500 mr-1.5 text-[11px]">₹499</span>
                          <strong className="text-emerald-400 font-bold">₹{link.offerPrice}</strong>
                        </td>
                        <td className="py-2.5 px-3">
                          <strong className="text-purple-300 font-bold">₹{Math.max(0, link.offerPrice - 199)}</strong>
                          <span className="text-[10px] text-slate-500 ml-1">/ upgrade</span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                            link.isActive
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                              : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                          }`}>
                            {link.isActive ? 'Active' : 'Revoked'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleCopyRefLink(link.referralUrl || `${window.location.origin}/?ref=${link.code}`)}
                              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold inline-flex items-center gap-1 transition cursor-pointer"
                              title="Copy Link"
                            >
                              {copiedRefLink === (link.referralUrl || `${window.location.origin}/?ref=${link.code}`) ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                              Copy
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingLink(link);
                                setEditLinkCode(link.code);
                                setEditLinkLabel(link.label || '');
                                setEditLinkPrice(link.offerPrice);
                              }}
                              className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                              title="Edit link"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleLinkActive(link)}
                              className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer flex items-center gap-1 ${
                                link.isActive
                                  ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/25'
                                  : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/25'
                              }`}
                              title={link.isActive ? 'Revoke link' : 'Reactivate link'}
                            >
                              {link.isActive ? 'Revoke' : 'Activate'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteReferralLink(link)}
                              className="p-1 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition cursor-pointer"
                              title="Delete link"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

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
          <div className="overflow-x-auto bg-slate-900/60 rounded-2xl border border-slate-800/90 shadow-sm">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider font-bold bg-slate-900/90">
                  <th className="py-3.5 px-4">User Details</th>
                  <th className="py-3.5 px-4">Plan Tier</th>
                  <th className="py-3.5 px-4">Last Activity</th>
                  <th className="py-3.5 px-4">Trading Profile</th>
                  <th className="py-3.5 px-4 text-center">Accounts & Trades</th>
                  <th className="py-3.5 px-4">Referral Info</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-slate-500">
                      No matching users found in registry.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-800/40 transition group">
                      {/* User Details */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-white flex items-center gap-1.5">
                          {u.name || 'Trader'}
                          {u.authProvider === 'google' && (
                            <span title="Google Account" className="text-[10px] px-1 rounded bg-red-500/10 text-red-400 border border-red-500/20">G</span>
                          )}
                          {u.role && u.role !== 'USER' && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded font-bold uppercase bg-violet-500/20 text-violet-300 border border-violet-500/30">
                              {u.role}
                            </span>
                          )}
                        </div>
                        {!isSubAdmin && (
                          <div className="text-[11px] text-slate-400 font-mono mt-0.5">{u.email}</div>
                        )}
                      </td>

                      {/* Plan Tier with quick toggle */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col items-start gap-1">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                            u.isPro 
                              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' 
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}>
                            {u.isPro ? <Crown className="h-3 w-3 text-amber-400 fill-amber-400" /> : null}
                            {u.isPro ? 'Pro Member' : 'Free Basic'}
                          </span>
                          <button
                            onClick={() => handleToggleUserPlan(u.id, !!u.isPro)}
                            className="text-[10px] text-slate-500 hover:text-slate-300 underline decoration-dotted transition"
                          >
                            {u.isPro ? 'Revoke Pro' : 'Grant Pro'}
                          </button>
                        </div>
                      </td>

                      {/* Last Activity */}
                      <td className="py-3.5 px-4">
                        <div className="text-slate-300 font-medium text-[11px]">{formatDateTime(u.lastLogin)}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          Joined: {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'N/A'}
                        </div>
                      </td>

                      {/* Trading Profile */}
                      <td className="py-3.5 px-4">
                        <div className="text-slate-200 font-medium">{u.tradingStyle || 'Discretionary'}</div>
                        <div className="text-[10px] text-slate-400">{u.experience || 'Intermediate'}</div>
                      </td>

                      {/* Accounts & Trades Count */}
                      <td className="py-3.5 px-4 text-center">
                        <div className="inline-flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono font-bold">
                            {u.accountsCount || 0} acc
                          </span>
                          <button
                            type="button"
                            onClick={() => onInspectUser?.(u)}
                            className="px-2.5 py-1 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 hover:border-emerald-400 font-mono font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm hover:scale-105 active:scale-95"
                            title="Click to inspect all trades & journal"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                            <span>{u.tradesCount || 0} trades</span>
                          </button>
                        </div>
                      </td>

                      {/* Referral Info */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1 text-[11px] font-mono text-violet-300">
                          <Gift className="h-3 w-3 text-violet-400" />
                          <span className="bg-violet-500/10 px-1.5 py-0.2 rounded border border-violet-500/20">
                            {u.referralCode || 'FX-100'}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-2">
                          <span>Ref: <strong className="text-white">{u.referralCount || 0}</strong></span>
                          <span>Earned: <strong className="text-emerald-400">₹{u.referralIncome || 0}</strong></span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 text-center">
                        {u.role === 'PARTNER' && (
                          <span className="mb-1 block mx-auto w-fit px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wide bg-violet-500/10 text-violet-300 border border-violet-500/25">
                            Partner
                          </span>
                        )}
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold tracking-wide uppercase ${
                          !u.status || u.status === 'ACTIVE' 
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                            : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}>
                          {u.status || 'ACTIVE'}
                        </span>
                      </td>

                      {/* Actions: Analysis Icon on the right side */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* MENTOR ANALYSIS ICON BUTTON */}
                          <button
                            onClick={() => onInspectUser?.(u)}
                            className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 hover:from-violet-500 hover:via-purple-500 hover:to-indigo-500 text-white font-black text-xs flex items-center gap-1.5 transition-all shadow-md shadow-violet-500/30 hover:scale-105 active:scale-95 shrink-0 border border-violet-400/30 cursor-pointer"
                            title="Inspect User Dashboard & Analysis (Mentor Read-Only Mode)"
                          >
                            <BarChart3 className="h-4 w-4 text-white" />
                            <span>Analysis</span>
                          </button>

                          {/* Partner role. Only offered where it makes sense —
                              an admin account is already above this. */}
                          {myPermissions.includes('partner.manage') &&
                           !['SUPER_ADMIN', 'ADMIN'].includes(u.role) && (
                            u.role === 'PARTNER' ? (
                              <button
                                onClick={() => handleRemovePartner(u)}
                                disabled={partnerBusy === u.id}
                                title="Remove Partner access"
                                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-slate-700/40 text-slate-300 hover:bg-slate-700/70 border border-slate-600/40 transition disabled:opacity-40"
                              >
                                Remove Partner
                              </button>
                            ) : (
                              <button
                                onClick={() => handleUpgradeToPartner(u)}
                                disabled={partnerBusy === u.id}
                                title="Make this user a Partner — grants Pro and a referral link"
                                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 border border-violet-500/25 transition disabled:opacity-40"
                              >
                                {partnerBusy === u.id ? 'Working…' : 'Upgrade to Partner'}
                              </button>
                            )
                          )}

                          {/* Suspend / Reactivate - Admins only, never Sub-Admin / Mentors */}
                          {!isSubAdmin && myPermissions.includes('users.manage') && (
                            (!u.status || u.status === 'ACTIVE') ? (
                              <button
                                onClick={() => handleUpdateUserStatus(u.id, 'SUSPENDED')}
                                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition"
                              >
                                Suspend
                              </button>
                            ) : (
                              <button
                                onClick={() => handleUpdateUserStatus(u.id, 'ACTIVE')}
                                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 transition"
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
            <form onSubmit={handleUpdateTeamRole} className="flex flex-col sm:flex-row items-center gap-2 shrink-0">
              <input
                type="email"
                required
                value={roleEmail}
                onChange={(e) => setRoleEmail(e.target.value)}
                placeholder="User email to promote..."
                className="px-3 py-2 bg-slate-900/90 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 w-full sm:w-56"
              />
              <select
                value={roleSelect}
                onChange={(e) => setRoleSelect(e.target.value)}
                className="px-3 py-2 bg-slate-900/90 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-violet-500"
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
                className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs rounded-xl transition flex items-center gap-1.5 shadow-sm shrink-0 w-full sm:w-auto justify-center"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>Assign Role</span>
              </button>
            </form>
          </div>

          {/* Team Members Directory */}
          <div className="overflow-x-auto bg-slate-900/60 rounded-2xl border border-slate-800/90 shadow-sm">
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
                  Razorpay API v1 Active
                </span>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
                  Monthly Pro ₹499/mo
                </span>
              </div>

              <p className="text-xs text-slate-300">
                Live automated subscription billing powered by Razorpay. Supports instant UPI AutoPay (Google Pay, PhonePe, Paytm), Credit/Debit Cards, and NetBanking with cryptographic webhook verification.
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
                ₹{billingData?.totalRevenue ?? (dashboardStats?.totalRevenue || (totalProCount * 399))}
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
                ₹{billingData?.mrr ?? (totalProCount * 399)}
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
              <div className="text-[10px] text-slate-400 mt-1">Paying ₹399/mo Pro tier</div>
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
                    const amt = p.amount ? (p.amount > 1000 ? p.amount / 100 : p.amount) : 399;
                    return (
                      <tr key={p.id} className="hover:bg-slate-800/40 transition">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-white">{p.userName || p.userEmail?.split('@')[0] || 'Subscriber'}</div>
                          <div className="text-[11px] text-slate-400 font-mono">{p.userEmail || 'subscriber@axyfx.com'}</div>
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

      {/* Modal: Create New Referral Link */}
      {showCreateLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-purple-500/30 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Ticket className="h-5 w-5 text-purple-400" />
                <h3 className="font-bold text-base text-white">Create New Referral Link</h3>
              </div>
              <button
                type="button"
                onClick={() => { setShowCreateLinkModal(false); setLinkError(null); }}
                className="p-1 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {linkError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{linkError}</span>
              </div>
            )}

            <form onSubmit={handleCreateReferralLink} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Campaign Label (Optional)</label>
                <input
                  type="text"
                  value={newLinkLabel}
                  onChange={(e) => setNewLinkLabel(e.target.value)}
                  placeholder="e.g. YouTube Special, VIP Batch, Telegram"
                  className="bg-slate-950 border border-slate-700 text-white text-xs rounded-xl p-3 w-full focus:outline-none focus:border-violet-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Coupon / Referral Code</label>
                <input
                  type="text"
                  value={newLinkCode}
                  onChange={(e) => setNewLinkCode(e.target.value.toUpperCase())}
                  placeholder="e.g. VIP399 (leave blank to auto-generate)"
                  className="bg-slate-950 border border-slate-700 text-white font-mono text-xs rounded-xl p-3 w-full uppercase focus:outline-none focus:border-violet-500 tracking-wider"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-300">Student Offer Price</label>
                  <span className="text-xs font-bold text-emerald-400">₹{newLinkPrice}</span>
                </div>
                <input
                  type="range"
                  min={199}
                  max={499}
                  step={10}
                  value={newLinkPrice}
                  onChange={(e) => setNewLinkPrice(Number(e.target.value))}
                  className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-500"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[
                    { price: 499, label: '₹499 (Standard)', earns: 300 },
                    { price: 399, label: '₹399 (20% Off)', earns: 200 },
                    { price: 299, label: '₹299 (40% Off)', earns: 100 },
                    { price: 199, label: '₹199 (Max Discount)', earns: 0 },
                  ].map((p) => (
                    <button
                      key={p.price}
                      type="button"
                      onClick={() => setNewLinkPrice(p.price)}
                      className={`px-2 py-1 text-[10px] rounded-lg border font-semibold transition cursor-pointer ${
                        newLinkPrice === p.price
                          ? 'bg-purple-600/30 border-purple-500 text-purple-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Conversion Preview */}
              <div className="p-3.5 rounded-xl bg-purple-950/20 border border-purple-500/20 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-400 block text-[11px]">Student Pays:</span>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <span className="line-through text-slate-500 text-[11px]">₹499</span>
                    <strong className="text-emerald-400 font-bold text-base">₹{newLinkPrice}</strong>
                  </div>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">You Earn:</span>
                  <strong className="text-purple-300 font-bold text-base mt-0.5 block">
                    ₹{Math.max(0, newLinkPrice - 199)}
                  </strong>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowCreateLinkModal(false); setLinkError(null); }}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingLink}
                  className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition cursor-pointer shadow-sm disabled:opacity-50"
                >
                  {creatingLink ? 'Creating...' : 'Create Link'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Referral Link */}
      {editingLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-purple-500/30 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Pencil className="h-4 w-4 text-purple-400" />
                <h3 className="font-bold text-base text-white">Edit Referral Link</h3>
              </div>
              <button
                type="button"
                onClick={() => { setEditingLink(null); setLinkError(null); }}
                className="p-1 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {linkError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{linkError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateReferralLink} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Campaign Label</label>
                <input
                  type="text"
                  value={editLinkLabel}
                  onChange={(e) => setEditLinkLabel(e.target.value)}
                  placeholder="Campaign Label"
                  className="bg-slate-950 border border-slate-700 text-white text-xs rounded-xl p-3 w-full focus:outline-none focus:border-violet-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Coupon / Referral Code</label>
                <input
                  type="text"
                  value={editLinkCode}
                  onChange={(e) => setEditLinkCode(e.target.value.toUpperCase())}
                  required
                  className="bg-slate-950 border border-slate-700 text-white font-mono text-xs rounded-xl p-3 w-full uppercase focus:outline-none focus:border-violet-500 tracking-wider"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-300">Student Offer Price</label>
                  <span className="text-xs font-bold text-emerald-400">₹{editLinkPrice}</span>
                </div>
                <input
                  type="range"
                  min={199}
                  max={499}
                  step={10}
                  value={editLinkPrice}
                  onChange={(e) => setEditLinkPrice(Number(e.target.value))}
                  className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-500"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[
                    { price: 499, label: '₹499 (Standard)', earns: 300 },
                    { price: 399, label: '₹399 (20% Off)', earns: 200 },
                    { price: 299, label: '₹299 (40% Off)', earns: 100 },
                    { price: 199, label: '₹199 (Max Discount)', earns: 0 },
                  ].map((p) => (
                    <button
                      key={p.price}
                      type="button"
                      onClick={() => setEditLinkPrice(p.price)}
                      className={`px-2 py-1 text-[10px] rounded-lg border font-semibold transition cursor-pointer ${
                        editLinkPrice === p.price
                          ? 'bg-purple-600/30 border-purple-500 text-purple-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Conversion Preview */}
              <div className="p-3.5 rounded-xl bg-purple-950/20 border border-purple-500/20 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-400 block text-[11px]">Student Pays:</span>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <span className="line-through text-slate-500 text-[11px]">₹499</span>
                    <strong className="text-emerald-400 font-bold text-base">₹{editLinkPrice}</strong>
                  </div>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">You Earn:</span>
                  <strong className="text-purple-300 font-bold text-base mt-0.5 block">
                    ₹{Math.max(0, editLinkPrice - 199)}
                  </strong>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setEditingLink(null); setLinkError(null); }}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEditLink}
                  className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition cursor-pointer shadow-sm disabled:opacity-50"
                >
                  {savingEditLink ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
