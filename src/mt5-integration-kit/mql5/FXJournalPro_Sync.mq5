`//+------------------------------------------------------------------+
//|                                                   FX Journal Pro Sync  |
//|  Unique Expert Advisor generated for a portfolio account.             |
//|  Authenticates with FX Journal Pro using an HMAC-signed handshake      |
//|  and imports your complete MT5 trade history (90-day backfill), then   |
//|  keeps syncing new trades, positions, orders and account snapshots     |
//|  in real time. Read-only: contains no trading functions.               |
//|                                                                        |
//|  INSTALL:                                                              |
//|  1. MT5: Tools -> Options -> Expert Advisors -> check                 |
//|     "Allow WebRequest for listed URL" and add:                         |
//|       __FXJP_WEBREQUEST_HOST__                                         |
//|  2. Save this file into  MT5/Data folder -> MQL5/Experts/               |
//|  3. Drag it onto any chart. The configuration below is pre-filled       |
//|     for your account