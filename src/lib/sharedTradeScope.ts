/** Reject conflicting ownership even if a corrupt legacy row points at an owned account. */
export function selectSharedTrades(trades: any[], accounts: any[], ownerId: string, selectedAccountId?: string): any[] {
  const owned = new Set(accounts.filter(a => (a.userId || a.user_id) === ownerId).map(a => a.id));
  return trades.filter(t => {
    const owner = t.userId || t.user_id;
    const account = t.accountId || t.account_id;
    if (owner && owner !== ownerId) return false;
    if (account ? !owned.has(account) : owner !== ownerId) return false;
    return !selectedAccountId || account === selectedAccountId;
  });
}
