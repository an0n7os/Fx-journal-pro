// FX Journal Pro — MT5 Synchronization EA template (v2, HMAC-signed).
// The server substitutes __FXJP_ACCOUNT_ID__ / __FXJP_TOKEN__ / __FXJP_API_URL__
// with per-account values and serves the result as a downloadable .mq5 file.
// This file is compiled into the server bundle (esbuild) so it works in both
// local dev and Vercel serverless deployments.

// String.raw keeps the backslash escapes (\" and \r\n etc.) as literal
// text in the generated .mq5 file, which is what MQL5 source requires.
export const EA_TEMPLATE = String.raw`//+------------------------------------------------------------------+
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
//|     for your account; do not change it.                                |
//|                                                                        |
//|  NOTE: keep your PC clock accurate (GMT) — every request is signed     |
//|  with a timestamp and rejected if it is more than 5 minutes off.       |
//+------------------------------------------------------------------+
#property copyright "FX Journal Pro"
#property link      "https://www.fxjournalpro.com"
#property version   "2.00"
#property description "FX Journal Pro automated MT5 synchronization (HMAC-signed)"

//+------------------------------------------------------------------+
//| Per-account configuration (filled by FX Journal Pro)             |
//+------------------------------------------------------------------+
string FXJP_ACCOUNT_ID = "__FXJP_ACCOUNT_ID__";
string FXJP_TOKEN     = "__FXJP_TOKEN__";
string FXJP_API_URL   = "__FXJP_API_URL__";

//+------------------------------------------------------------------+
//| Tuning inputs                                                    |
//+------------------------------------------------------------------+
input int    InpSyncIntervalSec = 30;  // Sync interval (seconds)
input int    InpBatchSize       = 200; // Deals per request (1-500)
input bool   InpFullSyncOnStart = true; // Import full history on start
input int    InpBackfillDays    = 90;  // Days of history to backfill (0 = all)

//+------------------------------------------------------------------+
//| Internal state                                                   |
//+------------------------------------------------------------------+
string   g_gvName = "";         // GlobalVariable holding last synced deal ticket
long     g_cursor = 0;          // last successfully synced deal ticket
bool     g_syncing = false;     // re-entrancy guard
bool     g_authed  = false;
bool     g_stopped = false;     // set on token-revoked / auth-failure
datetime g_lastSyncTime = 0;
int      g_dealsInBatch = 0;
string   g_flowsJson = "[]";    // money flows collected for the current batch
int      g_reqCounter = 0;      // monotonically increasing request id seed
int      g_retryDelay = 0;      // current backoff delay in seconds
datetime g_nextAttemptTime = 0;

//+------------------------------------------------------------------+
//| Small JSON string escaper                                        |
//+------------------------------------------------------------------+
string JsonEscape(string s)
{
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\r", " ");
   StringReplace(s, "\n", " ");
   return s;
}

//+------------------------------------------------------------------+
//| Bound a string so the server schema is never violated            |
//+------------------------------------------------------------------+
string Trunc(string s, int maxLen)
{
   if (StringLen(s) > maxLen)
      return StringSubstr(s, 0, maxLen);
   return s;
}

//+------------------------------------------------------------------+
//| Parse an integer field like "cursor":12345 from a JSON response  |
//+------------------------------------------------------------------+
long ParseIntField(string text, string field)
{
   string key = "\"" + field + "\":";
   int p = StringFind(text, key);
   if (p < 0) return 0;
   string tail = StringSubstr(text, p + StringLen(key));
   string num = "";
   int len = StringLen(tail);
   for (int i = 0; i < len; i++)
   {
      ushort c = StringGetCharacter(tail, i);
      if ((c >= '0' && c <= '9') || c == '-') num += ShortToString(c);
      else break;
   }
   return StringToInteger(num);
}

//+------------------------------------------------------------------+
//| SHA-256 (hex) using the built-in CryptEncode engine              |
//+------------------------------------------------------------------+
string Sha256Hex(string input)
{
   uchar inBytes[];
   StringToCharArray(input, inBytes, 0, StringLen(input), CP_UTF8);
   uchar hashBytes[];
   if (!CryptEncode(CRYPTO_HASH_SHA256, inBytes, hashBytes))
      return "";
   string outHex = "";
   for (int i = 0; i < ArraySize(hashBytes); i++)
      outHex += StringFormat("%02x", hashBytes[i]);
   return outHex;
}

//+------------------------------------------------------------------+
//| HMAC-SHA256 (hex). Key is used as UTF-8 bytes, exactly like the  |
//|| server: secret = sha256(ea_token), message = the signed string.  |
//+------------------------------------------------------------------+
string HmacSha256Hex(string key, string message)
{
   uchar keyBytes[];
   StringToCharArray(key, keyBytes, 0, StringLen(key), CP_UTF8);

   uchar keyPrime[];
   if (ArraySize(keyBytes) > 64)
   {
      uchar h[];
      if (!CryptEncode(CRYPTO_HASH_SHA256, keyBytes, h)) return "";
      ArrayResize(keyPrime, ArraySize(h));
      ArrayCopy(keyPrime, h);
   }
   else
   {
      ArrayResize(keyPrime, ArraySize(keyBytes));
      for (int i = 0; i < ArraySize(keyBytes); i++) keyPrime[i] = keyBytes[i];
   }

   uchar innerPad[];
   uchar outerPad[];
   ArrayResize(innerPad, 64);
   ArrayResize(outerPad, 64);
   for (int i = 0; i < 64; i++)
   {
      uchar kp = (i < ArraySize(keyPrime)) ? keyPrime[i] : 0;
      innerPad[i] = (uchar)(kp ^ 0x36);
      outerPad[i] = (uchar)(kp ^ 0x5c);
   }

   uchar msgBytes[];
   StringToCharArray(message, msgBytes, 0, StringLen(message), CP_UTF8);

   uchar innerInput[];
   ArrayResize(innerInput, 64 + ArraySize(msgBytes));
   ArrayCopy(innerInput, innerPad);
   for (int i = 0; i < ArraySize(msgBytes); i++) innerInput[64 + i] = msgBytes[i];

   uchar innerHash[];
   if (!CryptEncode(CRYPTO_HASH_SHA256, innerInput, innerHash)) return "";

   uchar outerInput[];
   ArrayResize(outerInput, 64 + ArraySize(innerHash));
   ArrayCopy(outerInput, outerPad);
   for (int i = 0; i < ArraySize(innerHash); i++) outerInput[64 + i] = innerHash[i];

   uchar outerHash[];
   if (!CryptEncode(CRYPTO_HASH_SHA256, outerInput, outerHash)) return "";

   string outHex = "";
   for (int i = 0; i < ArraySize(outerHash); i++)
      outHex += StringFormat("%02x", outerHash[i]);
   return outHex;
}

//+------------------------------------------------------------------+
//| ISO-8601 UTC timestamp used for the signature (and replay check) |
//+------------------------------------------------------------------+
string IsoTimestamp()
{
   MqlDateTime t;
   TimeToStruct(TimeGMT(), t);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02d.000Z",
      t.year, t.mon, t.day, t.hour, t.min, t.sec);
}

//+------------------------------------------------------------------+
//| POST a JSON payload to the FX Journal Pro backend. Every request |
//| is signed: HMAC-SHA256(secret = sha256(ea_token),                |
//|   message = "<timestamp>.<accountId>.<rawBody>").                |
//+------------------------------------------------------------------+
bool HttpPost(string path, string payload, string &outBody, int &outCode)
{
   outCode = 0;
   outBody = "";
   string url = FXJP_API_URL + path;

   string ts = IsoTimestamp();
   string reqId = StringFormat("%d_%d", (long)TimeGMT(), g_reqCounter++);
   string sig = HmacSha256Hex(Sha256Hex(FXJP_TOKEN),
                              ts + "." + FXJP_ACCOUNT_ID + "." + payload);

   string headers = "Content-Type: application/json\r\n"
                  + "User-Agent: FXJournalPro-EA/2.0\r\n"
                  + "Accept: application/json\r\n"
                  + "Authorization: Bearer " + FXJP_TOKEN + "\r\n"
                  + "X-EA-Account-Id: " + FXJP_ACCOUNT_ID + "\r\n"
                  + "X-EA-Timestamp: " + ts + "\r\n"
                  + "X-EA-Signature: " + sig + "\r\n"
                  + "X-EA-Request-Id: " + reqId + "\r\n";

   char postData[];
   StringToCharArray(payload, postData, 0, StringLen(payload), CP_UTF8);

   char respData[];
   string respHeaders;
   int code = WebRequest("POST", url, headers, 15000, postData, respData, respHeaders);
   outCode = code;

   if (code == 200)
   {
      outBody = CharArrayToString(respData, 0, WHOLE_ARRAY, CP_UTF8);
      return true;
   }

   if (code == -1)
   {
      int err = GetLastError();
      if (err == 4014)
         Print("FXJP: WebRequest is blocked. In MT5 go to Tools -> Options -> Expert Advisors and allow \"__FXJP_WEBREQUEST_HOST__\" in the WebRequest allow list.");
      else if (err == 4015)
         Print("FXJP: Invalid URL or the URL is not in the WebRequest allow list. Add \"__FXJP_WEBREQUEST_HOST__\".");
      else
         Print("FXJP: WebRequest failed, error ", err);
   }
   else
   {
      int len = ArraySize(respData);
      if (len > 0)
         outBody = CharArrayToString(respData, 0, WHOLE_ARRAY, CP_UTF8);
      Print("FXJP: Server returned HTTP ", code, " for ", path);
   }
   return false;
}

//+------------------------------------------------------------------+
//| POST wrapper that reacts to specific server error codes          |
//+------------------------------------------------------------------+
bool PostJson(string path, string payload, string &outBody)
{
   int code = 0;
   bool ok = HttpPost(path, payload, outBody, code);
   if (ok) return true;

   if (code == 401)
   {
      if (StringFind(outBody, "EA_TOKEN_REVOKED") >= 0)
      {
         Comment("FJP: token revoked — download a fresh EA file");
         g_stopped = true;
      }
      else if (StringFind(outBody, "SIGNATURE_MISMATCH") >= 0 ||
               StringFind(outBody, "EA_STALE_TIMESTAMP") >= 0)
      {
         Print("FXJP: HMAC verification failed. Check that your PC clock (GMT) is correct.");
      }
      else
      {
         Comment("FJP: auth failed");
         g_stopped = true;
      }
   }
   else if (code == 429)
   {
      Print("FXJP: rate limited (429) — backing off.");
   }
   return false;
}

//+------------------------------------------------------------------+
//| Backoff: 5s -> 10s -> 30s -> ... -> max 5 min                    |
//+------------------------------------------------------------------+
void BackOff()
{
   if (g_retryDelay == 0) g_retryDelay = 5;
   else g_retryDelay = MathMin(g_retryDelay * 2, 300);
   g_nextAttemptTime = TimeCurrent() + g_retryDelay;
}

void ResetBackOff()
{
   g_retryDelay = 0;
   g_nextAttemptTime = 0;
}

//+------------------------------------------------------------------+
//| Payload builders (each matches the server's strict zod schema)   |
//+------------------------------------------------------------------+
string BuildValidatePayload()
{
   return "{"
      + "\"accountId\":\"" + FXJP_ACCOUNT_ID + "\","
      + "\"login\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\","
      + "\"server\":\"" + JsonEscape(Trunc(AccountInfoString(ACCOUNT_SERVER), 64)) + "\","
      + "\"build\":" + IntegerToString(TerminalInfoInteger(TERMINAL_BUILD))
      + "}";
}

string BuildSnapshotPayload()
{
   return "{"
      + "\"accountId\":\"" + FXJP_ACCOUNT_ID + "\","
      + "\"balance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ","
      + "\"equity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) + ","
      + "\"margin\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN), 2) + ","
      + "\"marginFree\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2) + ","
      + "\"marginLevel\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_LEVEL), 2) + ","
      + "\"currency\":\"" + JsonEscape(Trunc(AccountInfoString(ACCOUNT_CURRENCY), 8)) + "\","
      + "\"leverage\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LEVERAGE))
      + "}";
}

string BuildAccountBriefJson()
{
   return "{"
      + "\"balance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ","
      + "\"equity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) + ","
      + "\"currency\":\"" + JsonEscape(Trunc(AccountInfoString(ACCOUNT_CURRENCY), 8)) + "\""
      + "}";
}

string BuildHeartbeatPayload()
{
   return "{"
      + "\"accountId\":\"" + FXJP_ACCOUNT_ID + "\","
      + "\"balance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ","
      + "\"equity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2)
      + "}";
}

string BuildDealJson(ulong ticket)
{
   string symbol = Trunc(HistoryDealGetString(ticket, DEAL_SYMBOL), 32);
   string cmt = Trunc(HistoryDealGetString(ticket, DEAL_COMMENT), 200);
   string s = "{";
   s += "\"ticket\":"     + IntegerToString((long)ticket) + ",";
   s += "\"positionId\":" + IntegerToString((long)HistoryDealGetInteger(ticket, DEAL_POSITION_ID)) + ",";
   s += "\"time\":"       + IntegerToString((long)HistoryDealGetInteger(ticket, DEAL_TIME)) + ",";
   s += "\"type\":"       + IntegerToString((int)HistoryDealGetInteger(ticket, DEAL_TYPE)) + ",";
   s += "\"entry\":"      + IntegerToString((int)HistoryDealGetInteger(ticket, DEAL_ENTRY)) + ",";
   s += "\"magic\":"      + IntegerToString((long)HistoryDealGetInteger(ticket, DEAL_MAGIC)) + ",";
   s += "\"symbol\":\""   + JsonEscape(symbol) + "\",";
   s += "\"volume\":"     + DoubleToString(HistoryDealGetDouble(ticket, DEAL_VOLUME), 2) + ",";
   s += "\"price\":"      + DoubleToString(HistoryDealGetDouble(ticket, DEAL_PRICE), 5) + ",";
   s += "\"profit\":"     + DoubleToString(HistoryDealGetDouble(ticket, DEAL_PROFIT), 2) + ",";
   s += "\"commission\":" + DoubleToString(HistoryDealGetDouble(ticket, DEAL_COMMISSION), 2) + ",";
   s += "\"swap\":"       + DoubleToString(HistoryDealGetDouble(ticket, DEAL_SWAP), 2) + ",";
   s += "\"comment\":\""  + JsonEscape(cmt) + "\"";
   s += "}";
   return s;
}

string BuildMoneyFlowJson(ulong ticket)
{
   long dType = (int)HistoryDealGetInteger(ticket, DEAL_TYPE);
   double profit = HistoryDealGetDouble(ticket, DEAL_PROFIT);
   string flowType = "CREDIT";
   if (dType == DEAL_TYPE_BALANCE)
      flowType = (profit >= 0 ? "DEPOSIT" : "WITHDRAWAL");
   string s = "{";
   s += "\"ticket\":"   + IntegerToString((long)ticket) + ",";
   s += "\"type\":\""   + flowType + "\",";
   s += "\"amount\":"   + DoubleToString(profit, 2) + ",";
   s += "\"currency\":\"" + JsonEscape(Trunc(AccountInfoString(ACCOUNT_CURRENCY), 8)) + "\",";
   s += "\"time\":"     + IntegerToString((long)HistoryDealGetInteger(ticket, DEAL_TIME));
   s += "}";
   return s;
}

//+------------------------------------------------------------------+
//| Collect up to InpBatchSize deals with ticket > g_cursor.         |
//| Fills g_dealsInBatch and g_flowsJson (balance/credit money flows |
//| that belong to the collected deals).                             |
//+------------------------------------------------------------------+
string CollectDealBatch()
{
   g_dealsInBatch = 0;
   g_flowsJson = "[";

   datetime from = 0;
   if (InpBackfillDays > 0)
      from = TimeCurrent() - (datetime)InpBackfillDays * 86400;
   HistorySelect(from, TimeCurrent());
   int total = HistoryDealsTotal();
   if (total <= 0)
   {
      g_flowsJson = "[]";
      return "[]";
   }

   int flowCount = 0;
   string json = "[";
   for (int i = 0; i < total && g_dealsInBatch < InpBatchSize; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if ((long)ticket <= g_cursor) continue;

      long dType = (int)HistoryDealGetInteger(ticket, DEAL_TYPE);
      string symbol = HistoryDealGetString(ticket, DEAL_SYMBOL);

      if (g_dealsInBatch > 0) json += ",";
      json += BuildDealJson(ticket);
      g_dealsInBatch++;

      if (StringLen(symbol) == 0 && (dType == DEAL_TYPE_BALANCE || dType == DEAL_TYPE_CREDIT))
      {
         if (flowCount > 0) g_flowsJson += ",";
         g_flowsJson += BuildMoneyFlowJson(ticket);
         flowCount++;
      }
   }
   json += "]";
   g_flowsJson += "]";
   return json;
}

string BuildPositionsPayload()
{
   string json = "\"positions\":[";
   int count = 0;
   for (int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if (ticket == 0) continue;
      if (!PositionSelectByTicket(ticket)) continue;

      string symbol = Trunc(PositionGetString(POSITION_SYMBOL), 32);
      long posType = (long)PositionGetInteger(POSITION_TYPE);
      double bid = SymbolInfoDouble(symbol, SYMBOL_BID);

      if (count > 0) json += ",";
      json += "{";
      json += "\"positionId\":" + IntegerToString((long)PositionGetInteger(POSITION_IDENTIFIER)) + ",";
      json += "\"ticket\":"    + IntegerToString((long)PositionGetInteger(POSITION_TICKET)) + ",";
      json += "\"symbol\":\""  + JsonEscape(symbol) + "\",";
      json += "\"side\":\""    + (posType == POSITION_TYPE_BUY ? "Buy" : "Sell") + "\",";
      json += "\"volume\":"    + DoubleToString(PositionGetDouble(POSITION_VOLUME), 2) + ",";
      json += "\"openTime\":"  + IntegerToString((long)PositionGetInteger(POSITION_TIME)) + ",";
      json += "\"openPrice\":" + DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN), 5) + ",";
      json += "\"sl\":"        + DoubleToString(PositionGetDouble(POSITION_SL), 5) + ",";
      json += "\"tp\":"        + DoubleToString(PositionGetDouble(POSITION_TP), 5) + ",";
      json += "\"commission\":"+ DoubleToString(PositionGetDouble(POSITION_COMMISSION), 2) + ",";
      json += "\"swap\":"      + DoubleToString(PositionGetDouble(POSITION_SWAP), 2) + ",";
      json += "\"profit\":"    + DoubleToString(PositionGetDouble(POSITION_PROFIT), 2) + ",";
      json += "\"currentPrice\":" + DoubleToString(bid, 5);
      json += "}";
      count++;
   }
   json += "]";
   return "{\"accountId\":\"" + FXJP_ACCOUNT_ID + "\"," + json + "}";
}

string BuildOrdersPayload()
{
   string json = "\"orders\":[";
   int count = 0;
   for (int i = 0; i < OrdersTotal(); i++)
   {
      ulong ticket = OrderGetTicket(i);
      if (ticket == 0) continue;
      if (!OrderSelect(ticket)) continue;

      string otype = "Other";
      long t = (long)OrderGetInteger(ORDER_TYPE);
      if (t == ORDER_TYPE_BUY_LIMIT) otype = "Buy Limit";
      else if (t == ORDER_TYPE_BUY_STOP) otype = "Buy Stop";
      else if (t == ORDER_TYPE_SELL_LIMIT) otype = "Sell Limit";
      else if (t == ORDER_TYPE_SELL_STOP) otype = "Sell Stop";
      else if (t == ORDER_TYPE_BUY_STOP_LIMIT) otype = "Buy Stop Limit";
      else if (t == ORDER_TYPE_SELL_STOP_LIMIT) otype = "Sell Stop Limit";

      string state = "Unknown";
      long st = (long)OrderGetInteger(ORDER_STATE);
      if (st == ORDER_STATE_STARTED) state = "Started";
      else if (st == ORDER_STATE_PLACED) state = "Placed";
      else if (st == ORDER_STATE_CANCELED) state = "Canceled";
      else if (st == ORDER_STATE_PARTIAL) state = "Partial";
      else if (st == ORDER_STATE_FILLED) state = "Filled";
      else if (st == ORDER_STATE_REJECTED) state = "Rejected";
      else if (st == ORDER_STATE_EXPIRED) state = "Expired";
      else if (st == ORDER_STATE_REQUEST_ADD || st == ORDER_STATE_REQUEST_MODIFY ||
               st == ORDER_STATE_REQUEST_CANCEL) state = "Requested";

      if (count > 0) json += ",";
      json += "{";
      json += "\"orderId\":"  + IntegerToString((long)OrderGetInteger(ORDER_TICKET)) + ",";
      json += "\"symbol\":\"" + JsonEscape(Trunc(OrderGetString(ORDER_SYMBOL), 32)) + "\",";
      json += "\"type\":\""   + otype + "\",";
      json += "\"volume\":"   + DoubleToString(OrderGetDouble(ORDER_VOLUME_CURRENT), 2) + ",";
      json += "\"openPrice\":"+ DoubleToString(OrderGetDouble(ORDER_PRICE_OPEN), 5) + ",";
      json += "\"sl\":"       + DoubleToString(OrderGetDouble(ORDER_SL), 5) + ",";
      json += "\"tp\":"       + DoubleToString(OrderGetDouble(ORDER_TP), 5) + ",";
      json += "\"magic\":"    + IntegerToString((long)OrderGetInteger(ORDER_MAGIC)) + ",";
      json += "\"state\":\""  + state + "\"";
      json += "}";
      count++;
   }
   json += "]";
   return "{\"accountId\":\"" + FXJP_ACCOUNT_ID + "\"," + json + "}";
}

//+------------------------------------------------------------------+
//| API calls                                                        |
//+------------------------------------------------------------------+
bool Validate()
{
   string body;
   if (!PostJson("/ea/validate", BuildValidatePayload(), body)) return false;

   long lastDeal = ParseIntField(body, "lastDealId");
   if (lastDeal > g_cursor)
   {
      g_cursor = lastDeal;
      GlobalVariableSet(g_gvName, (double)g_cursor);
   }
   g_authed = true;
   g_lastSyncTime = TimeCurrent();
   ResetBackOff();
   return true;
}

//+------------------------------------------------------------------+
//| Push all pending deals to the backend (batched) + money flows    |
//+------------------------------------------------------------------+
bool PostDeals()
{
   int guard = 0;
   bool anyOk = false;
   while (guard < 1000 && !g_stopped)
   {
      guard++;
      string dealsJson = CollectDealBatch();
      if (g_dealsInBatch <= 0) break;

      string payload = "{"
         + "\"accountId\":\"" + FXJP_ACCOUNT_ID + "\","
         + "\"deals\":"       + dealsJson + ","
         + "\"moneyFlows\":"  + g_flowsJson + ","
         + "\"account\":"     + BuildAccountBriefJson()
         + "}";

      string outBody;
      if (!PostJson("/ea/sync", payload, outBody))
      {
         if (!anyOk) return false;
         break;
      }
      anyOk = true;

      // Trust the server cursor: it stores every deal and returns the max stored
      long serverCursor = ParseIntField(outBody, "cursor");
      if (serverCursor > g_cursor) g_cursor = serverCursor;
      GlobalVariableSet(g_gvName, (double)g_cursor);
      g_lastSyncTime = TimeCurrent();

      // Pace backfill bursts so we stay under the per-account rate limit
      Sleep(600);
   }
   return anyOk;
}

//+------------------------------------------------------------------+
//| One full sync cycle: snapshot -> positions -> orders -> deals    |
//+------------------------------------------------------------------+
void PeriodicSync()
{
   if (g_stopped || g_syncing) return;
   if (g_nextAttemptTime > 0 && TimeCurrent() < g_nextAttemptTime) return;

   g_syncing = true;

   if (!g_authed)
   {
      if (!Validate())
      {
         BackOff();
         g_syncing = false;
         return;
      }
   }

   bool ok = false;
   string body;

   if (PostJson("/ea/account", BuildSnapshotPayload(), body)) ok = true;
   if (!g_stopped && PostJson("/ea/positions", BuildPositionsPayload(), body)) ok = true;
   if (!g_stopped && PostJson("/ea/orders", BuildOrdersPayload(), body)) ok = true;
   if (!g_stopped && PostDeals()) ok = true;
   if (!g_stopped && PostJson("/ea/heartbeat", BuildHeartbeatPayload(), body)) ok = true;

   if (ok) ResetBackOff();
   else BackOff();

   g_syncing = false;
}

//+------------------------------------------------------------------+
//| Expert Advisor lifecycle                                         |
//+------------------------------------------------------------------+
int OnInit()
{
   g_gvName = "FXJP_" + FXJP_ACCOUNT_ID;
   g_cursor = (long)GlobalVariableGet(g_gvName);

   EventSetTimer(InpSyncIntervalSec);

   // Handshake first. On transient failures the timer retries with backoff;
   // a hard 401 (bad token) sets g_stopped and the terminal comment.
   if (!Validate())
   {
      if (!g_stopped) BackOff();
   }
   else if (InpFullSyncOnStart)
   {
      PeriodicSync();
   }

   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTick()
{
   // Real-time sync is handled by OnTradeTransaction; the timer is the fallback.
}

void OnTimer()
{
   if (g_stopped) return;
   if (g_nextAttemptTime > 0 && TimeCurrent() < g_nextAttemptTime) return;
   PeriodicSync();
}

void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
{
   // Fire on every new deal so closed trades + balance changes sync instantly
   if (g_stopped) return;
   if (trans.type == TRADE_TRANSACTION_DEAL_ADD)
      PeriodicSync();
}
`;
