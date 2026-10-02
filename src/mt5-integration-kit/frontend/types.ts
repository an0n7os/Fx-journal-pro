export interface TradingAccount {
  id: string;
  userId?: string;
  name: string;
  broker?: string;
  accountNumber?: string;
  accountType?: 'Live' | 'Demo' | 'Evaluation' | 'Funded';
  startingBalance: number;
  currentBalance: number;
  equity?: number;
  currency?: string;
  isMt5Sync?: boolean;
  eaToken?: string;
  eaStatus?: string;
  connectionStatus?: string;
  lastSyncTime?: string;
  lastHeartbeatAt?: string;
}
