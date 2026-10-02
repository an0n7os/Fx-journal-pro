export interface MT5Deal {
  ticket: number;
  order: number;
  time: number;
  type: number;      // 0=Buy, 1=Sell, 2=Balance, 3=Credit
  entry: number;     // 0=IN, 1=OUT, 2=INOUT
  positionId: number;
  volume: number;
  price: number;
  commission: number;
  swap: number;
  profit: number;
  symbol: string;
  comment?: string;
}

export interface ReconstructedTrade {
  id: string;
  accountId: string;
  date: string;
  exitTime: string;
  symbol: string;
  type: 'Buy' | 'Sell' | 'Deposit' | 'Withdrawal';
  lotSize: number;
  entryPrice: number;
  exitPrice: number;
  profit: number;
  commission: number;
  swap: number;
  strategy: string;
  tags: string[];
  isMt5Sync: boolean;
  eaDealId?: number;
  eaPositionId?: number;
}

export interface MT5AccountSnapshot {
  accountId: string;
  userId?: string;
  balance: number;
  equity: number;
  margin?: number | null;
  marginFree?: number | null;
  marginLevel?: number | null;
  currency?: string | null;
  leverage?: number | null;
  capturedAt: string;
}

export interface MT5OpenPosition {
  accountId: string;
  userId?: string;
  positionId: number;
  ticket: number;
  symbol: string;
  side: string;
  volume: number;
  openTime: string;
  openPrice: number;
  sl: number | null;
  tp: number | null;
  commission: number;
  swap: number;
  profit: number;
  currentPrice: number | null;
  updatedAt: string;
}

export interface MT5PendingOrder {
  accountId: string;
  userId?: string;
  orderId: number;
  symbol: string;
  type: string;
  volume: number;
  openPrice: number;
  sl: number | null;
  tp: number | null;
  magic: number;
  state: string;
  updatedAt: string;
}

export interface MT5MoneyFlow {
  accountId: string;
  userId?: string;
  ticket: number;
  flowType: 'DEPOSIT' | 'WITHDRAWAL' | 'CREDIT' | 'INTEREST';
  amount: number;
  currency?: string | null;
  time: string;
}
