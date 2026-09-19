import re

def main():
    with open('server.ts', 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Update GET /api/accounts
    content = re.sub(
        r"app\.get\('/api/accounts', async \(req, res\) => \{.*?res\.json\(\{ accounts: userAccounts \}\);\s*\}\);",
        """app.get('/api/accounts', async (req, res) => {
    if (!req.user || !req.user.id) return res.status(401).json({ error: 'Unauthorized' });
    if (!supabase) return res.json({ accounts: [] });
    const { data, error } = await supabase.from('trading_accounts').select('*').eq('user_id', req.user.id);
    if (error) return res.status(500).json({ error: error.message });
    const accounts = data.map(a => ({
      id: a.id, userId: a.user_id, name: a.name, broker: a.broker, platform: a.platform,
      accountType: a.account_type, currency: a.currency, startingBalance: a.starting_balance,
      currentBalance: a.current_balance, equity: a.equity, status: a.status
    }));
    res.json({ accounts });
  });""",
        content,
        flags=re.DOTALL
    )

    # We will do this for all endpoints. Let's just output the first one to test.
    with open('server.ts', 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == '__main__':
    main()
