export interface User {
  id: string;
  email: string;
  name: string;
  password?: string;
  experience?: 'Beginner' | 'Intermediate' | 'Professional';
  tradingStyle?: 'Scalping' | 'Day Trading' | 'Swing Trading';
  mainMarkets?: ('Forex' | 'Gold' | 'Crypto' | 'Indices')[];
  onboardingCompleted: boolean;
  isPro: boolean;
  preferences?: {
    skipDeleteConfirm?: boolean;
    [key: string]: any;
  };
  onboardingData?: {
    experience: string;
    tradingStyle: string;
    markets: string[];
  };
}

export interface TradingAccount {
  id: string;
  userId: string;
  name: string;
  broker: string;
  platform: 'MT4' | 'MT5' | 'cTrader' | 'DXtrade';
  accountType: 'Live' | 'Demo';
  institutionType?: 'Broker' | 'Prop Firm';
  currency: string;
  startingBalance: number;
  currentBalance: number;
  equity: number;
  status: 'Active' | 'Inactive' | 'Archived';
  isMt5Sync?: boolean;
  eaToken?: string;
  eaStatus?: 'Not Connected' | 'Connected' | 'Error';
  eaLastDealId?: number;
  eaLastSyncTime?: string;
  eaSyncTradeCount?: number;
  eaConnectedAt?: string;
  eaTerminalLogin?: string;
  eaTerminalServer?: string;
  mt5Login?: string;
  mt5Server?: string;
  syncMethod?: 'EA' | 'CLOUD';
  connectionStatus?: string;
}

export interface Trade {
  id: string;
  accountId: string;
  /** Owner. Supabase stores it as trades.user_id; kept here so the local
   *  fallback store can filter a user's trades the same way. */
  userId?: string;
  date: string; // ISO format or date string
  exitTime?: string;
  symbol: string;
  type: 'Buy' | 'Sell' | 'Deposit' | 'Withdrawal';
  lotSize: number;
  entryPrice: number;
  exitPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  profit: number; // positive or negative
  commission: number;
  swap: number;
  riskPercentage: number;
  strategy?: string;
  emotion?: 'Calm' | 'Excited' | 'Anxious' | 'FOMO' | 'Greedy' | 'Revenge';
  notes?: string;
  screenshot?: string; // base64 or URL
  tags: string[];
  isMt5Sync?: boolean;
  /** Broker deal/ticket number, used to detect re-imported rows. */
  ticket?: string | number;
  eaDealId?: number;
  eaPositionId?: number;
}

export interface RiskSettings {
  id: string;
  accountId: string;
  riskPerTradeLimit: number; // e.g. 2 for 2%
  dailyLossLimit: number; // in currency amount or %
  weeklyLossLimit: number;
  maxDrawdownLimit: number;
  disciplineEnabled: boolean;
  maxTradesPerDay: number;
}

export interface SupportTicket {
  id: string;
  userId: string;
  userEmail: string;
  userName?: string;
  title: string;
  description: string;
  status: 'Open' | 'In Progress' | 'Closed';
  category: 'Support' | 'Billing' | 'Feature Request' | 'Bug' | 'Other';
  date: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  date: string;
}

export interface PaymentHistory {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  plan: 'Pro';
  status: 'Success' | 'Failed' | 'Pending';
  date: string;
  razorpayId: string;
}
