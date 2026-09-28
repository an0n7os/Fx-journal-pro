// server.ts
import "dotenv/config";
import express from "express";
import path2 from "path";
import fs from "fs";
import crypto2 from "crypto";
import bcrypt from "bcryptjs";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import cookieParser from "cookie-parser";
import { GoogleGenAI } from "@google/genai";

// src/eaTemplate.ts
var EA_TEMPLATE = String.raw`//+------------------------------------------------------------------+
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

// server.ts
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import MetaApiModule from "metaapi.cloud-sdk/dist/index";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";

// auth.ts
import "dotenv/config";
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { getMigrations } from "better-auth/db/migration";
import { memoryAdapter } from "@better-auth/memory-adapter";
import { createRequire } from "node:module";
import path from "path";
import crypto from "node:crypto";
import pg from "pg";
var { Pool } = pg;
var nodeRequire = createRequire(import.meta.url);
var IS_SERVERLESS = !!(process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
var DB_PATH = path.join(process.cwd(), "auth.sqlite");
function createMemoryStore() {
  return {
    user: [],
    session: [],
    account: [],
    verification: [],
    rateLimit: [],
    jwks: [],
    twoFactor: [],
    passkey: [],
    invitation: [],
    organization: [],
    member: []
  };
}
function getDatabaseAdapter() {
  if (process.env.DATABASE_URL) {
    return new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 5e3
    });
  }
  if (IS_SERVERLESS) {
    return memoryAdapter(createMemoryStore());
  }
  try {
    const sqliteModule = nodeRequire("node:sqlite");
    return new sqliteModule.DatabaseSync(DB_PATH);
  } catch (e) {
    console.warn("[Better Auth] Could not load SQLite, falling back to in-memory adapter:", e);
    return memoryAdapter(createMemoryStore());
  }
}
function resolveAuthSecret() {
  const configured = process.env.BETTER_AUTH_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;
  if (IS_SERVERLESS || process.env.NODE_ENV === "production") {
    throw new Error(
      "BETTER_AUTH_SECRET (or SESSION_SECRET) must be set to at least 32 characters in production."
    );
  }
  console.warn("[Better Auth] No BETTER_AUTH_SECRET set \u2014 using an ephemeral development key.");
  return crypto.randomBytes(32).toString("hex");
}
function resolveBaseURL() {
  if (process.env.BETTER_AUTH_URL?.trim()) {
    return process.env.BETTER_AUTH_URL.trim();
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`;
  }
  if (process.env.VERCEL_URL?.trim()) {
    return `https://${process.env.VERCEL_URL.trim()}`;
  }
  if (IS_SERVERLESS) {
    return "https://fx-journal-pro-pi.vercel.app";
  }
  return "http://localhost:3000";
}
var auth = betterAuth({
  database: getDatabaseAdapter(),
  baseURL: resolveBaseURL(),
  secret: resolveAuthSecret(),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    autoSignIn: true,
    sendResetPassword: async ({ user, url }) => {
      const resendKey = process.env.RESEND_API_KEY?.trim();
      if (!resendKey || resendKey === "YOUR_RESEND_API_KEY") {
        console.log(`[Better Auth] Reset Password URL for ${user.email}: ${url}`);
        return;
      }
      const configuredFrom = process.env.RESEND_FROM_EMAIL?.trim();
      const resendFrom = configuredFrom ? configuredFrom.includes("<") ? configuredFrom : `FX Journal Pro <${configuredFrom}>` : "FX Journal Pro <onboarding@resend.dev>";
      try {
        console.log(`[Better Auth] Sending password reset email via Resend to ${user.email}...`);
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + resendKey
          },
          body: JSON.stringify({
            from: resendFrom,
            to: user.email,
            subject: "Reset your password - FX Journal Pro",
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 32px 24px; background: #0f172a; color: #f8fafc; border-radius: 12px; border: 1px solid #1e293b;">
                <div style="text-align: center; margin-bottom: 24px;">
                  <h1 style="color: #6366f1; font-size: 24px; margin: 0; font-weight: 800; letter-spacing: -0.5px;">FX Journal Pro</h1>
                  <p style="color: #94a3b8; font-size: 14px; margin-top: 6px;">Professional Trading Performance & Journaling</p>
                </div>
                <div style="background: #1e293b; padding: 24px; border-radius: 8px; border: 1px solid #334155;">
                  <h2 style="font-size: 18px; margin: 0 0 12px; color: #f1f5f9;">Reset your password</h2>
                  <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin: 0 0 20px;">
                    Hi ${user.name || "Trader"}, we received a request to reset your password. Click the button below to choose a new password.
                  </p>
                  <div style="text-align: center; margin: 28px 0;">
                    <a href="${url}" style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #ffffff; text-decoration: none; padding: 13px 32px; border-radius: 6px; font-weight: 600; font-size: 15px; display: inline-block;">
                      Reset Password
                    </a>
                  </div>
                  <p style="font-size: 12px; color: #94a3b8; margin: 20px 0 0; word-break: break-all;">
                    Or copy and paste this link: <a href="${url}" style="color: #818cf8;">${url}</a>
                  </p>
                </div>
                <p style="text-align: center; font-size: 12px; color: #64748b; margin-top: 24px;">
                  If you did not request a password reset, you can safely ignore this email.
                </p>
              </div>
            `
          })
        });
        const data = await res.json();
        if (!res.ok) {
          console.error("[Better Auth Resend Reset Error]", data);
        } else {
          console.log(`[Better Auth] Reset email sent to ${user.email} (id: ${data.id})`);
        }
      } catch (err) {
        console.error("[Better Auth Resend Reset Exception]", err?.message || err);
      }
    }
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const resendKey = process.env.RESEND_API_KEY?.trim();
      if (!resendKey || resendKey === "YOUR_RESEND_API_KEY") {
        console.log(`[Better Auth] Verification URL for ${user.email}: ${url}`);
        return;
      }
      const configuredFrom = process.env.RESEND_FROM_EMAIL?.trim();
      const resendFrom = configuredFrom ? configuredFrom.includes("<") ? configuredFrom : `FX Journal Pro <${configuredFrom}>` : "FX Journal Pro <onboarding@resend.dev>";
      try {
        console.log(`[Better Auth] Sending verification email via Resend to ${user.email}...`);
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + resendKey
          },
          body: JSON.stringify({
            from: resendFrom,
            to: user.email,
            subject: "Verify your email - FX Journal Pro",
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 32px 24px; background: #0f172a; color: #f8fafc; border-radius: 12px; border: 1px solid #1e293b;">
                <div style="text-align: center; margin-bottom: 24px;">
                  <h1 style="color: #6366f1; font-size: 24px; margin: 0; font-weight: 800; letter-spacing: -0.5px;">FX Journal Pro</h1>
                  <p style="color: #94a3b8; font-size: 14px; margin-top: 6px;">Professional Trading Performance & Journaling</p>
                </div>
                <div style="background: #1e293b; padding: 24px; border-radius: 8px; border: 1px solid #334155;">
                  <h2 style="font-size: 18px; margin: 0 0 12px; color: #f1f5f9;">Confirm your email address</h2>
                  <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin: 0 0 20px;">
                    Hi ${user.name || "Trader"}, thank you for signing up. Please verify your email to unlock all trading features and protect your account.
                  </p>
                  <div style="text-align: center; margin: 28px 0;">
                    <a href="${url}" style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #ffffff; text-decoration: none; padding: 13px 32px; border-radius: 6px; font-weight: 600; font-size: 15px; display: inline-block;">
                      Verify My Email
                    </a>
                  </div>
                  <p style="font-size: 12px; color: #94a3b8; margin: 20px 0 0; word-break: break-all;">
                    Or copy and paste this link: <a href="${url}" style="color: #818cf8;">${url}</a>
                  </p>
                </div>
                <p style="text-align: center; font-size: 12px; color: #64748b; margin-top: 24px;">
                  If you didn't create an account, you can safely ignore this email.
                </p>
              </div>
            `
          })
        });
        const data = await res.json();
        if (!res.ok) {
          console.error("[Better Auth Resend Error]", data);
        } else {
          console.log(`[Better Auth] Verification email sent successfully to ${user.email} (id: ${data.id})`);
        }
      } catch (err) {
        console.error("[Better Auth Resend Exception]", err?.message || err);
      }
    }
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "USER"
      },
      status: {
        type: "string",
        required: false,
        defaultValue: "ACTIVE"
      },
      experience: {
        type: "string",
        required: false
      },
      tradingStyle: {
        type: "string",
        required: false
      },
      mainMarkets: {
        type: "string",
        required: false
      },
      onboardingCompleted: {
        type: "boolean",
        required: false,
        defaultValue: false
      },
      isPro: {
        type: "boolean",
        required: false,
        defaultValue: false
      },
      proExpiresAt: {
        type: "string",
        required: false
      }
    }
  },
  socialProviders: {
    ...process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID.trim(),
        clientSecret: process.env.GOOGLE_CLIENT_SECRET.trim()
      }
    } : {},
    ...process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET ? {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID.trim(),
        clientSecret: process.env.GITHUB_CLIENT_SECRET.trim()
      }
    } : {}
  },
  trustedOrigins: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://fx-journal-pro-pi.vercel.app",
    "https://fxjournalp.netlify.app",
    "https://fxjournalpro.com",
    ...process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL.trim()] : [],
    ...process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL.trim()}`] : [],
    ...process.env.VERCEL_PROJECT_PRODUCTION_URL ? [`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`] : [],
    ...process.env.BETTER_AUTH_TRUSTED_ORIGINS ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(",").map((s) => s.trim()) : []
  ],
  account: {
    storeStateStrategy: "cookie",
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"]
    }
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (user.email?.toLowerCase().trim() === "akshayrajak222@gmail.com") {
            return {
              data: {
                ...user,
                role: "SUPER_ADMIN",
                isPro: true
              }
            };
          }
        }
      }
    }
  },
  advanced: {
    useSecureCookies: resolveBaseURL().startsWith("https://"),
    defaultCookieAttributes: {
      sameSite: "lax",
      secure: resolveBaseURL().startsWith("https://")
    }
  },
  onAPIError: {
    onError: (error, ctx) => {
      console.error("[Better Auth API Error]", error?.message || error, ctx?.path);
    }
  },
  plugins: [
    bearer()
  ]
});
async function autoMigrateBetterAuth() {
  if (IS_SERVERLESS) return;
  try {
    const migrations = await getMigrations(auth.options);
    if (migrations.toBeCreated.length > 0 || migrations.toBeAdded.length > 0) {
      console.log("[Better Auth] Running schema migrations...");
      if (migrations.runMigrations) {
        await migrations.runMigrations();
        console.log("[Better Auth] Schema migrations completed successfully.");
      }
    }
  } catch (err) {
    console.error("[Better Auth] Migration check error:", err?.message || err);
  }
}

// server.ts
var MetaApi = MetaApiModule.default || MetaApiModule;
autoMigrateBetterAuth().catch((err) => console.error("[Better Auth] Auto-migrate failed:", err?.message || err));
var IS_SERVERLESS2 = !!(process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
var IS_DEV = !IS_SERVERLESS2 && process.env.NODE_ENV !== "production";
var IS_PRODUCTION_LIKE = IS_SERVERLESS2 || process.env.NODE_ENV === "production";
var DEV_ACCOUNT_ID = "user_dev";
var DEV_ACCOUNT_EMAIL = IS_DEV ? process.env.DEV_ACCOUNT_EMAIL?.trim().toLowerCase() || "dev@localhost" : "";
var DEV_ADMIN_PASSWORD_HASH = (() => {
  const custom = process.env.DEV_ADMIN_PASSWORD?.trim();
  if (!IS_DEV || !custom) return "";
  return bcrypt.hashSync(custom, 10);
})();
var SUPER_ADMIN_EMAILS = /* @__PURE__ */ new Set([
  "akshayrajak222@gmail.com",
  ...process.env.SUPER_ADMIN_EMAILS ? process.env.SUPER_ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase()) : [],
  ...DEV_ACCOUNT_EMAIL ? [DEV_ACCOUNT_EMAIL.toLowerCase().trim()] : []
]);
var isSuperAdminEmail = (email) => {
  if (!email) return false;
  return SUPER_ADMIN_EMAILS.has(email.toLowerCase().trim());
};
var DB_FILE = path2.join(process.cwd(), "db.json");
var supabase = null;
var useSupabase = false;
try {
  let supabaseUrl = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim();
  let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_KEY?.trim() || process.env.VITE_SUPABASE_KEY?.trim();
  let usingAnonKeyOnServer = !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() && (!!process.env.VITE_SUPABASE_KEY?.trim() || !!process.env.SUPABASE_KEY?.trim());
  if (supabaseUrl && supabaseUrl.endsWith("/rest/v1/")) supabaseUrl = supabaseUrl.replace("/rest/v1/", "");
  if (supabaseUrl && supabaseUrl.endsWith("/rest/v1")) supabaseUrl = supabaseUrl.replace("/rest/v1", "");
  if (supabaseUrl?.startsWith('"') && supabaseUrl?.endsWith('"')) {
    supabaseUrl = supabaseUrl.slice(1, -1);
  }
  if (supabaseUrl?.startsWith("'") && supabaseUrl?.endsWith("'")) {
    supabaseUrl = supabaseUrl.slice(1, -1);
  }
  if (supabaseKey?.startsWith('"') && supabaseKey?.endsWith('"')) {
    supabaseKey = supabaseKey.slice(1, -1);
  }
  if (supabaseKey?.startsWith("'") && supabaseKey?.endsWith("'")) {
    supabaseKey = supabaseKey.slice(1, -1);
  }
  if (supabaseKey) {
    let keyIsPublic = supabaseKey.startsWith("sb_publishable_");
    if (!keyIsPublic && supabaseKey.split(".").length === 3) {
      try {
        const payload = JSON.parse(
          Buffer.from(supabaseKey.split(".")[1], "base64url").toString("utf8")
        );
        keyIsPublic = payload?.role === "anon";
      } catch {
      }
    }
    if (keyIsPublic) {
      usingAnonKeyOnServer = true;
      const message = '[AxyFx Journal Server] The Supabase key given to the server is a PUBLIC key (sb_publishable_... or a JWT with role "anon"). It is the key shipped to every browser, so running the server on it grants the server no more access than an anonymous visitor already has, and every admin route silently reads nothing. Use the secret key: Supabase dashboard, Settings, API keys, "sb_secret_..." (formerly service_role).';
      if (IS_PRODUCTION_LIKE) {
        console.error(message);
        throw new Error("A public Supabase key cannot be used as the server key");
      }
      console.warn(message);
    }
  }
  if (supabaseUrl && !supabaseUrl.startsWith("http://") && !supabaseUrl.startsWith("https://")) {
    if (/^[a-zA-Z0-9_-]+$/.test(supabaseUrl)) {
      console.log(`[AxyFx Journal Server] Raw Supabase project reference "${supabaseUrl}" detected. Automatically expanding to "https://${supabaseUrl}.supabase.co"`);
      supabaseUrl = `https://${supabaseUrl}.supabase.co`;
    }
  }
  if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    useSupabase = true;
    console.log("[AxyFx Journal Server] Supabase integration ENABLED!");
    if (usingAnonKeyOnServer) {
      console.warn(
        "[AxyFx Journal Server] WARNING: running on the anon/publishable Supabase key. Set SUPABASE_SERVICE_ROLE_KEY and lock down RLS (see fix_rls_policies.sql) before going live."
      );
    }
  } else {
    if (IS_PRODUCTION_LIKE) {
      console.error(
        "[AxyFx Journal Server] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. Refusing to start in production on the local db.json fallback \u2014 all data would be lost on the next deploy. Set both variables, or set ALLOW_LOCAL_DB=true if you really intend to run on a disk that persists."
      );
      if (process.env.ALLOW_LOCAL_DB !== "true") {
        throw new Error("Supabase credentials are required in production");
      }
      console.warn("[AxyFx Journal Server] ALLOW_LOCAL_DB=true \u2014 continuing on db.json.");
    }
    console.log("[AxyFx Journal Server] Supabase integration DISABLED. Falling back to local db.json");
  }
} catch (err) {
  if (err instanceof Error && (err.message === "Supabase credentials are required in production" || err.message === "A public Supabase key cannot be used as the server key")) throw err;
  console.error("[AxyFx Journal Server] Failed to initialize Supabase client:", err);
  useSupabase = false;
  supabase = null;
}
function loadDatabaseFromFile() {
  const devUsers = DEV_ACCOUNT_EMAIL && DEV_ADMIN_PASSWORD_HASH ? [
    {
      id: DEV_ACCOUNT_ID,
      email: DEV_ACCOUNT_EMAIL,
      name: "Developer",
      password: DEV_ADMIN_PASSWORD_HASH,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      isEmailVerified: true,
      experience: "Professional",
      tradingStyle: "Day Trading",
      mainMarkets: ["Forex", "Gold"],
      onboardingCompleted: true,
      isPro: true
    }
  ] : [];
  const initialDB = {
    users: devUsers,
    accounts: [],
    trades: [],
    riskSettings: [],
    supportTickets: [],
    announcements: [],
    mt5Deals: [],
    payments: []
  };
  try {
    if (fs.existsSync(DB_FILE)) {
      const dataStr = fs.readFileSync(DB_FILE, "utf-8");
      if (dataStr && dataStr.trim()) {
        const parsed = JSON.parse(dataStr);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.users)) {
          return parsed;
        }
      }
    }
  } catch (err) {
    console.error("[AxyFx Journal Server] Error reading local db.json file, using seed data:", err);
  }
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(initialDB, null, 2), "utf-8");
  } catch (err) {
  }
  return initialDB;
}
var userDatabases = /* @__PURE__ */ new Map();
function generateOtp() {
  return Math.floor(1e5 + Math.random() * 9e5).toString();
}
async function sendOtpEmail(email, otp, subject = "Your FX Journal Pro Verification Code") {
  const sendgridKey = process.env.SENDGRID_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL || process.env.SENDER_EMAIL || "noreply@fxjournalpro.com";
  const isReset = subject.toLowerCase().includes("reset");
  const heading = isReset ? "Reset your password" : "Verify your email address";
  const bodyText = isReset ? "You requested a password reset for your FX Journal Pro account. Use the code below to set a new password. This code expires in 10 minutes." : "Thank you for registering with FX Journal Pro. Please use the following one-time password (OTP) to activate your account. This code is valid for 10 minutes.";
  const emailHtml = `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;"><h2 style="color: #0f172a; text-align: center;">${heading}</h2><p>${bodyText}</p><div style="text-align: center; margin: 30px 0;"><span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #2563eb; background-color: #f1f5f9; padding: 10px 20px; border-radius: 8px;">${otp}</span></div><p>If you did not request this code, please ignore this email.</p></div>`;
  if (sendgridKey && sendgridKey !== "YOUR_SENDGRID_API_KEY" && !sendgridKey.startsWith("SG.xxxx")) {
    try {
      console.log(`[SendGrid] Attempting to send OTP email to ${email} from ${fromEmail}...`);
      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + sendgridKey
        },
        body: JSON.stringify({
          personalizations: [
            {
              to: [{ email }]
            }
          ],
          from: {
            email: fromEmail,
            name: "FX Journal Pro"
          },
          subject,
          content: [
            {
              type: "text/html",
              value: emailHtml
            }
          ]
        })
      });
      if (response.status >= 200 && response.status < 300) {
        console.log("[SendGrid] Email OTP sent successfully to " + email);
        return { success: true, provider: "SendGrid" };
      } else {
        const errorText = await response.text();
        console.error("[SendGrid Email Error] Status " + response.status + ":", errorText);
        if (response.status === 403 || errorText.includes("Sender Identity") || errorText.includes("from address")) {
          console.error("[SendGrid Troubleshooting] Make sure SENDGRID_FROM_EMAIL matches the email address verified in SendGrid Single Sender Verification, and that you clicked the verification link sent by SendGrid!");
        }
      }
    } catch (err) {
      console.error("[SendGrid Email Exception]", err);
    }
  }
  if (resendKey && resendKey !== "YOUR_RESEND_API_KEY" && !resendKey.startsWith("re_xxxx")) {
    const configuredFrom = process.env.RESEND_FROM_EMAIL?.trim();
    const resendFrom = configuredFrom ? configuredFrom.includes("<") ? configuredFrom : `FX Journal Pro <${configuredFrom}>` : "FX Journal Pro <onboarding@resend.dev>";
    if (!configuredFrom && IS_PRODUCTION_LIKE) {
      console.warn("[Resend] RESEND_FROM_EMAIL is not set \u2014 sending from the shared sandbox domain. Expect codes to land in spam.");
    }
    try {
      console.log(`[Resend] Attempting to send OTP email to ${email}...`);
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + resendKey
        },
        body: JSON.stringify({
          from: resendFrom,
          to: email,
          subject,
          html: emailHtml
        })
      });
      const data = await response.json();
      if (!response.ok) {
        console.error("[Resend Email Error]", data);
      } else {
        console.log("[Resend] Email OTP sent successfully to " + email);
        return { success: true, provider: "Resend" };
      }
    } catch (error) {
      console.error("[Resend Email Exception]", error);
    }
  }
  console.log("\n============================================================");
  console.log("[DEVELOPMENT / FALLBACK MODE] Email not sent via SMTP/API.");
  console.log("Target Email: " + email + " | OTP Code: " + otp);
  console.log("============================================================\n");
  return { success: false, provider: "None", otp };
}
function createEmptyUserDb(userId, email, injectDummyUser = false) {
  const cleanUserId = userId?.trim() || `user_${crypto2.randomUUID()}`;
  const cleanEmail = email ? email.toLowerCase().trim() : "";
  const isDev = IS_DEV && !!DEV_ACCOUNT_EMAIL && !!DEV_ADMIN_PASSWORD_HASH && cleanEmail === DEV_ACCOUNT_EMAIL;
  const users = [];
  if (injectDummyUser || isDev) {
    users.push({
      id: cleanUserId,
      email: cleanEmail,
      name: isDev ? "Developer" : cleanEmail ? cleanEmail.split("@")[0] : "Trader",
      password: isDev ? DEV_ADMIN_PASSWORD_HASH : void 0,
      role: isDev ? "SUPER_ADMIN" : "USER",
      status: "ACTIVE",
      experience: "Intermediate",
      tradingStyle: "Day Trading",
      mainMarkets: ["Forex", "Gold"],
      onboardingCompleted: isDev ? true : false,
      isPro: isDev ? true : false,
      isEmailVerified: true
    });
  }
  return {
    users,
    accounts: isDev ? [
      {
        id: "acc_demo_1",
        userId: cleanUserId,
        name: "Main Trading Account",
        broker: "MetaTrader 5",
        platform: "MT5",
        accountType: "Demo",
        currency: "USD",
        startingBalance: 1e4,
        currentBalance: 1e4,
        equity: 1e4,
        status: "Active",
        eaToken: `ea_demo_${cleanUserId.slice(-8)}`,
        eaStatus: "Not Connected"
      }
    ] : [],
    trades: [],
    riskSettings: [],
    supportTickets: [],
    mt5Deals: [],
    payments: []
  };
}
function toCamel(obj) {
  if (Array.isArray(obj)) return obj.map(toCamel);
  if (obj !== null && typeof obj === "object") {
    const n = {};
    Object.keys(obj).forEach((k) => {
      const camelKey = k.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
      n[camelKey] = toCamel(obj[k]);
    });
    return n;
  }
  return obj;
}
function toSnake(obj) {
  if (Array.isArray(obj)) return obj.map(toSnake);
  if (obj !== null && typeof obj === "object") {
    const n = {};
    Object.keys(obj).forEach((k) => {
      const snakeKey = k.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      n[snakeKey] = toSnake(obj[k]);
    });
    return n;
  }
  return obj;
}
function generateEaToken() {
  return `ea_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;
}
function apiBaseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"]?.toString().split(",")[0] || req.protocol || "https").trim();
  const host = (req.headers["x-forwarded-host"]?.toString().split(",")[0] || req.get("host") || "www.fxjournalpro.com").trim();
  return `${proto}://${host}/api/mt5`;
}
function generateEaSource(account, apiUrl) {
  const host = apiUrl.replace(/^https?:\/\//, "").split("/")[0];
  return EA_TEMPLATE.split("__FXJP_ACCOUNT_ID__").join(account.id).split("__FXJP_TOKEN__").join(account.eaToken || "").split("__FXJP_API_URL__").join(apiUrl).split("__FXJP_WEBREQUEST_HOST__").join(host);
}
var TRADE_TYPES = /* @__PURE__ */ new Set(["Buy", "Sell", "Deposit", "Withdrawal"]);
var MAX_MONEY = 1e9;
var MAX_LOT = 1e4;
function applyBalanceDelta(account, delta) {
  const next = parseFloat((Number(account?.currentBalance) + Number(delta)).toFixed(2));
  if (!Number.isFinite(next)) {
    console.error("[balance] refusing a non-finite balance", {
      accountId: account?.id,
      currentBalance: account?.currentBalance,
      delta
    });
    return false;
  }
  account.currentBalance = next;
  account.equity = next;
  return true;
}
function validateTradeNumbers(input) {
  const num = (v) => typeof v === "number" ? v : parseFloat(String(v));
  if (input.type !== void 0 && !TRADE_TYPES.has(String(input.type))) {
    return `Trade type must be one of: ${[...TRADE_TYPES].join(", ")}.`;
  }
  const required = [
    ["Lot size", input.lotSize, 0, MAX_LOT],
    ["Entry price", input.entryPrice, 0, MAX_MONEY],
    ["Exit price", input.exitPrice, 0, MAX_MONEY]
  ];
  for (const [label, raw, min, max] of required) {
    if (raw === void 0) continue;
    const v = num(raw);
    if (!Number.isFinite(v)) return `${label} must be a number.`;
    if (v <= min) return `${label} must be greater than ${min}.`;
    if (v > max) return `${label} is unrealistically large.`;
  }
  if (input.profit !== void 0) {
    if (input.profit === null || input.profit === "") return "Profit must be a number.";
    const v = num(input.profit);
    if (!Number.isFinite(v)) return "Profit must be a number.";
    if (Math.abs(v) > MAX_MONEY) return "Profit is unrealistically large.";
  }
  const signed = [
    ["Commission", input.commission],
    ["Swap", input.swap]
  ];
  for (const [label, raw] of signed) {
    if (raw === void 0 || raw === null || raw === "") continue;
    const v = num(raw);
    if (!Number.isFinite(v)) return `${label} must be a number.`;
    if (Math.abs(v) > MAX_MONEY) return `${label} is unrealistically large.`;
  }
  if (input.riskPercentage !== void 0 && input.riskPercentage !== null && input.riskPercentage !== "") {
    const v = num(input.riskPercentage);
    if (!Number.isFinite(v)) return "Risk percentage must be a number.";
    if (v < 0 || v > 100) return "Risk percentage must be between 0 and 100.";
  }
  return null;
}
var SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
var SESSION_COOKIE = "fx_auth_session";
var SESSION_SECRET = (() => {
  const explicit = process.env.SESSION_SECRET?.trim() || process.env.BETTER_AUTH_SECRET?.trim();
  if (explicit && explicit.length >= 32) return explicit;
  if (IS_PRODUCTION_LIKE) {
    if (explicit) {
      console.error("[Auth] SESSION_SECRET is shorter than 32 characters. Refusing to start.");
      throw new Error("SESSION_SECRET must be at least 32 characters in production");
    }
    console.error("[Auth] SESSION_SECRET is not set. Refusing to start in production.");
    throw new Error("SESSION_SECRET is required in production");
  }
  console.warn("[Auth] SESSION_SECRET not set \u2014 using an ephemeral development key.");
  return crypto2.randomBytes(32).toString("hex");
})();
function b64url(input) {
  return Buffer.from(input).toString("base64url");
}
function signSessionValue(payload) {
  const body = b64url(JSON.stringify({ ...payload, iat: Date.now() }));
  const sig = crypto2.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verifySessionValue(raw) {
  if (!raw || typeof raw !== "string") return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto2.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto2.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!parsed?.iat || Date.now() - parsed.iat > SESSION_TTL_MS) return null;
    if (!parsed.userId && !parsed.email) return null;
    const session = { userId: String(parsed.userId || ""), email: String(parsed.email || "") };
    if (isSessionRevoked(session, parsed.iat)) return null;
    return session;
  } catch {
    return null;
  }
}
if (IS_PRODUCTION_LIKE) {
  const hasSendgrid = !!process.env.SENDGRID_API_KEY?.trim();
  const hasResend = !!process.env.RESEND_API_KEY?.trim();
  if (!hasSendgrid && !hasResend) {
    console.error(
      "[Email] No SENDGRID_API_KEY or RESEND_API_KEY is set. Verification codes would only be written to this log, so no user could finish signing up. Set one, or set ALLOW_NO_EMAIL=true to start anyway."
    );
    if (process.env.ALLOW_NO_EMAIL !== "true") {
      throw new Error("An email provider is required in production");
    }
    console.warn("[Email] ALLOW_NO_EMAIL=true \u2014 starting with no way to deliver verification codes.");
  }
}
var sessionRevokedAt = /* @__PURE__ */ new Map();
var REVOCATION_TTL_MS = SESSION_TTL_MS;
function revokeSessionsFor(key) {
  if (!key) return;
  sessionRevokedAt.set(key.toLowerCase(), Date.now());
  const cutoff = Date.now() - REVOCATION_TTL_MS;
  for (const [k, t] of sessionRevokedAt) if (t < cutoff) sessionRevokedAt.delete(k);
}
function isSessionRevoked(session, issuedAt) {
  for (const key of [session.userId, session.email]) {
    if (!key) continue;
    const revokedAt = sessionRevokedAt.get(key.toLowerCase());
    if (revokedAt && issuedAt <= revokedAt) return true;
  }
  return false;
}
function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: IS_PRODUCTION_LIKE,
    sameSite: "lax",
    path: "/"
  };
}
function issueSession(res, user) {
  const token = signSessionValue({ userId: user.id, email: user.email });
  res.cookie(SESSION_COOKIE, token, {
    ...sessionCookieOptions(),
    maxAge: SESSION_TTL_MS
  });
  return token;
}
function clearSession(res) {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
  res.clearCookie("better-auth.session_token", { path: "/" });
  res.clearCookie("__Secure-better-auth.session_token", { path: "/" });
  res.clearCookie("better-auth.state", { path: "/" });
  res.clearCookie("__Secure-better-auth.state", { path: "/" });
}
function sanitizeUser(user) {
  if (!user || typeof user !== "object") return user;
  const clone = { ...user };
  for (const key of [
    "password",
    "passwordHash",
    "password_hash",
    "emailOtp",
    "email_otp",
    "otpExpiresAt",
    "otp_expires_at",
    "resetOtp",
    "reset_otp",
    "resetOtpExpiresAt",
    "reset_otp_expires_at",
    "otpAttempts",
    "otp_attempts",
    "otpSentAt",
    "otp_sent_at",
    "mt5InvestorPassword",
    "mt5_investor_password",
    "eaToken",
    "ea_token"
  ]) {
    delete clone[key];
  }
  if (clone.onboardingCompleted !== void 0 && clone.onboarding_completed === void 0) {
    clone.onboarding_completed = clone.onboardingCompleted;
  }
  if (clone.onboarding_completed !== void 0 && clone.onboardingCompleted === void 0) {
    clone.onboardingCompleted = clone.onboarding_completed;
  }
  return clone;
}
function canExposeOtp() {
  return IS_DEV && process.env.EXPOSE_DEV_OTP !== "false";
}
function sha256Hex(value) {
  return crypto2.createHash("sha256").update(value, "utf8").digest("hex");
}
function safeTokenEqual(a, b) {
  try {
    const aBuf = Buffer.from(a, "utf8");
    const bBuf = Buffer.from(b, "utf8");
    if (aBuf.length !== bBuf.length) return false;
    return crypto2.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}
function hmacSign(message, token) {
  return crypto2.createHmac("sha256", sha256Hex(token)).update(message, "utf8").digest("hex");
}
function eaHmacMessage(timestamp, accountId, rawBody) {
  return `${timestamp}.${accountId}.${rawBody || ""}`;
}
function verifyEaSignature(req, account, token) {
  const headerSig = (req.headers["x-ea-signature"] || "").toString().trim();
  const headerTs = (req.headers["x-ea-timestamp"] || "").toString().trim();
  const accountId = String(account.id || "");
  const rawBody = typeof req.rawBody === "string" ? req.rawBody : "";
  if (!headerSig || !headerTs) {
    return { ok: false, code: "EA_SIGNATURE_MISSING", reason: "Missing X-EA-Signature / X-EA-Timestamp headers" };
  }
  const ts = Date.parse(headerTs);
  if (Number.isNaN(ts)) {
    return { ok: false, code: "EA_BAD_TIMESTAMP", reason: "X-EA-Timestamp is not a valid date" };
  }
  const windowMin = parseFloat(process.env.EA_SIGNATURE_WINDOW_MIN || "5");
  const now = Date.now();
  if (Math.abs(now - ts) > windowMin * 60 * 1e3) {
    return { ok: false, code: "EA_STALE_TIMESTAMP", reason: "Request timestamp outside allowed window" };
  }
  const expected = hmacSign(eaHmacMessage(headerTs, accountId, rawBody), token);
  const provided = Buffer.from(headerSig, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  const sigOk = provided.length === expectedBuf.length && crypto2.timingSafeEqual(provided, expectedBuf);
  if (!sigOk) {
    return { ok: false, code: "SIGNATURE_MISMATCH", reason: "HMAC signature does not match" };
  }
  const requestId = (req.headers["x-ea-request-id"] || "").toString().trim();
  if (requestId) {
    if (!account.eaProcessedRequests) account.eaProcessedRequests = {};
    const cutoff = Date.now() - 24 * 60 * 60 * 1e3;
    const known = account.eaProcessedRequests[requestId];
    if (known && known.ts > cutoff) {
      return { ok: false, code: "EA_REPLAY", reason: "requestId already processed" };
    }
  }
  return { ok: true };
}
function resolveEaToken(req, bodyToken) {
  const auth2 = (req.headers["authorization"] || "").toString().trim();
  if (auth2.startsWith("Bearer ")) return auth2.slice(7).trim();
  if (process.env.EA_ALLOW_LEGACY_TOKEN !== "false") return (bodyToken || "").toString().trim();
  return "";
}
async function authEaRequest(req, res, bodyToken) {
  const accountId = String(req.headers["x-ea-account-id"] || req.body?.accountId || "");
  if (!accountId) {
    res.status(400).json({ error: "accountId is required", code: "EA_ACCOUNT_REQUIRED" });
    return null;
  }
  const db = await findDbByAccountId(accountId);
  if (!db) {
    res.status(404).json({ error: "Account not found", code: "EA_ACCOUNT_NOT_FOUND" });
    return null;
  }
  const account = db.accounts.find((a) => a.id === accountId);
  if (!account) {
    res.status(404).json({ error: "Account not found", code: "EA_ACCOUNT_NOT_FOUND" });
    return null;
  }
  const token = resolveEaToken(req, bodyToken);
  if (!token || !account.eaToken || !safeTokenEqual(token, account.eaToken)) {
    res.status(401).json({ error: "Invalid EA token. Reset the token from your dashboard and download a new EA file.", code: "EA_AUTH_FAILED" });
    return null;
  }
  if (account.eaTokenRevokedAt) {
    res.status(401).json({ error: "EA token revoked. Download a fresh EA file.", code: "EA_TOKEN_REVOKED" });
    return null;
  }
  const sig = verifyEaSignature(req, account, token);
  if (!sig.ok) {
    const legacyAllowed = process.env.EA_ALLOW_LEGACY_TOKEN !== "false";
    const sentSignatureHeaders = !!(req.headers["x-ea-signature"] || "" || (req.headers["x-ea-timestamp"] || ""));
    if (!(legacyAllowed && !sentSignatureHeaders)) {
      res.status(401).json({ error: sig.reason, code: sig.code });
      return null;
    }
  } else {
    const requestId = (req.headers["x-ea-request-id"] || "").toString().trim();
    if (requestId) {
      account.eaProcessedRequests = account.eaProcessedRequests || {};
      account.eaProcessedRequests[requestId] = { ts: Date.now() };
    }
  }
  return { db, account, token };
}
function logEaEvent(db, account, event, level, message, requestId) {
  try {
    if (!Array.isArray(db.mt5SyncLogs)) db.mt5SyncLogs = [];
    db.mt5SyncLogs.push({
      accountId: account.id,
      userId: db.users?.[0]?.id,
      requestId: requestId || null,
      event,
      level,
      message,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (db.mt5SyncLogs.length > 2e3) db.mt5SyncLogs = db.mt5SyncLogs.slice(-2e3);
  } catch (e) {
    console.error("[EA] logEaEvent error:", e);
  }
}
function addEaDeal(db, account, deal, userId) {
  if (!Array.isArray(db.mt5Deals)) db.mt5Deals = [];
  db.mt5Deals.push({ ...deal, accountId: account.id, userId });
  if (!Array.isArray(db.mt5DealsV2)) db.mt5DealsV2 = [];
  const existing = db.mt5DealsV2.find((d) => d.accountId === account.id && d.ticket === deal.ticket);
  if (existing) Object.assign(existing, { ...deal, userId });
  else db.mt5DealsV2.push({ accountId: account.id, userId, ticket: deal.ticket, deal, createdAt: (/* @__PURE__ */ new Date()).toISOString() });
  if (db.mt5DealsV2.length > 2e4) db.mt5DealsV2 = db.mt5DealsV2.slice(-2e4);
}
var DEV_CLOUD_MASTER_KEY = "journalpro-default-mt5-secret-key-32bytes-long";
var warnedAboutCloudMasterKey = false;
function cloudMasterKey() {
  const raw = process.env.MT5_CREDENTIAL_MASTER_KEY?.trim();
  if (!raw) {
    if (IS_PRODUCTION_LIKE) {
      if (!warnedAboutCloudMasterKey) {
        warnedAboutCloudMasterKey = true;
        console.error(
          "[MT5] MT5_CREDENTIAL_MASTER_KEY is not set. Refusing to encrypt investor passwords under the built-in development key, which is a literal in a public repository. Set MT5_CREDENTIAL_MASTER_KEY to 64 hex characters."
        );
      }
      return null;
    }
    const devHex = sha256Hex(DEV_CLOUD_MASTER_KEY);
    return Buffer.from(devHex, "hex");
  }
  const hex = raw.length === 64 ? raw : sha256Hex(raw);
  return Buffer.from(hex, "hex");
}
function encryptInvestorPassword(plaintext) {
  const master = cloudMasterKey();
  if (!master) return null;
  const dek = crypto2.randomBytes(32);
  const iv = crypto2.randomBytes(12);
  const cipher = crypto2.createCipheriv("aes-256-gcm", dek, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const wrapIv = crypto2.randomBytes(12);
  const wc = crypto2.createCipheriv("aes-256-gcm", master, wrapIv);
  const wct = Buffer.concat([wc.update(dek), wc.final()]);
  const wt = wc.getAuthTag();
  const payload = Buffer.concat([iv, tag, wrapIv, wt, wct, ct]);
  const keyId = "env:" + sha256Hex(master.toString("hex")).slice(0, 8);
  return { enc: payload.toString("base64"), keyId };
}
function decryptInvestorPassword(account) {
  try {
    const encB64 = account.investorPasswordEnc;
    if (!encB64) return null;
    const master = cloudMasterKey();
    if (!master) return null;
    const payload = Buffer.from(encB64, "base64");
    const iv = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const wrapIv = payload.subarray(28, 40);
    const wrapTag = payload.subarray(40, 56);
    const wct = payload.subarray(56, 88);
    const ct = payload.subarray(88);
    const wd = crypto2.createDecipheriv("aes-256-gcm", master, wrapIv);
    wd.setAuthTag(wrapTag);
    const dek = Buffer.concat([wd.update(wct), wd.final()]);
    const d = crypto2.createDecipheriv("aes-256-gcm", dek, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch (e) {
    console.error("[Cloud] decryptInvestorPassword failed:", e?.message || e);
    return null;
  }
}
function clearInvestorPassword(account) {
  delete account.investorPasswordEnc;
  delete account.passwordEncNonce;
  delete account.passwordKmsKeyId;
}
function enqueueConnectJob(db, account, action) {
  if (!Array.isArray(db.mt5ConnectJobs)) db.mt5ConnectJobs = [];
  const jobId = `job_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  db.mt5ConnectJobs.push({
    id: jobId,
    accountId: account.id,
    userId: db.users?.[0]?.id,
    action,
    status: "PENDING",
    attempts: 0,
    payload: null,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  return jobId;
}
var META_DEAL_TYPE = {
  DEAL_TYPE_BUY: 0,
  DEAL_TYPE_SELL: 1,
  DEAL_TYPE_BALANCE: 2,
  DEAL_TYPE_CREDIT: 3,
  DEAL_TYPE_CHARGE: 4,
  DEAL_TYPE_CORRECTION: 5,
  DEAL_TYPE_BONUS: 6,
  DEAL_TYPE_COMMISSION: 7,
  DEAL_TYPE_COMMISSION_DAILY: 8,
  DEAL_TYPE_COMMISSION_MONTHLY: 9,
  DEAL_TYPE_COMMISSION_AGENT_DAILY: 10,
  DEAL_TYPE_COMMISSION_AGENT_MONTHLY: 11,
  DEAL_TYPE_INTEREST: 12,
  DEAL_TYPE_BUY_CANCELED: 13,
  DEAL_TYPE_SELL_CANCELED: 14,
  DEAL_TYPE_DIVIDEND: 15,
  DEAL_TYPE_DIVIDEND_FRANKED: 16,
  DEAL_TYPE_TAX: 17
};
var META_DEAL_ENTRY = {
  DEAL_ENTRY_IN: 0,
  DEAL_ENTRY_OUT: 1,
  DEAL_ENTRY_INOUT: 2,
  DEAL_ENTRY_OUT_BY: 3
};
var cloudApi = null;
var cloudWorkers = /* @__PURE__ */ new Map();
var cloudJobLocks = /* @__PURE__ */ new Set();
function getCloudApi() {
  const token = process.env.META_API_TOKEN?.trim();
  if (!token) return null;
  if (!cloudApi) {
    cloudApi = new MetaApi(token, {
      application: "journalpro",
      requestTimeout: 60,
      connectTimeout: 60
    });
  }
  return cloudApi;
}
function cloudErrorCode(e) {
  const code = e?.details?.code || e?.code;
  if (code) return String(code);
  if (e instanceof Error && /timeout/i.test(e.message || "")) return "CLOUD_TIMEOUT";
  return "CLOUD_SYNC_FAILED";
}
function cloudErrorMessage(e) {
  return String(e?.details?.message || e?.message || e || "Unknown cloud worker error");
}
function setCloudJob(db, job, status, message) {
  job.status = status;
  job.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  job.statusMessage = String(message).slice(0, 200);
  logEaEvent(db, { id: job.accountId }, "CLOUD_" + status, "info", String(message).slice(0, 200));
}
function failCloudJob(db, job, account, e) {
  const code = cloudErrorCode(e);
  const message = cloudErrorMessage(e);
  job.status = "FAILED";
  job.errorCode = code;
  job.errorMessage = message.slice(0, 500);
  job.attempts = (job.attempts || 0) + 1;
  job.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (account) {
    account.connectionStatus = "Error";
    account.eaStatus = "Error";
    if (!Array.isArray(db.mt5ConnectionErrors)) db.mt5ConnectionErrors = [];
    db.mt5ConnectionErrors.push({
      accountId: account.id,
      userId: db.users?.[0]?.id,
      errorCode: code,
      errorMessage: message.slice(0, 500),
      occurredAt: (/* @__PURE__ */ new Date()).toISOString(),
      resolvedAt: null
    });
    logEaEvent(db, account, "CLOUD_JOB_FAILED", "error", `${code}: ${message.slice(0, 200)}`);
  }
}
function mapMetaDeal(d) {
  const type = META_DEAL_TYPE[d.type];
  const entry = META_DEAL_ENTRY[d.entryType];
  if (type === void 0 || entry === void 0) return null;
  return {
    ticket: Number(d.id),
    positionId: Number(d.positionId) || 0,
    time: Math.floor(new Date(d.time).getTime() / 1e3),
    type,
    entry,
    magic: Number(d.magic) || 0,
    symbol: String(d.symbol || "").toUpperCase(),
    volume: parseFloat(d.volume) || 0,
    price: parseFloat(d.price) || 0,
    profit: parseFloat(d.profit) || 0,
    commission: parseFloat(d.commission) || 0,
    swap: parseFloat(d.swap) || 0,
    comment: String(d.comment || "")
  };
}
function replaceCloudPositions(db, account, positions) {
  if (!Array.isArray(db.mt5OpenPositions)) db.mt5OpenPositions = [];
  const posMap = /* @__PURE__ */ new Map();
  for (const p of positions) {
    posMap.set(`${account.id}:${p.id}`, {
      accountId: account.id,
      userId: db.users?.[0]?.id,
      positionId: Number(p.id),
      ticket: Number(p.id),
      symbol: String(p.symbol || "").toUpperCase(),
      side: String(p.type === "POSITION_TYPE_BUY" ? "Buy" : p.type === "POSITION_TYPE_SELL" ? "Sell" : p.type || ""),
      volume: p.volume,
      openTime: p.time ? new Date(p.time).toISOString() : (/* @__PURE__ */ new Date()).toISOString(),
      openPrice: p.openPrice,
      sl: p.stopLoss ?? null,
      tp: p.takeProfit ?? null,
      commission: p.commission ?? 0,
      swap: p.swap ?? 0,
      profit: p.profit ?? 0,
      currentPrice: p.currentPrice ?? null,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  db.mt5OpenPositions = db.mt5OpenPositions.filter((op) => op.accountId !== account.id);
  db.mt5OpenPositions.push(...posMap.values());
}
function replaceCloudPendingOrders(db, account, orders) {
  if (!Array.isArray(db.mt5PendingOrders)) db.mt5PendingOrders = [];
  const orderMap = /* @__PURE__ */ new Map();
  for (const o of orders) {
    orderMap.set(`${account.id}:${o.id}`, {
      accountId: account.id,
      userId: db.users?.[0]?.id,
      orderId: Number(o.id),
      symbol: String(o.symbol || "").toUpperCase(),
      type: String(o.type || ""),
      volume: o.volume,
      openPrice: o.openPrice,
      sl: o.stopLoss ?? null,
      tp: o.takeProfit ?? null,
      magic: o.magic ?? 0,
      state: String(o.state || ""),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  db.mt5PendingOrders = db.mt5PendingOrders.filter((op) => op.accountId !== account.id);
  db.mt5PendingOrders.push(...orderMap.values());
}
function pushCloudSnapshot(db, account, info) {
  if (!Array.isArray(db.mt5Snapshots)) db.mt5Snapshots = [];
  db.mt5Snapshots.push({
    accountId: account.id,
    userId: db.users?.[0]?.id,
    balance: info?.balance ?? account.currentBalance ?? null,
    equity: info?.equity ?? account.equity ?? null,
    margin: info?.margin ?? null,
    marginFree: info?.marginFree ?? null,
    marginLevel: info?.marginLevel ?? null,
    currency: info?.currency || account.currency || null,
    leverage: info?.leverage ?? null,
    capturedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  if (db.mt5Snapshots.length > 2e4) db.mt5Snapshots = db.mt5Snapshots.slice(-2e4);
}
async function cloudSyncNow(db, account, session, initial) {
  const conn = session.connection;
  const info = await conn.getAccountInformation();
  const currency = info?.currency || account.currency || "USD";
  const now = /* @__PURE__ */ new Date();
  const backfillDays = Math.max(1, parseInt(process.env.MT5_CLOUD_BACKFILL_DAYS || "90", 10));
  const start = initial ? new Date(now.getTime() - backfillDays * 864e5) : new Date((account.eaLastSyncTime ? new Date(account.eaLastSyncTime).getTime() : now.getTime()) - 12e4);
  let deals = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await conn.getDealsByTimeRange(start, now);
    deals = (res?.deals || []).map(mapMetaDeal).filter(Boolean);
    if (!res?.synchronizing) break;
    await new Promise((r) => setTimeout(r, 1e4 * (attempt + 1)));
  }
  const moneyFlows = deals.filter((d) => !d.symbol && (d.type === DEAL_TYPE_BALANCE || d.type === DEAL_TYPE_CREDIT)).map((d) => ({
    ticket: d.ticket,
    type: d.type === DEAL_TYPE_BALANCE ? d.profit >= 0 ? "DEPOSIT" : "WITHDRAWAL" : "CREDIT",
    amount: d.profit,
    currency,
    time: d.time
  }));
  const summary = applyEaSyncPayload(db, account, deals, moneyFlows, {
    balance: info?.balance,
    equity: info?.equity,
    currency
  });
  let positions = [];
  try {
    positions = await conn.getPositions();
  } catch {
  }
  let orders = [];
  try {
    orders = await conn.getOrders();
  } catch {
  }
  replaceCloudPositions(db, account, positions);
  replaceCloudPendingOrders(db, account, orders);
  account.currency = currency;
  if (info?.leverage) account.leverage = info?.leverage;
  if (info?.server) account.mt5Server = info?.server;
  pushCloudSnapshot(db, account, info);
  account.eaLastSyncTime = (/* @__PURE__ */ new Date()).toISOString();
  account.lastHeartbeatAt = (/* @__PURE__ */ new Date()).toISOString();
  logEaEvent(
    db,
    account,
    "CLOUD_SYNC",
    "info",
    `Cloud sync: ${summary.added} new deals, ${summary.moneyFlowAdded} new money flows, ${positions.length} open positions, ${orders.length} pending orders`
  );
  await saveDatabase(db, db.users?.[0]?.email);
}
async function runCloudConnect(db, job, account) {
  setCloudJob(db, job, "IN_PROGRESS", "Decrypting MT5 investor credentials");
  const password = decryptInvestorPassword(account);
  if (!password) {
    throw new Error("Investor password could not be decrypted (is MT5_CREDENTIAL_MASTER_KEY configured?)");
  }
  const login = String(account.mt5Login || "").trim();
  const server = String(account.mt5Server || "").trim();
  if (!login || !server) throw new Error("MT5 login/server are not set on this account");
  account.isMt5Sync = true;
  const api = getCloudApi();
  if (!api) throw new Error("META_API_TOKEN is not configured on this deployment");
  let ma = null;
  try {
    setCloudJob(db, job, "PROVISIONING", "Locating existing MetaApi terminal");
    const accounts = await api.metatraderAccountApi.getAccountsWithInfiniteScrollPagination();
    let ma2 = accounts.find(
      (a) => a.version === 5 && String(a.login) === login && String(a.server) === server
    );
    if (ma2) {
      setCloudJob(db, job, "PROVISIONING", "Updating credentials on existing terminal");
      try {
        await ma2.update({ name: ma2.name || `JournalPro ${login}`, server, magic: 0, password });
      } catch (e) {
        console.error("[Cloud] update existing account failed:", cloudErrorMessage(e));
      }
      setCloudJob(db, job, "DEPLOYING", "Restarting terminal with updated credentials");
      await ma2.redeploy();
      await ma2.waitDeployed(300, 5e3);
    } else {
      setCloudJob(db, job, "PROVISIONING", "Creating cloud terminal (a few minutes)");
      ma2 = await api.metatraderAccountApi.createAccount({
        name: `JournalPro ${login}`,
        type: "cloud-g2",
        login,
        password,
        server,
        platform: "mt5",
        magic: 0,
        quoteStreamingIntervalInSeconds: 0
      });
      if (ma2.state !== "DEPLOYED") {
        try {
          await ma2.deploy();
        } catch {
        }
      }
      setCloudJob(db, job, "DEPLOYING", "Starting cloud terminal (a few minutes)");
      await ma2.waitDeployed(300, 5e3);
    }
    account.mt5CloudAccountId = ma2.id;
    account.mt5CloudRegion = ma2.region;
    setCloudJob(db, job, "CONNECTING", "Connecting to broker");
    await ma2.waitConnected(300, 5e3);
    const connection = ma2.getRPCConnection();
    await connection.connect();
    await connection.waitSynchronized(300);
    cloudWorkers.set(account.id, { account: ma2, connection, failing: false });
    setCloudJob(db, job, "SYNCING", "Importing account history");
    await cloudSyncNow(db, account, { account: ma2, connection, failing: false }, true);
    setCloudJob(db, job, "IN_PROGRESS", "Deprovisioning temporary cloud terminal");
    try {
      await connection.disconnect();
    } catch {
    }
    try {
      await ma2.remove();
    } catch {
    }
    cloudWorkers.delete(account.id);
    delete account.mt5CloudAccountId;
    delete account.mt5CloudRegion;
    account.syncMethod = "CLOUD";
    account.connectionStatus = "Connected";
    account.eaStatus = "Connected";
    account.eaTerminalLogin = login;
    account.eaTerminalServer = server;
    account.eaConnectedAt = account.eaConnectedAt || (/* @__PURE__ */ new Date()).toISOString();
    setCloudJob(db, job, "CONNECTED", "Cloud sync completed and terminal removed");
    logEaEvent(db, account, "CLOUD_CONNECTED", "info", "Cloud sync connected and synced via MetaApi");
    await saveDatabase(db, db.users?.[0]?.email);
  } catch (e) {
    if (ma) {
      try {
        await ma.remove();
      } catch {
      }
    }
    cloudWorkers.delete(account.id);
    delete account.mt5CloudAccountId;
    throw e;
  }
}
async function runCloudSyncNow(db, job, account) {
  setCloudJob(db, job, "IN_PROGRESS", "Decrypting MT5 investor credentials for sync");
  const password = decryptInvestorPassword(account);
  if (!password) {
    throw new Error("Investor password could not be decrypted");
  }
  const login = String(account.mt5Login || "").trim();
  const server = String(account.mt5Server || "").trim();
  if (!login || !server) throw new Error("MT5 login/server are not set");
  const api = getCloudApi();
  if (!api) throw new Error("META_API_TOKEN is not configured");
  let ma = null;
  try {
    setCloudJob(db, job, "PROVISIONING", "Creating temporary cloud terminal for sync (a few minutes)");
    ma = await api.metatraderAccountApi.createAccount({
      name: `JournalPro Sync ${login}`,
      type: "cloud-g2",
      login,
      password,
      server,
      platform: "mt5",
      magic: 0,
      quoteStreamingIntervalInSeconds: 0
    });
    if (ma.state !== "DEPLOYED") {
      try {
        await ma.deploy();
      } catch {
      }
    }
    setCloudJob(db, job, "DEPLOYING", "Starting temporary cloud terminal");
    await ma.waitDeployed(300, 5e3);
    setCloudJob(db, job, "CONNECTING", "Connecting to broker");
    await ma.waitConnected(300, 5e3);
    const connection = ma.getRPCConnection();
    await connection.connect();
    await connection.waitSynchronized(300);
    setCloudJob(db, job, "SYNCING", "Fetching new trades");
    await cloudSyncNow(db, account, { account: ma, connection, failing: false }, false);
    setCloudJob(db, job, "IN_PROGRESS", "Deprovisioning temporary cloud terminal");
    try {
      await connection.disconnect();
    } catch {
    }
    try {
      await ma.remove();
    } catch {
    }
    setCloudJob(db, job, "DONE", "Sync completed successfully");
    logEaEvent(db, account, "CLOUD_SYNC_DONE", "info", "Manual cloud sync completed");
    await saveDatabase(db, db.users?.[0]?.email);
  } catch (e) {
    if (ma) {
      try {
        await ma.remove();
      } catch {
      }
    }
    throw e;
  }
}
async function runCloudDisconnect(db, job, account) {
  setCloudJob(db, job, "IN_PROGRESS", "Deprovisioning cloud terminal");
  const api = getCloudApi();
  if (api) {
    const cached = cloudWorkers.get(account.id);
    if (cached) {
      try {
        await cached.connection.disconnect();
      } catch {
      }
      try {
        await cached.account.remove();
      } catch {
      }
      cloudWorkers.delete(account.id);
    } else if (account.mt5CloudAccountId) {
      try {
        const ma = await api.metatraderAccountApi.getAccount(account.mt5CloudAccountId);
        await ma.remove();
      } catch {
      }
    }
  }
  delete account.mt5CloudAccountId;
  delete account.mt5CloudRegion;
  setCloudJob(db, job, "DONE", "Cloud sync disconnected");
  logEaEvent(db, account, "CLOUD_DISCONNECTED", "info", "Cloud terminal deprovisioned");
  await saveDatabase(db, db.users?.[0]?.email);
}
async function runCloudJob(db, job) {
  const account = db.accounts?.find((a) => a.id === job.accountId);
  if (!account) {
    failCloudJob(db, job, null, new Error("Account not found"));
    return;
  }
  try {
    if (job.action === "CONNECT") await runCloudConnect(db, job, account);
    else if (job.action === "DISCONNECT") await runCloudDisconnect(db, job, account);
    else if (job.action === "SYNC_NOW") await runCloudSyncNow(db, job, account);
    else throw new Error(`Unknown job action: ${job.action}`);
  } catch (e) {
    failCloudJob(db, job, account, e);
  }
}
async function processCloudJobs() {
  const api = getCloudApi();
  if (!api) return;
  for (const db of userDatabases.values()) {
    if (!db || !Array.isArray(db.mt5ConnectJobs)) continue;
    for (const job of db.mt5ConnectJobs) {
      if (job.status !== "PENDING") continue;
      if (cloudJobLocks.has(job.id)) continue;
      cloudJobLocks.add(job.id);
      setImmediate(() => {
        runCloudJob(db, job).catch(() => {
        }).finally(() => cloudJobLocks.delete(job.id));
      });
    }
  }
}
function startCloudWorker() {
  if (IS_SERVERLESS2) {
    console.warn("[MT5 Cloud] Background worker not started: serverless runtime has no long-lived process. Run the cloud sync on a dedicated host or an external scheduler.");
    return;
  }
  setInterval(() => {
    processCloudJobs().catch(() => {
    });
  }, 5e3);
  const syncSeconds = Math.max(10, parseInt(process.env.MT5_CLOUD_SYNC_INTERVAL_SECONDS || "60", 10));
}
function startCloudWorkers() {
  setInterval(() => {
    processCloudJobs().catch(() => {
    });
  }, 2e3);
}
var finiteNumber = () => z.number().finite();
var positiveInt = () => z.number().int().positive();
var boundedString = (max) => z.string().max(max);
var legacyTokenField = { token: boundedString(128).optional() };
var EaValidateSchema = z.object({
  accountId: boundedString(64),
  login: boundedString(24),
  server: boundedString(64),
  build: positiveInt().optional(),
  terminal: z.object({
    login: boundedString(24).optional(),
    server: boundedString(64).optional(),
    build: positiveInt().optional()
  }).optional(),
  ...legacyTokenField
}).strict();
var EaAccountSchema = z.object({
  accountId: boundedString(64),
  balance: finiteNumber(),
  equity: finiteNumber(),
  margin: finiteNumber().optional(),
  marginFree: finiteNumber().optional(),
  marginLevel: finiteNumber().optional(),
  currency: boundedString(8).optional(),
  leverage: z.number().int().min(1).max(1e4).optional(),
  ...legacyTokenField
}).strict();
var EaPositionSchema = z.object({
  accountId: boundedString(64),
  positions: z.array(z.object({
    positionId: z.union([z.number(), z.string()]),
    ticket: z.union([z.number(), z.string()]),
    symbol: boundedString(32),
    side: boundedString(8),
    volume: finiteNumber(),
    openTime: z.number(),
    openPrice: finiteNumber(),
    sl: finiteNumber().nullable().optional(),
    tp: finiteNumber().nullable().optional(),
    commission: finiteNumber().optional(),
    swap: finiteNumber().optional(),
    profit: finiteNumber().optional(),
    currentPrice: finiteNumber().optional()
  }).strict()).max(500),
  ...legacyTokenField
}).strict();
var EaOrderSchema = z.object({
  accountId: boundedString(64),
  orders: z.array(z.object({
    orderId: z.union([z.number(), z.string()]),
    symbol: boundedString(32),
    type: boundedString(32),
    volume: finiteNumber(),
    openPrice: finiteNumber(),
    sl: finiteNumber().nullable().optional(),
    tp: finiteNumber().nullable().optional(),
    magic: z.number().int().optional(),
    state: boundedString(16).optional()
  }).strict()).max(500),
  ...legacyTokenField
}).strict();
var EaDealSchema = z.object({
  ticket: z.union([z.number(), z.string()]),
  positionId: z.union([z.number(), z.string()]).optional(),
  time: z.number(),
  type: z.number().int(),
  entry: z.number().int(),
  magic: z.number().int().optional(),
  symbol: boundedString(32).optional(),
  volume: finiteNumber().optional(),
  price: finiteNumber().optional(),
  profit: finiteNumber().optional(),
  commission: finiteNumber().optional(),
  swap: finiteNumber().optional(),
  comment: boundedString(200).optional()
}).strict();
var EaMoneyFlowSchema = z.object({
  ticket: z.union([z.number(), z.string()]),
  type: z.enum(["DEPOSIT", "WITHDRAWAL", "CREDIT", "INTEREST"]),
  amount: finiteNumber(),
  currency: boundedString(8).optional(),
  time: z.number()
}).strict();
var EaSyncSchema = z.object({
  accountId: boundedString(64),
  deals: z.array(EaDealSchema).max(200),
  moneyFlows: z.array(EaMoneyFlowSchema).max(200).optional(),
  account: z.object({
    balance: finiteNumber().optional(),
    equity: finiteNumber().optional(),
    currency: boundedString(8).optional()
  }).optional(),
  ...legacyTokenField
}).strict();
var EaHeartbeatSchema = z.object({
  accountId: boundedString(64),
  balance: finiteNumber().optional(),
  equity: finiteNumber().optional(),
  tradeCount: z.number().int().nonnegative().optional(),
  ...legacyTokenField
}).strict();
var EaErrorSchema = z.object({
  accountId: boundedString(64),
  code: boundedString(64).optional(),
  message: boundedString(500).optional(),
  terminal: boundedString(200).optional(),
  ...legacyTokenField
}).strict();
var CloudConnectSchema = z.object({
  accountId: boundedString(64),
  login: boundedString(24).regex(/^\d{1,12}$/, "MT5 login must be numeric"),
  server: boundedString(64),
  investorPassword: boundedString(256).min(1, "Investor password is required")
}).strict();
var CloudDisconnectSchema = z.object({
  accountId: boundedString(64)
}).strict();
function validateEaBody(res, schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    res.status(400).json({
      error: "Invalid payload",
      code: "EA_BAD_PAYLOAD",
      detail: first ? `${first.path.join(".")}: ${first.message}` : "schema mismatch"
    });
    return null;
  }
  return parsed.data;
}
async function findDbByAccountId(accountId) {
  if (useSupabase) {
    try {
      const { data } = await supabase.from("trading_accounts").select("user_id").eq("id", accountId).maybeSingle();
      if (data?.user_id) return ensureUserDbLoaded(data.user_id, "");
    } catch (e) {
      console.error("[EA] findDbByAccountId supabase error:", e);
    }
    return null;
  }
  for (const d of userDatabases.values()) {
    if (d && Array.isArray(d.accounts) && d.accounts.some((a) => a.id === accountId)) return d;
  }
  return null;
}
var DEAL_TYPE_SELL = 1;
var DEAL_TYPE_BALANCE = 2;
var DEAL_TYPE_CREDIT = 3;
var ENTRY_IN = 0;
var ENTRY_OUT = 1;
var ENTRY_INOUT = 2;
function normalizeDeal(raw) {
  return {
    ticket: Number(raw.ticket),
    positionId: Number(raw.positionId) || 0,
    time: Number(raw.time),
    type: Number(raw.type),
    entry: Number(raw.entry),
    magic: Number(raw.magic) || 0,
    symbol: String(raw.symbol || "").toUpperCase(),
    volume: parseFloat(raw.volume) || 0,
    price: parseFloat(raw.price) || 0,
    profit: parseFloat(raw.profit) || 0,
    commission: parseFloat(raw.commission) || 0,
    swap: parseFloat(raw.swap) || 0,
    comment: String(raw.comment || "")
  };
}
function recomputeMt5TradesForAccount(account, deals, skipBalanceTicket) {
  const result = [];
  const posGroups = /* @__PURE__ */ new Map();
  for (const d of deals) {
    if (d.symbol && (d.entry === ENTRY_IN || d.entry === ENTRY_OUT || d.entry === ENTRY_INOUT)) {
      if (!posGroups.has(d.positionId)) posGroups.set(d.positionId, []);
      posGroups.get(d.positionId).push(d);
    }
  }
  for (const [posId, list] of posGroups) {
    const inDeals = list.filter((d) => d.entry === ENTRY_IN);
    const outDeals = list.filter((d) => d.entry === ENTRY_OUT || d.entry === ENTRY_INOUT);
    if (outDeals.length === 0) continue;
    const inDeal = inDeals[0] || outDeals[0];
    const lastOut = outDeals[outDeals.length - 1];
    const totalProfit = list.reduce((s, d) => s + d.profit, 0);
    const totalComm = list.reduce((s, d) => s + d.commission, 0);
    const totalSwap = list.reduce((s, d) => s + d.swap, 0);
    result.push({
      id: `mt5ea_${account.id}_${posId}`,
      accountId: account.id,
      date: new Date(inDeal.time * 1e3).toISOString(),
      exitTime: new Date(lastOut.time * 1e3).toISOString(),
      symbol: lastOut.symbol || inDeal.symbol || "UNKNOWN",
      type: lastOut.type === DEAL_TYPE_SELL ? "Sell" : "Buy",
      lotSize: lastOut.volume || inDeal.volume || 0.01,
      entryPrice: inDeal.price,
      exitPrice: lastOut.price,
      profit: totalProfit,
      commission: totalComm,
      swap: totalSwap,
      riskPercentage: 1,
      strategy: "MT5 EA Sync",
      emotion: "Calm",
      notes: "",
      screenshot: "",
      tags: ["MT5 Sync"],
      isMt5Sync: true,
      eaDealId: lastOut.ticket,
      eaPositionId: posId
    });
  }
  for (const d of deals) {
    if (d.symbol) continue;
    if (d.type !== DEAL_TYPE_BALANCE && d.type !== DEAL_TYPE_CREDIT) continue;
    if (skipBalanceTicket !== void 0 && d.ticket === skipBalanceTicket) continue;
    const type = d.profit >= 0 ? "Deposit" : "Withdrawal";
    result.push({
      id: `mt5ea_${account.id}_dep_${d.ticket}`,
      accountId: account.id,
      date: new Date(d.time * 1e3).toISOString(),
      symbol: "BALANCE",
      type,
      lotSize: 0,
      entryPrice: 0,
      exitPrice: 0,
      profit: d.profit,
      commission: d.commission,
      swap: d.swap,
      riskPercentage: 1,
      strategy: "MT5 EA Sync",
      emotion: "Calm",
      notes: "",
      screenshot: "",
      tags: ["MT5 Sync"],
      isMt5Sync: true,
      eaDealId: d.ticket,
      eaPositionId: 0
    });
  }
  return result;
}
async function ensureUserDbLoaded(userId, email) {
  let cleanUserId = userId?.trim() || "";
  let cleanEmail = email?.toLowerCase().trim() || "";
  if (cleanUserId.includes("@") && !cleanEmail) {
    cleanEmail = cleanUserId.toLowerCase();
    cleanUserId = "";
  }
  if (!cleanUserId && !cleanEmail) {
    return createEmptyUserDb("guest_user", "guest@example.com", false);
  }
  if (useSupabase && (cleanUserId || cleanEmail)) {
    try {
      const loadUserData = async (uid) => {
        const [
          { data: users },
          { data: accounts },
          { data: trades },
          { data: riskSettings },
          { data: supportTickets },
          { data: mt5Deals }
        ] = await Promise.all([
          supabase.from("users").select("*").eq("id", uid),
          supabase.from("trading_accounts").select("*").eq("user_id", uid),
          supabase.from("trades").select("*").eq("user_id", uid),
          supabase.from("risk_settings").select("*").eq("user_id", uid),
          supabase.from("support_tickets").select("*").eq("user_id", uid),
          supabase.from("mt5_deals").select("*").eq("user_id", uid)
        ]);
        return {
          users: toCamel(users || []),
          accounts: toCamel(accounts || []),
          trades: toCamel(trades || []),
          riskSettings: toCamel(riskSettings || []),
          supportTickets: toCamel(supportTickets || []),
          mt5Deals: toCamel(mt5Deals || []),
          payments: []
        };
      };
      if (!cleanUserId && cleanEmail) {
        const { data: userByEmail } = await supabase.from("users").select("id").eq("email", cleanEmail).maybeSingle();
        if (userByEmail?.id) {
          cleanUserId = userByEmail.id;
        }
      }
      if (!cleanUserId) {
        return createEmptyUserDb("", cleanEmail, false);
      }
      let loadedDb = await loadUserData(cleanUserId);
      if (loadedDb.users.length === 0 && cleanEmail) {
        const { data: userByEmail } = await supabase.from("users").select("id").eq("email", cleanEmail).maybeSingle();
        if (userByEmail?.id && userByEmail.id !== cleanUserId) {
          cleanUserId = userByEmail.id;
          loadedDb = await loadUserData(cleanUserId);
        }
      }
      const cached2 = userDatabases.get(cleanUserId) || (cleanEmail ? userDatabases.get(cleanEmail) : null);
      if (cached2) {
        if (loadedDb.accounts.length === 0 && cached2.accounts?.length > 0) {
          loadedDb.accounts = cached2.accounts.filter((a) => a.userId === cleanUserId || !a.userId);
        }
        if (loadedDb.trades.length === 0 && cached2.trades?.length > 0) {
          loadedDb.trades = cached2.trades.filter((t) => t.userId === cleanUserId || !t.userId);
        }
        if (loadedDb.riskSettings.length === 0 && cached2.riskSettings?.length > 0) {
          loadedDb.riskSettings = cached2.riskSettings;
        }
        if (!loadedDb.mt5Deals && cached2.mt5Deals?.length > 0) {
          loadedDb.mt5Deals = cached2.mt5Deals;
        }
        if (loadedDb.accounts.length > 0) {
          for (const la of loadedDb.accounts) {
            const ca = (cached2.accounts || []).find((x) => x.id === la.id);
            if (ca && ca.eaStatus) {
              if (ca.eaStatus) la.eaStatus = ca.eaStatus;
              if (ca.eaLastDealId !== void 0) la.eaLastDealId = ca.eaLastDealId;
              if (ca.eaLastSyncTime) la.eaLastSyncTime = ca.eaLastSyncTime;
              if (ca.eaSyncTradeCount !== void 0) la.eaSyncTradeCount = ca.eaSyncTradeCount;
              if (ca.eaConnectedAt) la.eaConnectedAt = ca.eaConnectedAt;
              if (ca.eaTerminalLogin) la.eaTerminalLogin = ca.eaTerminalLogin;
              if (ca.eaTerminalServer) la.eaTerminalServer = ca.eaTerminalServer;
              if (ca.eaToken) la.eaToken = ca.eaToken;
            }
          }
        }
        if (cached2.users && cached2.users.length > 0 && loadedDb.users.length > 0) {
          const cachedUser = cached2.users[0];
          const loadedUser = loadedDb.users[0];
          if (cachedUser.resetOtp) loadedUser.resetOtp = cachedUser.resetOtp;
          if (cachedUser.resetOtpExpiresAt) loadedUser.resetOtpExpiresAt = cachedUser.resetOtpExpiresAt;
          if (cachedUser.emailOtp) loadedUser.emailOtp = cachedUser.emailOtp;
          if (cachedUser.otpExpiresAt) loadedUser.otpExpiresAt = cachedUser.otpExpiresAt;
          if (cachedUser.otpAttempts !== void 0) loadedUser.otpAttempts = cachedUser.otpAttempts;
          if (cachedUser.otpSentAt) loadedUser.otpSentAt = cachedUser.otpSentAt;
        }
      }
      if (cleanUserId) userDatabases.set(cleanUserId, loadedDb);
      return loadedDb;
    } catch (err) {
      console.error("[AxyFx SQL Query Error]", err);
    }
  }
  const cached = userDatabases.get(cleanUserId) || (cleanEmail ? userDatabases.get(cleanEmail) : null);
  if (cached) return cached;
  try {
    const shared = loadDatabaseFromFile();
    const seeded = (shared.users || []).find((u) => cleanUserId && u.id === cleanUserId || cleanEmail && String(u.email || "").toLowerCase() === cleanEmail);
    if (seeded) {
      const accounts = (shared.accounts || []).filter((a) => a.userId === seeded.id);
      const accountIds = new Set(accounts.map((a) => a.id));
      const fromFile = {
        users: [seeded],
        accounts,
        trades: (shared.trades || []).filter((t) => t.userId === seeded.id || accountIds.has(t.accountId)),
        riskSettings: (shared.riskSettings || []).filter((r) => r.userId === seeded.id),
        supportTickets: (shared.supportTickets || []).filter((t) => t.userId === seeded.id),
        mt5Deals: [],
        payments: (shared.payments || []).filter((p) => p.userId === seeded.id)
      };
      userDatabases.set(seeded.id, fromFile);
      if (seeded.email) userDatabases.set(String(seeded.email).toLowerCase(), fromFile);
      return fromFile;
    }
  } catch (err) {
    console.error("[ensureUserDbLoaded] shared file read failed:", err);
  }
  const fresh = createEmptyUserDb(cleanUserId, cleanEmail, false);
  if (cleanUserId) userDatabases.set(cleanUserId, fresh);
  if (cleanEmail) userDatabases.set(cleanEmail.toLowerCase(), fresh);
  return fresh;
}
async function saveDatabase(data, overrideUserId, overrideEmail, previousAliases) {
  if (!data) return {};
  const usersToSync = Array.isArray(data.users) ? data.users : [];
  if (usersToSync.length === 0) return {};
  const targetUser = usersToSync[0];
  const uid = targetUser.id;
  const email = targetUser.email;
  if (!uid) return {};
  if (uid) userDatabases.set(uid, data);
  if (email) userDatabases.set(email.toLowerCase(), data);
  if (overrideUserId) userDatabases.set(overrideUserId, data);
  if (overrideEmail) userDatabases.set(overrideEmail.toLowerCase(), data);
  if (previousAliases?.email && previousAliases.email.toLowerCase() !== email?.toLowerCase()) {
    userDatabases.delete(previousAliases.email.toLowerCase());
  }
  if (!useSupabase) return {};
  try {
    if (data.users && data.users.length > 0) {
      const validUserCols = /* @__PURE__ */ new Set([
        "id",
        "email",
        "name",
        "password",
        "experience",
        "trading_style",
        "main_markets",
        "is_pro",
        "is_email_verified",
        "created_at",
        "email_otp",
        "otp_expires_at",
        "otp_attempts",
        "otp_sent_at",
        "reset_otp",
        "reset_otp_expires_at",
        "onboarding_completed",
        "preferences",
        "auth_provider",
        "last_login",
        "role",
        "status",
        "plan",
        "pro_until",
        "referred_by",
        "referred_at",
        "allow_partner_trade_view",
        "mentor_access"
      ]);
      const sanitizedUsers = toSnake(data.users).map((u) => {
        const clean = {};
        for (const key of Object.keys(u)) {
          if (validUserCols.has(key)) {
            clean[key] = u[key];
          }
        }
        return clean;
      });
      const { error: err1 } = await supabase.from("users").upsert(sanitizedUsers, { onConflict: "id" });
      if (err1) {
        console.error("[saveDatabase] users upsert error:", err1);
        return { usersError: err1 };
      }
    }
    if (data.accounts && data.accounts.length > 0) {
      const validAccCols = /* @__PURE__ */ new Set([
        "id",
        "user_id",
        "name",
        "broker",
        "platform",
        "account_type",
        "institution_type",
        "currency",
        "starting_balance",
        "current_balance",
        "equity",
        "status",
        "is_mt5_sync",
        "ea_token",
        "ea_status",
        "ea_last_deal_id",
        "ea_last_sync_time",
        "ea_sync_trade_count",
        "ea_connected_at",
        "ea_terminal_login",
        "ea_terminal_server",
        "created_at",
        "updated_at",
        "mt5_login",
        "mt5_server",
        "mt5_build",
        "sync_method",
        "connection_status",
        "last_heartbeat_at",
        "backfill_start",
        "backfill_end",
        "investor_password_enc",
        "password_enc_nonce",
        "password_kms_key_id",
        "disconnected_at"
      ]);
      const accs = toSnake(data.accounts).map((a) => {
        const clean = {};
        for (const key of Object.keys(a)) {
          if (validAccCols.has(key)) {
            clean[key] = a[key];
          }
        }
        clean.user_id = clean.user_id || uid;
        return clean;
      });
      const { error: err2 } = await supabase.from("trading_accounts").upsert(accs, { onConflict: "id" });
      if (err2) {
        console.error("[saveDatabase] trading_accounts upsert error:", err2);
        return { accountsError: err2 };
      }
    }
    if (data.trades && data.trades.length > 0) {
      const validTradeCols = /* @__PURE__ */ new Set([
        "id",
        "account_id",
        "user_id",
        "date",
        "symbol",
        "type",
        "lot_size",
        "entry_price",
        "exit_price",
        "exit_time",
        "stop_loss",
        "take_profit",
        "profit",
        "commission",
        "swap",
        "risk_percentage",
        "strategy",
        "emotion",
        "notes",
        "screenshot",
        "tags",
        "is_mt5_sync",
        "ea_deal_id",
        "ea_position_id",
        "created_at"
      ]);
      const trds = toSnake(data.trades).map((t) => {
        const clean = {};
        for (const key of Object.keys(t)) {
          if (validTradeCols.has(key)) clean[key] = t[key];
        }
        if (clean.ea_deal_id === void 0 && t.ticket !== void 0 && Number.isFinite(Number(t.ticket))) {
          clean.ea_deal_id = Number(t.ticket);
        }
        clean.user_id = clean.user_id || uid;
        return clean;
      });
      const { error: err3 } = await supabase.from("trades").upsert(trds, { onConflict: "id" });
      if (err3) {
        console.error("[saveDatabase] trades upsert error:", err3);
        return { tradesError: err3 };
      }
    }
    if (data.riskSettings && data.riskSettings.length > 0) {
      const rs = toSnake(data.riskSettings).map((r) => ({ ...r, user_id: r.user_id || uid }));
      const { error: err4 } = await supabase.from("risk_settings").upsert(rs, { onConflict: "id" });
      if (err4) console.error("[saveDatabase] risk_settings upsert error:", err4);
    }
    if (data.supportTickets && data.supportTickets.length > 0) {
      const tix = toSnake(data.supportTickets).map((t) => ({ ...t, user_id: t.user_id || uid }));
      await supabase.from("support_tickets").upsert(tix, { onConflict: "id" });
    }
    if (data.mt5Deals && data.mt5Deals.length > 0) {
      const deals = toSnake(data.mt5Deals).map((d) => ({
        id: String(d.ticket),
        account_id: d.account_id || d.accountId,
        position_id: d.position_id ?? d.positionId ?? 0,
        deal: d,
        user_id: d.user_id || uid
      }));
      await supabase.from("mt5_deals").upsert(deals, { onConflict: "id" });
    }
    if (data.mt5DealsV2 && data.mt5DealsV2.length > 0) {
      const dealsV2 = data.mt5DealsV2.map((d) => ({
        account_id: d.accountId,
        user_id: d.userId || uid,
        ticket: Number(d.ticket),
        position_id: d.deal?.positionId ?? d.deal?.position_id ?? 0,
        deal: d.deal
      }));
      const { error: errV2 } = await supabase.from("mt5_deals_v2").upsert(dealsV2, { onConflict: "account_id,ticket" });
      if (errV2) console.error("[saveDatabase] mt5_deals_v2 upsert error:", errV2);
    }
    if (data.mt5Snapshots && data.mt5Snapshots.length > 0) {
      const snaps = data.mt5Snapshots.map((s) => ({
        account_id: s.accountId,
        user_id: s.userId || uid,
        balance: s.balance,
        equity: s.equity,
        margin: s.margin,
        margin_free: s.marginFree,
        margin_level: s.marginLevel,
        currency: s.currency,
        leverage: s.leverage,
        captured_at: s.capturedAt
      }));
      const { error: snapErr } = await supabase.from("mt5_account_snapshots").insert(snaps);
      if (snapErr) console.error("[saveDatabase] mt5_account_snapshots insert error:", snapErr);
    }
    if (data.mt5OpenPositions) {
      const posAccountIds = [...new Set(data.mt5OpenPositions.map((p) => p.accountId))];
      for (const aid of posAccountIds) {
        await supabase.from("mt5_open_positions").delete().eq("account_id", aid);
      }
      if (data.mt5OpenPositions.length > 0) {
        const posRows = data.mt5OpenPositions.map((p) => ({
          account_id: p.accountId,
          user_id: p.userId || uid,
          position_id: p.positionId,
          ticket: p.ticket,
          symbol: p.symbol,
          side: p.side,
          volume: p.volume,
          open_time: p.openTime,
          open_price: p.openPrice,
          sl: p.sl,
          tp: p.tp,
          commission: p.commission,
          swap: p.swap,
          profit: p.profit,
          current_price: p.currentPrice,
          updated_at: p.updatedAt
        }));
        const { error: posErr } = await supabase.from("mt5_open_positions").insert(posRows);
        if (posErr) console.error("[saveDatabase] mt5_open_positions insert error:", posErr);
      }
    }
    if (data.mt5PendingOrders) {
      const orderAccountIds = [...new Set(data.mt5PendingOrders.map((o) => o.accountId))];
      for (const aid of orderAccountIds) {
        await supabase.from("mt5_pending_orders").delete().eq("account_id", aid);
      }
      if (data.mt5PendingOrders.length > 0) {
        const orderRows = data.mt5PendingOrders.map((o) => ({
          account_id: o.accountId,
          user_id: o.userId || uid,
          order_id: o.orderId,
          symbol: o.symbol,
          type: o.type,
          volume: o.volume,
          open_price: o.openPrice,
          sl: o.sl,
          tp: o.tp,
          magic: o.magic,
          state: o.state,
          updated_at: o.updatedAt
        }));
        const { error: orderErr } = await supabase.from("mt5_pending_orders").insert(orderRows);
        if (orderErr) console.error("[saveDatabase] mt5_pending_orders insert error:", orderErr);
      }
    }
    if (data.mt5MoneyFlows && data.mt5MoneyFlows.length > 0) {
      const flowRows = data.mt5MoneyFlows.map((f) => ({
        account_id: f.accountId,
        user_id: f.userId || uid,
        ticket: f.ticket,
        flow_type: f.flowType,
        amount: f.amount,
        currency: f.currency,
        time: f.time
      }));
      const { error: flowErr } = await supabase.from("mt5_money_flows").upsert(flowRows, { onConflict: "account_id,ticket" });
      if (flowErr) console.error("[saveDatabase] mt5_money_flows upsert error:", flowErr);
    }
    if (data.mt5SyncLogs && data.mt5SyncLogs.length > 0) {
      const logRows = data.mt5SyncLogs.map((l) => ({
        account_id: l.accountId,
        user_id: l.userId || uid,
        request_id: l.requestId || null,
        event: l.event,
        level: l.level,
        message: l.message
      }));
      const { error: logErr } = await supabase.from("mt5_sync_logs").insert(logRows);
      if (logErr) console.error("[saveDatabase] mt5_sync_logs insert error:", logErr);
    }
    if (data.mt5ConnectionErrors && data.mt5ConnectionErrors.length > 0) {
      const errRows = data.mt5ConnectionErrors.map((e) => ({
        account_id: e.accountId,
        user_id: e.userId || uid,
        error_code: e.errorCode,
        error_message: e.errorMessage,
        occurred_at: e.occurredAt,
        resolved_at: e.resolvedAt
      }));
      const { error: connErr } = await supabase.from("mt5_connection_errors").insert(errRows);
      if (connErr) console.error("[saveDatabase] mt5_connection_errors insert error:", connErr);
    }
    if (data.mt5ConnectJobs && data.mt5ConnectJobs.length > 0) {
      const jobRows = data.mt5ConnectJobs.map((j) => ({
        id: j.id,
        account_id: j.accountId,
        user_id: j.userId || uid,
        action: j.action,
        payload: j.payload || null,
        status: j.status || "PENDING",
        attempts: j.attempts || 0,
        worker_id: j.workerId || null,
        last_error: j.lastError || null,
        claimed_at: j.claimedAt || null,
        updated_at: j.updatedAt || j.createdAt
      }));
      const { error: jobErr } = await supabase.from("mt5_connect_jobs").upsert(jobRows, { onConflict: "id" });
      if (jobErr) console.error("[saveDatabase] mt5_connect_jobs upsert error:", jobErr);
    }
  } catch (err) {
    console.error("[AxyFx SQL Save Error]", err);
  }
}
async function ensureDefaultPortfolioAccount(db, userId, email) {
  try {
    if (!db || !userId) return null;
    if (!Array.isArray(db.accounts)) db.accounts = [];
    if (!Array.isArray(db.riskSettings)) db.riskSettings = [];
    const existing = db.accounts.filter((acc) => acc.userId === userId || !acc.userId);
    if (existing.length > 0) return null;
    const newAcc = {
      id: `acc_${crypto2.randomUUID()}`,
      userId,
      name: "Portfolio Account",
      broker: "MT5 Demo Broker",
      platform: "MT5",
      accountType: "Demo",
      currency: "USD",
      startingBalance: 1e4,
      currentBalance: 1e4,
      equity: 1e4,
      status: "Active",
      eaToken: generateEaToken(),
      eaStatus: "Not Connected"
    };
    db.accounts.push(newAcc);
    const newRisk = {
      id: `r_${crypto2.randomUUID()}`,
      accountId: newAcc.id,
      riskPerTradeLimit: 2,
      dailyLossLimit: 500,
      weeklyLossLimit: 1500,
      maxDrawdownLimit: 10,
      disciplineEnabled: true,
      maxTradesPerDay: 5
    };
    db.riskSettings.push(newRisk);
    await saveDatabase(db, userId, email);
    console.log(`[Auth] Auto-created default portfolio account ${newAcc.id} for user ${userId}`);
    return newAcc;
  } catch (err) {
    console.error("[Auth] Failed to auto-create default portfolio account:", err?.message || err);
    return null;
  }
}
async function attachTicketUserNames(tickets) {
  if (!useSupabase || !Array.isArray(tickets) || tickets.length === 0) return tickets;
  try {
    const ids = Array.from(new Set(tickets.map((t) => t.userId || t.user_id).filter(Boolean)));
    if (ids.length === 0) return tickets;
    const { data: users } = await supabase.from("users").select("id, name, email").in("id", ids);
    const nameMap = Object.fromEntries((users || []).map((u) => [u.id, u]));
    return tickets.map((t) => {
      const u = nameMap[t.userId || t.user_id];
      return {
        ...toCamel(t),
        userName: u?.name || "",
        userEmail: t.userEmail || t.user_email || u?.email || ""
      };
    });
  } catch (e) {
    console.error("[Tickets] Failed to attach user names:", e);
    return tickets.map((t) => toCamel(t));
  }
}
function collectAllInMemoryTickets() {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  userDatabases.forEach((d) => {
    (d.supportTickets || []).forEach((t) => {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        out.push(t);
      }
    });
  });
  return out;
}
var app = express();
var PORT = Number(process.env.PORT) || 3e3;
async function verifyTurnstile(token) {
  const configured = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!configured) {
    console.warn("[Turnstile] No secret configured \u2014 allowing request.");
    return true;
  }
  const secretKey = configured;
  if (!token) return false;
  try {
    const params = new URLSearchParams();
    params.append("secret", secretKey);
    params.append("response", token);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: params
    });
    const data = await res.json();
    return data.success;
  } catch (err) {
    console.error("Turnstile verification failed:", err);
    return false;
  }
}
var authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  // 15 minutes
  max: 20,
  message: { error: "Too many requests. Please wait a few minutes and try again." },
  standardHeaders: true,
  legacyHeaders: false,
  // Keyed on email + IP, not IP alone. An office, campus, café or any mobile
  // carrier puts many people behind one address, so an IP-only counter lets the
  // first person to fumble a password lock out everyone else on that network
  // for fifteen minutes. The composite key still stops brute force: a single
  // account is capped at 20 tries from one address, and the per-account OTP
  // counter below caps guesses regardless of where they come from.
  keyGenerator: (req) => {
    const ip = ipKeyGenerator(req.ip);
    const email = String(req.body?.email || "").toLowerCase().trim();
    return email ? `auth_${sha256Hex(email).slice(0, 24)}_${ip}` : `auth_ip_${ip}`;
  }
});
var authIpBackstopLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  max: 200,
  message: { error: "Too many requests from this network. Please wait a few minutes and try again." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `auth_net_${ipKeyGenerator(req.ip)}`
});
var otpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  max: 10,
  message: { error: "Too many verification attempts. Please wait a few minutes and try again." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = String(req.body?.email || "").toLowerCase().trim();
    return email ? `otp_${sha256Hex(email).slice(0, 24)}` : `otp_ip_${ipKeyGenerator(req.ip)}`;
  }
});
var MAX_OTP_ATTEMPTS = 5;
var otpAttemptCounts = /* @__PURE__ */ new Map();
var otpAttemptKey = (email) => `otp_attempts_${email.toLowerCase().trim()}`;
function registerFailedOtp(email) {
  const key = otpAttemptKey(email);
  const next = (otpAttemptCounts.get(key) || 0) + 1;
  otpAttemptCounts.set(key, next);
  return next;
}
function clearFailedOtp(email) {
  otpAttemptCounts.delete(otpAttemptKey(email));
}
function otpAttemptsExhausted(email) {
  return (otpAttemptCounts.get(otpAttemptKey(email)) || 0) >= MAX_OTP_ATTEMPTS;
}
var eaAccountLimiter = rateLimit({
  windowMs: 5 * 1e3,
  max: 10,
  message: { error: "Too many requests from this account. Retry shortly.", code: "EA_RATE_LIMITED" },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const accountId = String(req.headers["x-ea-account-id"] || req.body?.accountId || "unknown");
    return `ea_acc_${accountId}`;
  }
});
var eaTokenLimiter = rateLimit({
  windowMs: 60 * 1e3,
  max: 60,
  message: { error: "Too many requests from this EA token. Retry shortly.", code: "EA_RATE_LIMITED" },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const auth2 = (req.headers["authorization"] || "").toString().trim();
    const token = auth2.startsWith("Bearer ") ? auth2.slice(7).trim() : req.body?.token || "unknown";
    return `ea_tok_${sha256Hex(token).slice(0, 16)}`;
  }
});
var eaIpLimiter = rateLimit({
  windowMs: 60 * 1e3,
  max: 300,
  message: { error: "Too many requests from this IP. Retry shortly.", code: "EA_RATE_LIMITED" },
  standardHeaders: true,
  legacyHeaders: false
});
var eaProtection = [eaAccountLimiter, eaTokenLimiter, eaIpLimiter];
app.use((req, _res, next) => {
  if (req.url.startsWith("//")) {
    req.url = req.url.replace(/^\/+/, "/");
  }
  next();
});
app.use((req, res, next) => {
  const allowedOrigins = [
    "https://fxjournalpro.com",
    "https://www.fxjournalpro.com",
    "http://localhost:3000",
    "http://localhost:5173"
  ];
  const origin = req.headers["origin"];
  const isAllowedOrigin = (orig) => {
    if (!orig) return true;
    if (allowedOrigins.includes(orig)) return true;
    if (orig.endsWith(".netlify.app")) return true;
    if (orig.endsWith(".vercel.app")) return true;
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(orig)) return true;
    return false;
  };
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "https://fxjournalpro.com");
  }
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Auth-User-Id, X-Auth-Email, X-Session-Token");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});
app.use(cookieParser());
var betterAuthNodeHandler = toNodeHandler(auth);
var LEGACY_AUTH_ROUTES = /* @__PURE__ */ new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/verify-otp",
  "/api/auth/resend-otp",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/me",
  "/api/auth/logout",
  "/api/auth/onboarding",
  "/api/auth/preferences",
  "/api/auth/update-profile"
]);
app.all("/api/auth/*", (req, res, next) => {
  if (LEGACY_AUTH_ROUTES.has(req.path)) {
    return next();
  }
  return betterAuthNodeHandler(req, res);
});
app.use(express.json({
  limit: "15mb",
  // Capture the raw request body for HMAC signature verification
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString("utf8");
  }
}));
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.removeHeader("ETag");
  next();
});
var IDENTITY_ONLY_ROUTES = /* @__PURE__ */ new Set([
  "/api/auth/me",
  "/api/admin/check",
  "/api/announcements",
  "/api/fx-news",
  "/api/economic-calendar",
  "/api/chart/ohlc",
  "/api/plan/entitlements"
]);
app.use(async (req, res, next) => {
  try {
    let authUserId;
    let authEmail;
    const session = verifySessionValue(req.cookies?.[SESSION_COOKIE]);
    if (session?.userId || session?.email) {
      authUserId = session.userId?.trim();
      authEmail = session.email?.trim();
    }
    if (!authUserId && !authEmail) {
      const authHeader = (req.headers["authorization"] || "").toString().trim();
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : (req.headers["x-session-token"] || "").trim();
      if (token) {
        const bearerSession = verifySessionValue(token);
        if (bearerSession?.userId || bearerSession?.email) {
          authUserId = bearerSession.userId?.trim();
          authEmail = bearerSession.email?.trim();
        } else if (useSupabase) {
          try {
            const { data: sbUser } = await supabase.auth.getUser(token);
            if (sbUser?.user) {
              authUserId = sbUser.user.id;
              authEmail = sbUser.user.email;
            }
          } catch (_) {
          }
        }
      }
    }
    let betterUser = null;
    if (!authUserId && !authEmail) {
      try {
        const betterSession = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
        if (betterSession?.user) {
          betterUser = betterSession.user;
          authUserId = betterSession.user.id;
          authEmail = betterSession.user.email;
        }
      } catch (_) {
      }
    }
    if (!authUserId && !authEmail && !IS_PRODUCTION_LIKE) {
      const headerUserId = (req.headers["x-auth-user-id"] || "").trim();
      const headerEmail = (req.headers["x-auth-email"] || "").trim();
      if (headerUserId || headerEmail) {
        authUserId = headerUserId;
        authEmail = headerEmail;
      }
    }
    if (authUserId || authEmail) {
      const email = authEmail ? authEmail.toLowerCase().trim() : "";
      let userId = authUserId || (email ? `user_${email}` : "");
      let db = null;
      let dbUser = null;
      const isSuperAdminUser = isSuperAdminEmail(email);
      if (useSupabase) {
        let existingUserRow = null;
        if (email) {
          const { data } = await supabase.from("users").select("*").eq("email", email).maybeSingle();
          existingUserRow = data;
        }
        if (!existingUserRow && authUserId) {
          const { data } = await supabase.from("users").select("*").eq("id", authUserId).maybeSingle();
          existingUserRow = data;
        }
        if (existingUserRow) {
          dbUser = toCamel(existingUserRow);
          userId = existingUserRow.id;
          authUserId = existingUserRow.id;
          if (isSuperAdminUser && (existingUserRow.role !== "SUPER_ADMIN" || !existingUserRow.is_pro)) {
            existingUserRow.role = "SUPER_ADMIN";
            existingUserRow.is_pro = true;
            dbUser.role = "SUPER_ADMIN";
            dbUser.isPro = true;
            dbUser.is_pro = true;
            supabase.from("users").update({ role: "SUPER_ADMIN", is_pro: true }).eq("id", existingUserRow.id).then();
          }
        } else if (betterUser && email) {
          const canonicalId = authUserId || `user_${crypto2.randomUUID()}`;
          const newRecord = {
            id: canonicalId,
            email,
            name: betterUser.name || email.split("@")[0],
            password: "",
            role: isSuperAdminUser ? "SUPER_ADMIN" : "USER",
            status: "ACTIVE",
            experience: "Intermediate",
            trading_style: "Day Trading",
            main_markets: ["Forex", "Gold"],
            onboarding_completed: false,
            is_pro: isSuperAdminUser ? true : false,
            is_email_verified: true,
            auth_provider: "google",
            last_login: (/* @__PURE__ */ new Date()).toISOString()
          };
          try {
            await supabase.from("users").upsert(newRecord, { onConflict: "id" });
            const defaultAcc = {
              id: `acc_${crypto2.randomUUID()}`,
              user_id: canonicalId,
              name: "Main Trading Account",
              broker: "Demo Broker",
              platform: "MT5",
              account_type: "DEMO",
              currency: "USD",
              starting_balance: 1e4,
              current_balance: 1e4,
              equity: 1e4,
              status: "ACTIVE",
              is_mt5_sync: false
            };
            await supabase.from("trading_accounts").upsert([defaultAcc], { onConflict: "id" });
          } catch (createErr) {
            console.error("[Better Auth Sync] Failed to upsert new user to Supabase:", createErr);
          }
          dbUser = toCamel(newRecord);
          userId = canonicalId;
          authUserId = canonicalId;
        }
        if (!IDENTITY_ONLY_ROUTES.has(req.path)) {
          db = await ensureUserDbLoaded(userId, email);
          if (db?.users?.[0]) dbUser = db.users[0];
        }
      } else {
        db = await ensureUserDbLoaded(userId, email);
        dbUser = db.users[0] || null;
        if (!dbUser && betterUser && email) {
          const canonicalId = authUserId || `user_${crypto2.randomUUID()}`;
          const newRecord = {
            id: canonicalId,
            email,
            name: betterUser.name || email.split("@")[0],
            password: "",
            role: isSuperAdminUser ? "SUPER_ADMIN" : "USER",
            status: "ACTIVE",
            experience: "Intermediate",
            tradingStyle: "Day Trading",
            mainMarkets: ["Forex", "Gold"],
            onboardingCompleted: false,
            isPro: isSuperAdminUser ? true : false,
            isEmailVerified: true,
            authProvider: "google",
            lastLogin: (/* @__PURE__ */ new Date()).toISOString()
          };
          dbUser = newRecord;
          db.users.push(newRecord);
        }
      }
      if (isSuperAdminUser && dbUser) {
        dbUser.role = "SUPER_ADMIN";
        dbUser.isPro = true;
        dbUser.is_pro = true;
      }
      if (betterUser && dbUser) {
        dbUser.isEmailVerified = true;
        dbUser.is_email_verified = true;
        if (!req.cookies?.[SESSION_COOKIE]) {
          issueSession(res, { id: dbUser.id, email: dbUser.email });
        }
      }
      const unverified = dbUser ? dbUser.isEmailVerified === false || dbUser.is_email_verified === false : false;
      const blocked = String(dbUser?.status || "").toLowerCase() === "blocked";
      if (dbUser) {
        const proUntilRaw = dbUser.proUntil ?? dbUser.pro_until ?? null;
        if (proUntilRaw) {
          const stillPro = new Date(proUntilRaw).getTime() > Date.now();
          dbUser.isPro = stillPro;
          dbUser.is_pro = stillPro;
        }
      }
      if (dbUser && (unverified || blocked)) {
        req.userDb = null;
        req.currentUser = null;
      } else {
        req.userDb = db;
        req.currentUser = dbUser;
      }
    } else {
      req.currentUser = null;
      req.userDb = null;
    }
    next();
  } catch (err) {
    console.error("[AxyFx Journal Server] Middleware execution error:", err);
    next(err);
  }
});
app.get("/api/debug/env", async (req, res) => {
  if (IS_PRODUCTION_LIKE) {
    return res.status(404).json({ error: "Not found" });
  }
  let sbError = null;
  let sbData = null;
  if (useSupabase) {
    const { data, error } = await supabase.from("users").select("id").limit(1);
    sbError = error;
    sbData = data;
  }
  res.json({
    useSupabase,
    hasSupabaseUrl: !!process.env.SUPABASE_URL || !!process.env.VITE_SUPABASE_URL,
    hasSupabaseKey: !!process.env.SUPABASE_KEY || !!process.env.VITE_SUPABASE_KEY,
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    sbError,
    sbData
  });
});
var clientErrorLimiter = rateLimit({
  windowMs: 60 * 1e3,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false }
});
app.post("/api/client-error", clientErrorLimiter, (req, res) => {
  const { kind, message, stack, url, userAgent, at } = req.body || {};
  console.error("[client-error]", JSON.stringify({
    kind: String(kind || "unknown").slice(0, 40),
    message: String(message || "").slice(0, 500),
    url: String(url || "").slice(0, 200),
    userAgent: String(userAgent || "").slice(0, 200),
    at: String(at || (/* @__PURE__ */ new Date()).toISOString()).slice(0, 40),
    stack: String(stack || "").slice(0, 2e3)
  }));
  res.status(204).end();
});
app.get("/api/auth/me", async (req, res) => {
  let currentUser = req.currentUser;
  if (!currentUser) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  try {
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const prev = currentUser.lastLogin || currentUser.last_login;
    const shouldUpdate = !prev || Date.now() - new Date(prev).getTime() >= 15 * 60 * 1e3;
    if (shouldUpdate) {
      currentUser.lastLogin = nowIso;
      currentUser.last_login = nowIso;
      if (useSupabase) {
        try {
          await supabase.from("users").update({ last_login: nowIso }).eq("id", currentUser.id);
        } catch (e) {
          console.warn("[auth/me] last_login update skipped:", e?.message || e);
        }
      } else {
        const db = req.userDb;
        if (db) await saveDatabase(db);
      }
    }
  } catch (err) {
    console.warn("[auth/me] last_login update failed:", err);
  }
  const existingCookie = req.cookies?.[SESSION_COOKIE];
  const token = existingCookie && verifySessionValue(existingCookie) ? existingCookie : issueSession(res, currentUser);
  return res.json({ user: sanitizeUser(currentUser), sessionToken: token });
});
app.post("/api/auth/logout", async (req, res) => {
  try {
    const authHeader = (req.headers["authorization"] || "").toString().trim();
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const rawToken = req.cookies?.[SESSION_COOKIE] || req.headers["x-session-token"] || bearerToken || "";
    const session = verifySessionValue(rawToken);
    if (session) {
      revokeSessionsFor(session.userId);
      revokeSessionsFor(session.email);
    }
    clearSession(res);
  } catch (_) {
  }
  try {
    await auth.api.signOut({ headers: fromNodeHeaders(req.headers) });
  } catch (_) {
  }
  res.clearCookie("better-auth.session_token", { path: "/" });
  res.clearCookie("__Secure-better-auth.session_token", { path: "/" });
  res.clearCookie("better-auth.session_data", { path: "/" });
  res.clearCookie("__Secure-better-auth.session_data", { path: "/" });
  res.clearCookie("better-auth.state", { path: "/" });
  res.clearCookie("__Secure-better-auth.state", { path: "/" });
  res.clearCookie("fx_auth_session", { path: "/" });
  res.json({ message: "Logged out successfully" });
});
app.post("/api/auth/register", authIpBackstopLimiter, authRateLimiter, async (req, res) => {
  try {
    const { email, name, password, id, userId, turnstileToken, provider, supabaseAccessToken, referralCode } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }
    const normalizedEmail = email.toLowerCase().trim();
    let ssoUser = null;
    if (supabaseAccessToken) {
      if (!useSupabase) {
        return res.status(503).json({ error: "Single sign-on is not configured on this server." });
      }
      const { data, error } = await supabase.auth.getUser(String(supabaseAccessToken));
      const tokenEmail = data?.user?.email?.toLowerCase().trim();
      if (error || !tokenEmail) {
        return res.status(401).json({ error: "Invalid or expired sign-in session. Please sign in again." });
      }
      if (tokenEmail !== normalizedEmail) {
        return res.status(403).json({ error: "Sign-in session does not match the requested account." });
      }
      ssoUser = { id: data.user.id, email: tokenEmail };
    }
    const isSso = !!ssoUser;
    const authUserId = isSso ? ssoUser.id : "";
    if (!isSso) {
      const isHuman = await verifyTurnstile(turnstileToken);
      if (!isHuman) {
        return res.status(403).json({ error: "Captcha verification failed. Please try again." });
      }
      if (!password || String(password).length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters." });
      }
    }
    let existingUserRow = null;
    if (useSupabase) {
      const { data } = await supabase.from("users").select("*").eq("email", normalizedEmail).maybeSingle();
      existingUserRow = data;
    } else {
      const memDb = await ensureUserDbLoaded("", normalizedEmail);
      const memUser = (memDb.users || []).find((u) => u.email?.toLowerCase() === normalizedEmail);
      if (memUser) {
        existingUserRow = {
          ...memUser,
          is_email_verified: memUser.isEmailVerified ?? memUser.is_email_verified ?? false
        };
      }
    }
    if (existingUserRow && existingUserRow.is_email_verified && !isSso) {
      return res.status(400).json({ error: "An account with this email already exists. Please log in." });
    }
    const otp = generateOtp();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1e3).toISOString();
    if (isSso) {
      const uid2 = existingUserRow?.id || authUserId || `user_${crypto2.randomUUID()}`;
      const userRecord2 = {
        id: uid2,
        email: normalizedEmail,
        name: name || existingUserRow?.name || normalizedEmail.split("@")[0],
        password: existingUserRow?.password || "",
        experience: existingUserRow?.experience || "Intermediate",
        trading_style: existingUserRow?.trading_style || "Day Trading",
        main_markets: existingUserRow?.main_markets || ["Forex", "Gold"],
        onboarding_completed: existingUserRow?.onboarding_completed || false,
        is_pro: existingUserRow?.is_pro || false,
        is_email_verified: true,
        auth_provider: provider || "google",
        last_login: (/* @__PURE__ */ new Date()).toISOString()
      };
      if (useSupabase) {
        const { error: upsertErr } = await supabase.from("users").upsert(userRecord2, { onConflict: "id" });
        if (upsertErr) {
          console.warn("[Register SSO] Full upsert failed, retrying with base columns:", upsertErr.message);
          const baseRecord = {
            id: uid2,
            email: normalizedEmail,
            name: name || existingUserRow?.name || normalizedEmail.split("@")[0],
            password: existingUserRow?.password || "",
            experience: existingUserRow?.experience || "Intermediate",
            trading_style: existingUserRow?.trading_style || "Day Trading",
            main_markets: existingUserRow?.main_markets || ["Forex", "Gold"],
            onboarding_completed: existingUserRow?.onboarding_completed || false,
            is_pro: existingUserRow?.is_pro || false,
            is_email_verified: true
          };
          const { error: baseErr } = await supabase.from("users").upsert(baseRecord, { onConflict: "id" });
          if (baseErr) {
            console.error("[Register SSO] Base upsert failed:", baseErr);
            return res.status(500).json({ error: "Failed to sync account. Please try again." });
          }
        }
      } else {
        let db = await ensureUserDbLoaded(uid2, normalizedEmail);
        let user = db.users.find((u) => u.email.toLowerCase() === normalizedEmail);
        if (!user) {
          user = { ...toCamel(userRecord2) };
          db.users.push(user);
        } else {
          Object.assign(user, toCamel(userRecord2));
        }
        userDatabases.set(normalizedEmail, db);
        userDatabases.set(uid2, db);
      }
      try {
        const ssoDb = await ensureUserDbLoaded(uid2, normalizedEmail);
        await ensureDefaultPortfolioAccount(ssoDb, uid2, normalizedEmail);
      } catch (e) {
        console.error("[Register SSO] Failed to auto-create default portfolio account:", e);
      }
      if (referralCode) await linkReferral(req, uid2, String(referralCode));
      const camelUser2 = toCamel(userRecord2);
      const sessionToken = issueSession(res, { id: uid2, email: normalizedEmail });
      return res.json({ message: "Registration successful.", user: sanitizeUser(camelUser2), requiresOtp: false, sessionToken });
    }
    const uid = existingUserRow?.id || authUserId || `user_${crypto2.randomUUID()}`;
    const hashedPassword = password ? await bcrypt.hash(password, 10) : existingUserRow?.password || "";
    const userRecord = {
      id: uid,
      email: normalizedEmail,
      name: name || existingUserRow?.name || normalizedEmail.split("@")[0],
      password: hashedPassword,
      experience: existingUserRow?.experience || "Intermediate",
      trading_style: existingUserRow?.trading_style || "Day Trading",
      main_markets: existingUserRow?.main_markets || ["Forex", "Gold"],
      onboarding_completed: existingUserRow?.onboarding_completed || false,
      is_pro: existingUserRow?.is_pro || false,
      is_email_verified: false,
      email_otp: otp,
      otp_expires_at: otpExpiresAt,
      otp_attempts: 0,
      otp_sent_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (useSupabase) {
      const { error: upsertErr } = await supabase.from("users").upsert(userRecord, { onConflict: "id" });
      if (upsertErr) {
        console.warn("[Register] Full upsert failed, retrying with base columns:", upsertErr.message);
        const baseRecord = {
          id: uid,
          email: normalizedEmail,
          name: name || existingUserRow?.name || normalizedEmail.split("@")[0],
          password: hashedPassword,
          experience: existingUserRow?.experience || "Intermediate",
          trading_style: existingUserRow?.trading_style || "Day Trading",
          main_markets: existingUserRow?.main_markets || ["Forex", "Gold"],
          onboarding_completed: existingUserRow?.onboarding_completed || false,
          is_pro: existingUserRow?.is_pro || false,
          is_email_verified: false
        };
        const { error: baseErr } = await supabase.from("users").upsert(baseRecord, { onConflict: "id" });
        if (baseErr) {
          console.error("[Register] Base upsert failed:", baseErr);
          return res.status(500).json({ error: "Failed to create account. Please try again." });
        }
        try {
          await supabase.from("users").update({
            email_otp: otp,
            otp_expires_at: otpExpiresAt,
            otp_attempts: 0,
            otp_sent_at: (/* @__PURE__ */ new Date()).toISOString()
          }).eq("id", uid);
        } catch (otpErr) {
          console.warn("[Register] OTP field update failed (non-fatal):", otpErr);
        }
      }
    } else {
      let db = await ensureUserDbLoaded(uid, normalizedEmail);
      let user = db.users.find((u) => u.email.toLowerCase() === normalizedEmail);
      if (!user) {
        user = { ...toCamel(userRecord) };
        db.users.push(user);
      } else {
        Object.assign(user, toCamel(userRecord));
      }
      userDatabases.set(normalizedEmail, db);
      userDatabases.set(uid, db);
    }
    if (referralCode) await linkReferral(req, uid, String(referralCode));
    const emailResult = await sendOtpEmail(normalizedEmail, otp);
    const camelUser = toCamel(userRecord);
    res.json({
      message: emailResult.success ? "Registration successful. OTP sent to your email." : "Registration successful. Please enter your 6-digit verification code.",
      user: sanitizeUser(camelUser),
      requiresOtp: true,
      emailSent: emailResult.success,
      ...canExposeOtp() ? { devOtp: emailResult.otp } : {}
    });
  } catch (err) {
    console.error("[AxyFx Journal Server] Register endpoint error:", err);
    res.status(500).json({ error: `Server register error: ${err?.message || err}` });
  }
});
app.post("/api/auth/login", authIpBackstopLimiter, authRateLimiter, async (req, res) => {
  try {
    const { email, password, id, userId, turnstileToken } = req.body;
    const isDev = IS_DEV;
    if (!isDev) {
      const isHuman = await verifyTurnstile(turnstileToken);
      if (!isHuman) {
        return res.status(403).json({ error: "Captcha verification failed. Please try again." });
      }
    }
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }
    const normalizedEmail = email.toLowerCase().trim();
    let db = await ensureUserDbLoaded("", normalizedEmail);
    let user = db.users.find((u) => u.email.toLowerCase() === normalizedEmail);
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password. Please check your credentials." });
    }
    if (!user.password) {
      return res.status(401).json({ error: "This account was registered using Google. Please continue with Google sign-in." });
    }
    if (!password) {
      return res.status(400).json({ error: "Password is required to login." });
    }
    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(password, user.password);
    } catch {
      isMatch = false;
    }
    if (!isMatch && user.password === password) {
      isMatch = true;
    }
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password. Please try again." });
    }
    if (String(user.status || "").toLowerCase() === "blocked") {
      return res.status(403).json({ error: "This account has been suspended. Contact support if you believe this is a mistake." });
    }
    if (user.isEmailVerified === false || user.is_email_verified === false) {
      return res.status(403).json({ error: "Please verify your email before signing in. Enter the 6-digit code we sent to your inbox, or click resend." });
    }
    user.last_login = (/* @__PURE__ */ new Date()).toISOString();
    if (useSupabase) {
      await supabase.from("users").update({ last_login: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", user.id);
    }
    await saveDatabase(db);
    const sessionToken = issueSession(res, user);
    res.json({ message: "Login successful", user: sanitizeUser(user), sessionToken });
  } catch (err) {
    console.error("[AxyFx Journal Server] Login endpoint error:", err);
    res.status(500).json({ error: `Server login error: ${err?.message || err}` });
  }
});
app.post("/api/auth/verify-otp", otpRateLimiter, async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: "Email and 6-digit OTP code are required." });
    }
    const normalizedEmail = email.toLowerCase().trim();
    if (otpAttemptsExhausted(normalizedEmail)) {
      return res.status(429).json({
        error: "Too many incorrect codes. Please request a new verification code.",
        code: "OTP_ATTEMPTS_EXCEEDED"
      });
    }
    if (useSupabase) {
      const { data: row, error: fetchErr } = await supabase.from("users").select("*").eq("email", normalizedEmail).maybeSingle();
      if (fetchErr) {
        console.error("[verify-otp] Supabase fetch error:", fetchErr);
        return res.status(500).json({ error: "Server error verifying OTP." });
      }
      if (!row) {
        return res.status(404).json({ error: "Account not found. Please register first." });
      }
      const storedOtp = row.email_otp;
      const expiresAt = row.otp_expires_at ? new Date(row.otp_expires_at).getTime() : 0;
      if (!storedOtp || !safeTokenEqual(storedOtp, otp.toString().trim())) {
        const attempts = registerFailedOtp(normalizedEmail);
        if (attempts >= MAX_OTP_ATTEMPTS) {
          await supabase.from("users").update({ email_otp: null, otp_expires_at: null }).eq("email", normalizedEmail);
        }
        return res.status(400).json({ error: "Invalid 6-digit verification code." });
      }
      if (Date.now() > expiresAt) {
        return res.status(400).json({ error: "Verification code has expired. Please click resend to get a new code." });
      }
      const { error: updateErr } = await supabase.from("users").update({ is_email_verified: true, email_otp: null, otp_expires_at: null }).eq("email", normalizedEmail);
      if (updateErr) {
        console.error("[verify-otp] Supabase update error:", updateErr);
        return res.status(500).json({ error: "Server error confirming email." });
      }
      const verifiedUser = toCamel({ ...row, is_email_verified: true, email_otp: null, otp_expires_at: null });
      try {
        const otpDb = await ensureUserDbLoaded(verifiedUser.id, normalizedEmail);
        await ensureDefaultPortfolioAccount(otpDb, verifiedUser.id, normalizedEmail);
      } catch (e) {
        console.error("[verify-otp] Failed to auto-create default portfolio account:", e);
      }
      clearFailedOtp(normalizedEmail);
      const sessionToken = issueSession(res, verifiedUser);
      return res.json({ message: "Email verified successfully.", user: sanitizeUser(verifiedUser), sessionToken });
    }
    let db = userDatabases.get(normalizedEmail) || await ensureUserDbLoaded(normalizedEmail);
    let user = db.users.find((u) => u.email.toLowerCase() === normalizedEmail);
    if (!user) {
      return res.status(404).json({ error: "Account not found. Please register first." });
    }
    if (user.emailOtp && safeTokenEqual(user.emailOtp, otp.toString().trim())) {
      const expiresAt = user.otpExpiresAt ? new Date(user.otpExpiresAt).getTime() : 0;
      if (Date.now() > expiresAt) {
        return res.status(400).json({ error: "Verification code has expired. Please click resend to get a new code." });
      }
      user.isEmailVerified = true;
      delete user.emailOtp;
      delete user.otpExpiresAt;
      await ensureDefaultPortfolioAccount(db, user.id, normalizedEmail);
      await saveDatabase(db, user.id, normalizedEmail);
      clearFailedOtp(normalizedEmail);
      const sessionToken = issueSession(res, user);
      return res.json({ message: "Email verified successfully.", user: sanitizeUser(user), sessionToken });
    } else {
      const attempts = registerFailedOtp(normalizedEmail);
      if (attempts >= MAX_OTP_ATTEMPTS) {
        delete user.emailOtp;
        delete user.otpExpiresAt;
      }
      return res.status(400).json({ error: "Invalid 6-digit verification code." });
    }
  } catch (err) {
    console.error("[AxyFx Journal Server] Verify OTP error:", err);
    return res.status(500).json({ error: `Server verify OTP error: ${err?.message || err}` });
  }
});
app.post("/api/auth/resend-otp", otpRateLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required." });
    }
    const normalizedEmail = email.toLowerCase().trim();
    if (useSupabase) {
      const { data: row } = await supabase.from("users").select("*").eq("email", normalizedEmail).maybeSingle();
      if (!row) {
        return res.status(404).json({ error: "User account not found." });
      }
      const newOtp2 = generateOtp();
      const otpExpiresAt2 = new Date(Date.now() + 10 * 60 * 1e3).toISOString();
      clearFailedOtp(normalizedEmail);
      await supabase.from("users").update({
        email_otp: newOtp2,
        otp_expires_at: otpExpiresAt2,
        otp_sent_at: (/* @__PURE__ */ new Date()).toISOString()
      }).eq("email", normalizedEmail);
      const emailResult2 = await sendOtpEmail(normalizedEmail, newOtp2);
      return res.json({
        message: emailResult2.success ? "New verification code sent to " + normalizedEmail : "New verification code generated.",
        emailSent: emailResult2.success,
        ...canExposeOtp() ? { devOtp: emailResult2.otp } : {}
      });
    }
    let db = userDatabases.get(normalizedEmail) || await ensureUserDbLoaded(normalizedEmail);
    let user = db.users.find((u) => u.email.toLowerCase() === normalizedEmail);
    if (!user) {
      return res.status(404).json({ error: "User account not found." });
    }
    const newOtp = generateOtp();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1e3).toISOString();
    user.emailOtp = newOtp;
    user.otpExpiresAt = otpExpiresAt;
    user.otpSentAt = (/* @__PURE__ */ new Date()).toISOString();
    await saveDatabase(db, normalizedEmail);
    const emailResult = await sendOtpEmail(normalizedEmail, newOtp);
    return res.json({
      message: emailResult.success ? "New verification code sent to " + normalizedEmail : "New verification code generated.",
      emailSent: emailResult.success,
      ...canExposeOtp() ? { devOtp: emailResult.otp } : {}
    });
  } catch (err) {
    console.error("[AxyFx Journal Server] Resend OTP error:", err);
    res.status(500).json({ error: `Server resend OTP error: ${err?.message || err}` });
  }
});
app.post("/api/auth/forgot-password", authIpBackstopLimiter, authRateLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required." });
    const normalizedEmail = email.toLowerCase().trim();
    if (useSupabase) {
      const { data: row } = await supabase.from("users").select("id, is_email_verified").eq("email", normalizedEmail).maybeSingle();
      if (!row || !row.is_email_verified) {
        return res.json({ message: "If this email is registered, a password reset code has been sent." });
      }
      const otp2 = generateOtp();
      const resetOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1e3).toISOString();
      await supabase.from("users").update({
        reset_otp: otp2,
        reset_otp_expires_at: resetOtpExpiresAt
      }).eq("email", normalizedEmail);
      const emailResult2 = await sendOtpEmail(normalizedEmail, otp2, "Password Reset Code");
      console.log(`[Auth] Password reset OTP sent to ${normalizedEmail}, emailSent: ${emailResult2.success}`);
      return res.json({
        message: "If this email is registered, a password reset code has been sent.",
        ...canExposeOtp() ? { devOtp: emailResult2.otp } : {}
      });
    }
    const db = await ensureUserDbLoaded(normalizedEmail);
    const user = db.users.find((u) => u.email.toLowerCase() === normalizedEmail);
    if (!user || !user.isEmailVerified) {
      return res.json({ message: "If this email is registered, a password reset code has been sent." });
    }
    const otp = generateOtp();
    user.resetOtp = otp;
    user.resetOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1e3).toISOString();
    await saveDatabase(db, normalizedEmail);
    const emailResult = await sendOtpEmail(normalizedEmail, otp, "Password Reset Code");
    return res.json({ message: "If this email is registered, a password reset code has been sent.", ...canExposeOtp() ? { devOtp: emailResult.otp } : {} });
  } catch (err) {
    console.error("[Auth] Forgot password error:", err);
    res.status(500).json({ error: "Server error during password reset request." });
  }
});
app.post("/api/auth/reset-password", authIpBackstopLimiter, authRateLimiter, async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: "Email, reset code, and new password are all required." });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters." });
    }
    const normalizedEmail = email.toLowerCase().trim();
    if (useSupabase) {
      const { data: row } = await supabase.from("users").select("*").eq("email", normalizedEmail).maybeSingle();
      if (!row) {
        return res.status(400).json({ error: "Invalid or expired reset code." });
      }
      if (!row.reset_otp || row.reset_otp !== otp.toString().trim()) {
        return res.status(400).json({ error: "Invalid reset code. Please check the code sent to your email." });
      }
      const expiry2 = row.reset_otp_expires_at ? new Date(row.reset_otp_expires_at).getTime() : 0;
      if (Date.now() > expiry2) {
        return res.status(400).json({ error: "Reset link expired. Please request a new password reset." });
      }
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await supabase.from("users").update({
        password: hashedPassword,
        reset_otp: null,
        reset_otp_expires_at: null
      }).eq("email", normalizedEmail);
      console.log(`[Auth] Password successfully reset for ${normalizedEmail}`);
      return res.json({ message: "Password updated successfully. You can now log in with your new password." });
    }
    const db = await ensureUserDbLoaded(normalizedEmail);
    const user = db.users.find((u) => u.email.toLowerCase() === normalizedEmail);
    if (!user) {
      return res.status(400).json({ error: "Invalid or expired reset code." });
    }
    if (!user.resetOtp || user.resetOtp !== otp.toString().trim()) {
      return res.status(400).json({ error: "Invalid reset code. Please check the code sent to your email." });
    }
    const expiry = user.resetOtpExpiresAt ? new Date(user.resetOtpExpiresAt).getTime() : 0;
    if (Date.now() > expiry) {
      return res.status(400).json({ error: "Reset link expired. Please request a new password reset." });
    }
    user.password = await bcrypt.hash(newPassword, 10);
    delete user.resetOtp;
    delete user.resetOtpExpiresAt;
    await saveDatabase(db, normalizedEmail);
    return res.json({ message: "Password updated successfully. You can now log in with your new password." });
  } catch (err) {
    console.error("[Auth] Reset password error:", err);
    res.status(500).json({ error: "Server error during password reset." });
  }
});
app.post("/api/auth/onboarding", async (req, res) => {
  let db = req.userDb;
  let currentUser = req.currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: "Not authenticated" });
  const { experience, tradingStyle, markets } = req.body;
  const userIdx = db.users.findIndex((u) => u.id === currentUser?.id);
  if (userIdx !== -1) {
    db.users[userIdx].experience = experience;
    db.users[userIdx].tradingStyle = tradingStyle;
    db.users[userIdx].mainMarkets = markets;
    db.users[userIdx].onboardingCompleted = true;
    db.users[userIdx].onboarding_completed = true;
    db.users[userIdx].onboardingData = { experience, tradingStyle, markets };
    if (useSupabase && currentUser?.id) {
      try {
        await supabase.from("users").update({
          experience,
          trading_style: tradingStyle,
          main_markets: markets,
          onboarding_completed: true
        }).eq("id", currentUser.id);
      } catch (sbErr) {
        console.warn("[Onboarding] Supabase direct update warning:", sbErr);
      }
    }
    await ensureDefaultPortfolioAccount(db, currentUser.id, authEmail);
    await saveDatabase(db, authEmail);
    currentUser = db.users[userIdx];
    res.json({ message: "Onboarding completed successfully", user: sanitizeUser(currentUser) });
  } else {
    res.status(404).json({ error: "User not found" });
  }
});
app.post("/api/auth/update-profile", async (req, res) => {
  let db = req.userDb;
  let currentUser = req.currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: "Not authenticated" });
  const { name } = req.body;
  const userIdx = db.users.findIndex((u) => u.id === currentUser?.id);
  if (userIdx !== -1) {
    const previousUserId = db.users[userIdx].id;
    const previousEmail = db.users[userIdx].email;
    if (name) db.users[userIdx].name = name;
    await saveDatabase(db, db.users[userIdx].id, db.users[userIdx].email, { userId: previousUserId, email: previousEmail });
    currentUser = db.users[userIdx];
    res.json({ message: "Profile updated successfully", user: sanitizeUser(currentUser) });
  } else {
    res.status(404).json({ error: "User not found" });
  }
});
app.patch("/api/auth/preferences", async (req, res) => {
  let db = req.userDb;
  let currentUser = req.currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: "Not authenticated" });
  const userIdx = db.users.findIndex((u) => u.id === currentUser?.id);
  if (userIdx === -1) return res.status(404).json({ error: "User not found" });
  const existing = db.users[userIdx].preferences || {};
  db.users[userIdx].preferences = { ...existing, ...req.body };
  await saveDatabase(db, authEmail);
  currentUser = db.users[userIdx];
  res.json({ message: "Preferences saved", user: currentUser });
});
var FREE_ACCOUNT_LIMIT = 1;
var FREE_REPORT_DAYS = 30;
var PRO_FEATURE_MESSAGES = {
  mt5Sync: "MT5 sync is a Pro feature. On the free plan you can add trades manually.",
  liveChart: "Live Chart is a Pro feature. Upgrade to chart your trades against live market data.",
  aiMentor: "AI Mentor is a Pro feature. Upgrade to get coaching on your trading.",
  unlimitedAccounts: `The free plan is limited to ${FREE_ACCOUNT_LIMIT} portfolio account. Upgrade to Pro for unlimited broker and prop firm accounts.`,
  proReports: `The free plan reports cover the last ${FREE_REPORT_DAYS} days in CSV. Excel and PDF reports over any period are a Pro feature.`,
  whatsappAlerts: "WhatsApp news reminders are a Pro feature.",
  notebook: "Trader Notebook is a Pro feature. Upgrade to unlock rich-text notes, custom dates, templates, and trade planning."
};
var hasPro = (user) => !!(user?.isPro ?? user?.is_pro);
var requirePro = (req, res, feature) => {
  const currentUser = req.currentUser;
  if (!currentUser) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  if (!hasPro(currentUser)) {
    res.status(403).json({ error: PRO_FEATURE_MESSAGES[feature], proRequired: true, feature });
    return false;
  }
  return true;
};
var reportFloorFor = (user) => hasPro(user) ? null : new Date(Date.now() - FREE_REPORT_DAYS * 864e5);
app.get("/api/plan/entitlements", (req, res) => {
  const currentUser = req.currentUser;
  const pro = hasPro(currentUser);
  res.json({
    plan: pro ? "pro" : "free",
    isPro: pro,
    limits: {
      accounts: pro ? null : FREE_ACCOUNT_LIMIT,
      reportDays: pro ? null : FREE_REPORT_DAYS,
      reportFormats: pro ? ["csv", "xlsx", "pdf"] : ["csv"]
    },
    features: {
      manualJournal: true,
      analytics: true,
      calendar: true,
      fxNews: true,
      tools: true,
      notebook: pro,
      mt5Sync: pro,
      liveChart: pro,
      aiMentor: pro,
      unlimitedAccounts: pro,
      proReports: pro,
      whatsappAlerts: pro
    }
  });
});
app.get("/api/accounts", async (req, res) => {
  let currentUser = req.currentUser;
  if (!currentUser) return res.json({ accounts: [] });
  if (useSupabase) {
    try {
      const { data: rows, error } = await supabase.from("trading_accounts").select("*").eq("user_id", currentUser.id);
      if (error) {
        console.error("[GET /api/accounts] Supabase error:", JSON.stringify(error));
      } else {
        const accounts = toCamel(rows || []);
        console.log(`[GET /api/accounts] User: ${currentUser.id}, accounts from Supabase: ${accounts.length}`);
        if (accounts.length > 0) {
          return res.json({ accounts });
        }
      }
    } catch (err) {
      console.error("[GET /api/accounts] Exception:", err?.message);
    }
  }
  const db = req.userDb;
  if (!db) return res.json({ accounts: [] });
  let userAccounts = (db.accounts || []).filter((acc) => acc.userId === currentUser.id || acc.user_id === currentUser.id);
  if (userAccounts.length === 0) {
    try {
      const starter = await ensureDefaultPortfolioAccount(db, currentUser.id, currentUser.email);
      if (starter) {
        userAccounts = [starter];
      }
    } catch (err) {
      console.error("[GET /api/accounts] Starter account creation error:", err);
    }
  }
  console.log(`[GET /api/accounts] User: ${currentUser.id} (${currentUser.email}), active accounts: ${userAccounts.length}`);
  res.json({ accounts: userAccounts });
});
app.post("/api/accounts", async (req, res) => {
  let db = req.userDb;
  let currentUser = req.currentUser;
  const authEmail = currentUser?.email;
  console.log(`[POST /api/accounts] x-auth-user-id: "${req.headers["x-auth-user-id"]}", x-auth-email: "${req.headers["x-auth-email"]}", resolved currentUser: ${currentUser?.id || "NONE"}`);
  if (!currentUser || !db) return res.status(401).json({ error: "Not authenticated. Please refresh the page and log in again." });
  if (!db.accounts) db.accounts = [];
  if (!db.riskSettings) db.riskSettings = [];
  const existingUserAccounts = db.accounts.filter((acc) => acc.userId === currentUser.id || acc.user_id === currentUser.id);
  if (!hasPro(currentUser) && existingUserAccounts.length >= FREE_ACCOUNT_LIMIT) {
    return res.status(403).json({
      error: PRO_FEATURE_MESSAGES.unlimitedAccounts,
      proRequired: true,
      feature: "unlimitedAccounts"
    });
  }
  const { name, broker, platform, accountType, currency, startingBalance, isMt5Sync, institutionType, login, server, investorPassword } = req.body;
  if (isMt5Sync && !hasPro(currentUser)) {
    return res.status(403).json({
      error: PRO_FEATURE_MESSAGES.mt5Sync,
      proRequired: true,
      feature: "mt5Sync"
    });
  }
  if (!name || !broker) {
    return res.status(400).json({ error: "Account name and broker are required." });
  }
  if (!isMt5Sync && (startingBalance === void 0 || startingBalance === null)) {
    return res.status(400).json({ error: "Starting balance is required for manual accounts." });
  }
  let startBal;
  if (isMt5Sync) {
    startBal = startingBalance !== void 0 && startingBalance !== null && startingBalance !== "" ? parseFloat(startingBalance) || 0 : 0;
  } else {
    startBal = parseFloat(startingBalance) || 1e4;
  }
  let enc = null;
  if (investorPassword) {
    enc = encryptInvestorPassword(investorPassword);
  }
  const newAcc = {
    id: `acc_${crypto2.randomUUID()}`,
    userId: currentUser.id,
    name,
    broker,
    platform: isMt5Sync ? "MT5" : platform || "MT5",
    accountType: accountType || "Live",
    ...institutionType ? { institutionType } : {},
    currency: currency || "USD",
    startingBalance: startBal,
    currentBalance: startBal,
    equity: startBal,
    status: "Active",
    isMt5Sync: !!isMt5Sync,
    eaToken: generateEaToken(),
    eaStatus: isMt5Sync ? "Connected" : "Not Connected",
    ...login ? { mt5Login: String(login).trim(), eaTerminalLogin: String(login).trim() } : {},
    ...server ? { mt5Server: String(server).trim(), eaTerminalServer: String(server).trim() } : {},
    ...enc ? {
      investorPasswordEnc: enc.enc,
      passwordEncNonce: "",
      passwordKmsKeyId: enc.keyId,
      syncMethod: "CLOUD",
      connectionStatus: "Connected"
    } : {
      ...isMt5Sync && login && server ? {
        syncMethod: "CLOUD",
        connectionStatus: "Connected"
      } : {}
    }
  };
  db.accounts.push(newAcc);
  const riskBase = startBal || 1e4;
  const newRisk = {
    id: `r_${crypto2.randomUUID()}`,
    accountId: newAcc.id,
    riskPerTradeLimit: 2,
    dailyLossLimit: riskBase * 0.05,
    weeklyLossLimit: riskBase * 0.1,
    maxDrawdownLimit: 10,
    disciplineEnabled: true,
    maxTradesPerDay: 5
  };
  db.riskSettings.push(newRisk);
  const saveResult = await saveDatabase(db, authEmail);
  if (saveResult?.accountsError) {
    const code = saveResult.accountsError.code;
    if (code === "42703") {
      return res.status(500).json({
        error: "Database is missing required columns. Please run the MT5 EA schema migration in Supabase (mt5_ea_schema_migration.sql) and try again."
      });
    }
    return res.status(500).json({ error: "Account could not be saved to the database. Please try again." });
  }
  res.json({ message: "Trading account created", account: newAcc });
});
app.put("/api/accounts/:id", async (req, res) => {
  let db = req.userDb;
  let currentUser = req.currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: "Not authenticated" });
  const { id } = req.params;
  const { name, broker, status, currentBalance, equity, currency, startingBalance } = req.body;
  const accIdx = db.accounts.findIndex((acc) => acc.id === id);
  if (accIdx !== -1 && db.accounts[accIdx].userId === currentUser.id) {
    if (name) db.accounts[accIdx].name = name;
    if (broker) db.accounts[accIdx].broker = broker;
    if (status) db.accounts[accIdx].status = status;
    if (currency) db.accounts[accIdx].currency = currency;
    const money = (raw) => {
      const v = typeof raw === "number" ? raw : parseFloat(String(raw));
      if (!Number.isFinite(v)) return null;
      if (Math.abs(v) > MAX_MONEY) return null;
      return v;
    };
    for (const [label, raw] of [["Starting balance", startingBalance], ["Current balance", currentBalance], ["Equity", equity]]) {
      if (raw !== void 0 && money(raw) === null) {
        return res.status(400).json({ error: `${label} must be a number.` });
      }
    }
    if (startingBalance !== void 0) db.accounts[accIdx].startingBalance = money(startingBalance);
    if (currentBalance !== void 0) db.accounts[accIdx].currentBalance = money(currentBalance);
    if (equity !== void 0) db.accounts[accIdx].equity = money(equity);
    await saveDatabase(db, authEmail);
    res.json({ message: "Account updated successfully", account: db.accounts[accIdx] });
  } else if (accIdx !== -1) {
    res.status(403).json({ error: "You can only edit your own trading accounts." });
  } else {
    res.status(404).json({ error: "Account not found" });
  }
});
app.delete("/api/accounts/:id", async (req, res) => {
  let db = req.userDb;
  let currentUser = req.currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: "Not authenticated" });
  const { id } = req.params;
  const targetAccount = db.accounts.find((acc) => acc.id === id);
  if (!targetAccount) {
    return res.status(404).json({ error: "Account not found" });
  }
  if (targetAccount.userId !== currentUser.id) {
    return res.status(403).json({ error: "You can only delete your own trading accounts." });
  }
  const initialLength = db.accounts.length;
  db.accounts = db.accounts.filter((acc) => acc.id !== id);
  if (db.accounts.length < initialLength) {
    db.trades = db.trades.filter((t) => t.accountId !== id);
    db.riskSettings = db.riskSettings.filter((r) => r.accountId !== id);
    if (useSupabase) {
      await supabase.from("trading_accounts").delete().eq("id", id);
      await supabase.from("trades").delete().eq("account_id", id);
      await supabase.from("risk_settings").delete().eq("account_id", id);
    }
    await saveDatabase(db, authEmail);
    res.json({ message: "Account and associated trades deleted successfully" });
  } else {
    res.status(404).json({ error: "Account not found" });
  }
});
app.get("/api/trades", async (req, res) => {
  let currentUser = req.currentUser;
  if (!currentUser) return res.json({ trades: [] });
  const { accountId } = req.query;
  let accountTrades = [];
  if (useSupabase) {
    try {
      let query = supabase.from("trades").select("*").eq("user_id", currentUser.id).order("date", { ascending: false });
      if (accountId) {
        const { data: accCheck } = await supabase.from("trading_accounts").select("user_id").eq("id", accountId).maybeSingle();
        if (accCheck && accCheck.user_id !== currentUser.id) {
          return res.status(403).json({ error: "You can only view trades for your own accounts." });
        }
        query = query.eq("account_id", accountId);
      }
      const { data: rows, error } = await query;
      if (error) {
        console.error("[GET /api/trades] Supabase error:", JSON.stringify(error));
      } else {
        accountTrades = toCamel(rows || []);
        console.log(`[GET /api/trades] Fetched ${accountTrades.length} trades for user ${currentUser.id} from Supabase`);
        if (accountTrades.length > 0) console.log("[GET /api/trades] First trade exitTime:", accountTrades[0].exitTime, "| Raw exit_time:", (rows || [])[0]?.exit_time);
      }
    } catch (err) {
      console.error("[GET /api/trades] Exception:", err?.message);
    }
  }
  if (accountTrades.length === 0) {
    const db = req.userDb;
    if (db) {
      const ownAccountIds = new Set(
        (db.accounts || []).filter((a) => a.userId === currentUser.id || !a.userId).map((a) => a.id)
      );
      accountTrades = accountId ? (db.trades || []).filter((t) => t.accountId === accountId && (t.userId === currentUser.id || !t.userId)) : (db.trades || []).filter((t) => t.userId === currentUser.id || ownAccountIds.has(t.accountId));
      accountTrades.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
  }
  res.json({ trades: accountTrades });
});
var REPORT_FORMATS = /* @__PURE__ */ new Set(["csv", "xlsx", "pdf"]);
var FREE_REPORT_FORMATS = /* @__PURE__ */ new Set(["csv"]);
app.post("/api/reports/export", async (req, res) => {
  const currentUser = req.currentUser;
  if (!currentUser) return res.status(401).json({ error: "Not authenticated" });
  const format = String(req.body?.format || "csv").toLowerCase();
  if (!REPORT_FORMATS.has(format)) {
    return res.status(400).json({ error: "Unknown report format." });
  }
  const pro = hasPro(currentUser);
  if (!pro && !FREE_REPORT_FORMATS.has(format)) {
    return res.status(403).json({
      error: PRO_FEATURE_MESSAGES.proReports,
      proRequired: true,
      feature: "proReports"
    });
  }
  const floor = reportFloorFor(currentUser);
  const parseDate = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  let start = parseDate(req.body?.start);
  const end = parseDate(req.body?.end);
  let clamped = false;
  if (floor && (!start || start < floor)) {
    start = floor;
    clamped = true;
  }
  const accountId = req.body?.accountId ? String(req.body.accountId) : null;
  let rows = [];
  if (useSupabase) {
    let query = supabase.from("trades").select("*").eq("user_id", currentUser.id).order("date", { ascending: false });
    if (accountId) {
      const { data: accCheck } = await supabase.from("trading_accounts").select("user_id").eq("id", accountId).maybeSingle();
      if (accCheck && accCheck.user_id !== currentUser.id) {
        return res.status(403).json({ error: "You can only export your own accounts." });
      }
      query = query.eq("account_id", accountId);
    }
    const { data, error } = await query;
    if (error) {
      console.error("[POST /api/reports/export] Supabase error:", error.message);
      return res.status(500).json({ error: "Could not build the report." });
    }
    rows = toCamel(data || []);
  } else {
    const db = req.userDb;
    const ownAccountIds = new Set(
      (db?.accounts || []).filter((a) => a.userId === currentUser.id || !a.userId).map((a) => a.id)
    );
    rows = (db?.trades || []).filter(
      (t) => (t.userId === currentUser.id || ownAccountIds.has(t.accountId)) && (!accountId || t.accountId === accountId)
    );
  }
  const inWindow = rows.filter((t) => {
    const d = parseDate(t.date ?? t.entryTime);
    if (!d) return false;
    if (start && d < start) return false;
    if (end && d > end) return false;
    return true;
  }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  res.json({
    format,
    plan: pro ? "pro" : "free",
    clamped,
    windowStart: start ? start.toISOString() : null,
    windowEnd: end ? end.toISOString() : null,
    maxDays: pro ? null : FREE_REPORT_DAYS,
    count: inWindow.length,
    trades: inWindow
  });
});
app.post("/api/trades", async (req, res) => {
  let db = req.userDb;
  let currentUser = req.currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: "Not authenticated" });
  const {
    accountId,
    date,
    symbol,
    type,
    lotSize,
    entryPrice,
    exitPrice,
    exitTime,
    stopLoss,
    takeProfit,
    profit,
    commission,
    swap,
    riskPercentage,
    strategy,
    emotion,
    notes,
    screenshot,
    tags
  } = req.body;
  if (!symbol || !type || !lotSize || !entryPrice || !exitPrice || profit === void 0 || profit === null || profit === "") {
    return res.status(400).json({ error: "Missing required trade parameters" });
  }
  const tradeValidationError = validateTradeNumbers({
    lotSize,
    entryPrice,
    exitPrice,
    profit,
    commission,
    swap,
    riskPercentage,
    type
  });
  if (tradeValidationError) {
    return res.status(400).json({ error: tradeValidationError });
  }
  const ownAccounts = (db.accounts || []).filter((acc) => acc.userId === currentUser.id);
  if (accountId) {
    const requestedAccount = db.accounts.find((acc) => acc.id === accountId);
    if (requestedAccount && requestedAccount.userId !== currentUser.id) {
      return res.status(403).json({ error: "You can only add trades to your own accounts." });
    }
    if (!requestedAccount) {
      let existsElsewhere = false;
      if (!useSupabase) {
        try {
          existsElsewhere = (loadDatabaseFromFile()?.accounts || []).some((a) => a.id === accountId);
        } catch {
        }
        if (!existsElsewhere) {
          for (const cached of userDatabases.values()) {
            if ((cached?.accounts || []).some((a) => a.id === accountId)) {
              existsElsewhere = true;
              break;
            }
          }
        }
      } else {
        const { data } = await supabase.from("trading_accounts").select("id").eq("id", accountId).maybeSingle();
        existsElsewhere = !!data;
      }
      if (existsElsewhere) {
        return res.status(403).json({ error: "You can only add trades to your own accounts." });
      }
      return res.status(409).json({
        error: "That trading account no longer exists. Your account list has been refreshed \u2014 please save again.",
        code: "ACCOUNT_STALE",
        accounts: ownAccounts.map((a) => ({ id: a.id, name: a.name }))
      });
    }
  }
  let accountIdx = ownAccounts.findIndex((acc) => acc.id === accountId);
  if (accountIdx === -1) {
    if (ownAccounts.length > 0) {
      accountIdx = 0;
    } else {
      const defaultAccId = `acc_${crypto2.randomUUID()}`;
      db.accounts.push({
        id: defaultAccId,
        userId: currentUser.id,
        name: "Main Trading Account",
        broker: "MetaTrader 5",
        startingBalance: 1e4,
        currentBalance: 1e4,
        equity: 1e4,
        currency: "USD",
        status: "Active",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      accountIdx = db.accounts.length - 1;
    }
  } else {
    accountIdx = db.accounts.findIndex((acc) => acc.id === ownAccounts[accountIdx].id);
  }
  const targetAccountId = db.accounts[accountIdx].id;
  const nowMs = Date.now();
  const duplicateExists = db.trades.some(
    (t) => t.accountId === targetAccountId && t.symbol === symbol.toUpperCase() && t.type === type && t.entryPrice === parseFloat(entryPrice) && t.profit === parseFloat(profit) && nowMs - new Date(t.date).getTime() < 2e3
    // within 2 seconds
  );
  if (duplicateExists) {
    return res.status(400).json({ error: "Duplicate trade submission detected. Please wait a moment." });
  }
  const newTrade = {
    id: `trade_${crypto2.randomUUID()}`,
    accountId: targetAccountId,
    // Without this the trade was stored with no owner, and GET /api/trades —
    // which filters on userId when no accountId is given — never returned it.
    userId: currentUser.id,
    date: date || (/* @__PURE__ */ new Date()).toISOString(),
    symbol: symbol.toUpperCase(),
    type,
    lotSize: parseFloat(lotSize),
    entryPrice: parseFloat(entryPrice),
    exitPrice: parseFloat(exitPrice),
    exitTime: exitTime || void 0,
    stopLoss: stopLoss ? parseFloat(stopLoss) : void 0,
    takeProfit: takeProfit ? parseFloat(takeProfit) : void 0,
    profit: parseFloat(profit),
    commission: commission ? parseFloat(commission) : 0,
    swap: swap ? parseFloat(swap) : 0,
    riskPercentage: riskPercentage ? parseFloat(riskPercentage) : 1,
    strategy: strategy || "Unspecified",
    emotion: emotion || "Calm",
    notes: notes || "",
    screenshot: screenshot || "",
    tags: tags || []
  };
  const netProfit2 = newTrade.profit + newTrade.commission + newTrade.swap;
  if (!applyBalanceDelta(db.accounts[accountIdx], netProfit2)) {
    return res.status(400).json({ error: "Those numbers do not add up to a valid balance." });
  }
  db.trades.push(newTrade);
  const saved = await saveDatabase(db, authEmail);
  if (saved?.tradesError || saved?.usersError || saved?.accountsError) {
    applyBalanceDelta(db.accounts[accountIdx], -netProfit2);
    const idx = db.trades.findIndex((t) => t.id === newTrade.id);
    if (idx !== -1) db.trades.splice(idx, 1);
    return res.status(502).json({
      error: "Your trade could not be saved. Nothing was changed \u2014 please try again."
    });
  }
  res.json({ message: "Trade logged successfully", trade: newTrade, updatedAccount: db.accounts[accountIdx] });
});
app.post("/api/trades/batch", async (req, res) => {
  let db = req.userDb;
  let currentUser = req.currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: "Not authenticated" });
  const { accountId, trades: incomingTrades } = req.body;
  if (!accountId || !Array.isArray(incomingTrades) || incomingTrades.length === 0) {
    return res.status(400).json({ error: "accountId and trades[] are required" });
  }
  const account = db.accounts.find((a) => a.id === accountId);
  if (!account) return res.status(404).json({ error: "Account not found" });
  if (account.userId !== currentUser.id) return res.status(403).json({ error: "Access denied" });
  const saved = [];
  const skipped = [];
  let balanceAdjustment = 0;
  const ticketKey = (t) => {
    const raw = t.ticket ?? t.eaDealId ?? t.ea_deal_id;
    return raw === void 0 || raw === null || raw === "" ? null : `ticket:${String(raw)}`;
  };
  const valueKey = (t) => [
    String(t.symbol || "").toUpperCase(),
    t.type || "",
    t.date ? isNaN(new Date(t.date).getTime()) ? t.date : new Date(t.date).getTime() : "",
    Number(t.entryPrice) || 0,
    Number(t.exitPrice) || 0,
    Number(t.lotSize) || 0,
    Number(t.profit) || 0
  ].join("|");
  const existingTickets = /* @__PURE__ */ new Set();
  const existingValues = /* @__PURE__ */ new Set();
  for (const t of db.trades) {
    if (t.accountId !== accountId) continue;
    const tk = ticketKey(t);
    if (tk) existingTickets.add(tk);
    existingValues.add(valueKey(t));
  }
  for (const t of incomingTrades) {
    if (!t.symbol || !t.type || t.profit === void 0) continue;
    if (validateTradeNumbers(t)) {
      skipped.push(t.ticket ?? t.symbol);
      continue;
    }
    const incomingDate = t.date || (/* @__PURE__ */ new Date()).toISOString();
    const candidate = { ...t, date: incomingDate };
    const tk = ticketKey(candidate);
    const vk = valueKey(candidate);
    if (tk && existingTickets.has(tk) || existingValues.has(vk)) {
      skipped.push(t.ticket ?? vk);
      continue;
    }
    if (tk) existingTickets.add(tk);
    existingValues.add(vk);
    const newTrade = {
      id: `trade_${crypto2.randomUUID()}`,
      accountId,
      userId: currentUser.id,
      date: t.date || (/* @__PURE__ */ new Date()).toISOString(),
      symbol: t.symbol.toUpperCase(),
      type: t.type,
      lotSize: parseFloat(t.lotSize) || 0.01,
      entryPrice: parseFloat(t.entryPrice) || 0,
      exitPrice: parseFloat(t.exitPrice) || 0,
      stopLoss: t.stopLoss ? parseFloat(t.stopLoss) : void 0,
      takeProfit: t.takeProfit ? parseFloat(t.takeProfit) : void 0,
      profit: parseFloat(t.profit) || 0,
      commission: t.commission ? parseFloat(t.commission) : 0,
      swap: t.swap ? parseFloat(t.swap) : 0,
      riskPercentage: t.riskPercentage ? parseFloat(t.riskPercentage) : 1,
      strategy: t.strategy || "Pasted from MT5",
      emotion: t.emotion || "Calm",
      notes: t.notes || "",
      screenshot: "",
      tags: t.tags || ["MT5 Paste"],
      isMt5Sync: true,
      // Keep the broker ticket so a later re-import of the same report can be
      // recognised as a duplicate rather than inserted again.
      ...ticketKey(t) ? { ticket: t.ticket } : {}
    };
    db.trades.push(newTrade);
    saved.push(newTrade);
    balanceAdjustment += newTrade.profit + newTrade.commission + newTrade.swap;
  }
  if (saved.length > 0) {
    applyBalanceDelta(account, balanceAdjustment);
    const savedResult = await saveDatabase(db, authEmail);
    if (savedResult?.tradesError || savedResult?.usersError || savedResult?.accountsError) {
      applyBalanceDelta(account, -balanceAdjustment);
      const savedIds = new Set(saved.map((t) => t.id));
      db.trades = (db.trades || []).filter((t) => !savedIds.has(t.id));
      return res.status(502).json({
        error: "The import could not be saved. Nothing was changed \u2014 please try again."
      });
    }
  }
  res.json({
    message: skipped.length ? `${saved.length} trades imported, ${skipped.length} duplicates skipped` : `${saved.length} trades imported successfully`,
    trades: saved,
    totalSaved: saved.length,
    totalSkipped: skipped.length
  });
});
app.put("/api/trades/:id", async (req, res) => {
  let db = req.userDb;
  let currentUser = req.currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: "Not authenticated" });
  const { id } = req.params;
  const updateData = req.body;
  const tradeIdx = db.trades.findIndex((t) => t.id === id);
  if (tradeIdx === -1) return res.status(404).json({ error: "Trade not found" });
  const editValidationError = validateTradeNumbers(updateData);
  if (editValidationError) {
    return res.status(400).json({ error: editValidationError });
  }
  const trade = db.trades[tradeIdx];
  const account = db.accounts.find((acc) => acc.id === trade.accountId);
  if (!account) return res.status(404).json({ error: "Associated account not found" });
  if (account.userId !== currentUser.id) return res.status(403).json({ error: "You can only edit your own trades." });
  const oldNet = trade.profit + (trade.commission || 0) + (trade.swap || 0);
  if (updateData.symbol) db.trades[tradeIdx].symbol = updateData.symbol.toUpperCase();
  if (updateData.type) db.trades[tradeIdx].type = updateData.type;
  if (updateData.lotSize !== void 0) db.trades[tradeIdx].lotSize = parseFloat(updateData.lotSize);
  if (updateData.entryPrice !== void 0) db.trades[tradeIdx].entryPrice = parseFloat(updateData.entryPrice);
  if (updateData.exitPrice !== void 0) db.trades[tradeIdx].exitPrice = parseFloat(updateData.exitPrice);
  if (updateData.exitTime !== void 0) db.trades[tradeIdx].exitTime = updateData.exitTime;
  if (updateData.stopLoss !== void 0) db.trades[tradeIdx].stopLoss = updateData.stopLoss ? parseFloat(updateData.stopLoss) : void 0;
  if (updateData.takeProfit !== void 0) db.trades[tradeIdx].takeProfit = updateData.takeProfit ? parseFloat(updateData.takeProfit) : void 0;
  if (updateData.profit !== void 0) db.trades[tradeIdx].profit = parseFloat(updateData.profit);
  if (updateData.commission !== void 0) db.trades[tradeIdx].commission = parseFloat(updateData.commission);
  if (updateData.swap !== void 0) db.trades[tradeIdx].swap = parseFloat(updateData.swap);
  if (updateData.riskPercentage !== void 0) db.trades[tradeIdx].riskPercentage = parseFloat(updateData.riskPercentage);
  if (updateData.strategy !== void 0) db.trades[tradeIdx].strategy = updateData.strategy;
  if (updateData.emotion !== void 0) db.trades[tradeIdx].emotion = updateData.emotion;
  if (updateData.notes !== void 0) db.trades[tradeIdx].notes = updateData.notes;
  if (updateData.screenshot !== void 0) db.trades[tradeIdx].screenshot = updateData.screenshot;
  if (updateData.tags !== void 0) db.trades[tradeIdx].tags = updateData.tags;
  if (updateData.date !== void 0) db.trades[tradeIdx].date = updateData.date;
  const updated = db.trades[tradeIdx];
  const newNet = (updated.profit || 0) + (updated.commission || 0) + (updated.swap || 0);
  const diff = newNet - oldNet;
  const accIdx = db.accounts.findIndex((acc) => acc.id === trade.accountId);
  if (accIdx !== -1 && Number.isFinite(diff) && diff !== 0) {
    applyBalanceDelta(db.accounts[accIdx], diff);
  }
  await saveDatabase(db, authEmail);
  res.json({ message: "Trade updated successfully", trade: db.trades[tradeIdx] });
});
app.delete("/api/trades/:id", async (req, res) => {
  let db = req.userDb;
  let currentUser = req.currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: "Not authenticated" });
  const { id } = req.params;
  const tradeIdx = db.trades.findIndex((t) => t.id === id);
  if (tradeIdx === -1) return res.status(404).json({ error: "Trade not found" });
  const trade = db.trades[tradeIdx];
  let accIdx = db.accounts.findIndex((acc) => acc.id === trade.accountId);
  if (accIdx === -1) return res.status(404).json({ error: "Associated account not found" });
  if (db.accounts[accIdx].userId !== currentUser.id) return res.status(403).json({ error: "You can only delete your own trades." });
  const netProfit2 = (Number(trade.profit) || 0) + (trade.commission || 0) + (trade.swap || 0);
  applyBalanceDelta(db.accounts[accIdx], -netProfit2);
  db.trades.splice(tradeIdx, 1);
  if (useSupabase) {
    await supabase.from("trades").delete().eq("id", id);
  }
  await saveDatabase(db, authEmail);
  res.json({ message: "Trade deleted successfully", updatedAccount: db.accounts[accIdx] });
});
app.get("/api/risk-settings/:accountId", async (req, res) => {
  let db = req.userDb;
  let currentUser = req.currentUser;
  if (!currentUser || !db) return res.status(401).json({ error: "Not authenticated" });
  const { accountId } = req.params;
  const account = db.accounts.find((acc) => acc.id === accountId);
  if (account && account.userId !== currentUser.id) {
    return res.status(403).json({ error: "You can only view risk settings for your own accounts." });
  }
  const settings = (db.riskSettings || []).find((r) => r.accountId === accountId);
  if (!settings) {
    const defaultSettings = {
      id: `r_${crypto2.randomUUID()}`,
      accountId,
      riskPerTradeLimit: 2,
      dailyLossLimit: 500,
      weeklyLossLimit: 1500,
      maxDrawdownLimit: 10,
      disciplineEnabled: true,
      maxTradesPerDay: 5
    };
    return res.json({ riskSettings: defaultSettings });
  }
  if (settings.maxTradesPerDay === void 0) {
    settings.maxTradesPerDay = 5;
  }
  res.json({ riskSettings: settings });
});
app.put("/api/risk-settings/:accountId", async (req, res) => {
  let db = req.userDb;
  let currentUser = req.currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: "Not authenticated" });
  const { accountId } = req.params;
  const { riskPerTradeLimit, dailyLossLimit, weeklyLossLimit, maxDrawdownLimit, disciplineEnabled, maxTradesPerDay } = req.body;
  const account = db.accounts.find((acc) => acc.id === accountId);
  if (account && account.userId !== currentUser.id) {
    return res.status(403).json({ error: "You can only update risk settings for your own accounts." });
  }
  const idx = db.riskSettings.findIndex((r) => r.accountId === accountId);
  if (idx !== -1) {
    const existing = db.riskSettings[idx];
    existing.riskPerTradeLimit = !isNaN(parseFloat(riskPerTradeLimit)) ? parseFloat(riskPerTradeLimit) : existing.riskPerTradeLimit ?? 2;
    existing.dailyLossLimit = !isNaN(parseFloat(dailyLossLimit)) ? parseFloat(dailyLossLimit) : existing.dailyLossLimit ?? 500;
    existing.weeklyLossLimit = !isNaN(parseFloat(weeklyLossLimit)) ? parseFloat(weeklyLossLimit) : existing.weeklyLossLimit ?? 1500;
    existing.maxDrawdownLimit = !isNaN(parseFloat(maxDrawdownLimit)) ? parseFloat(maxDrawdownLimit) : existing.maxDrawdownLimit ?? 10;
    if (disciplineEnabled !== void 0) {
      existing.disciplineEnabled = !!disciplineEnabled;
    }
    existing.maxTradesPerDay = !isNaN(parseInt(maxTradesPerDay)) ? parseInt(maxTradesPerDay) : existing.maxTradesPerDay ?? 5;
    await saveDatabase(db, authEmail);
    res.json({ message: "Risk parameters saved", riskSettings: existing });
  } else {
    const newRisk = {
      id: `r_${crypto2.randomUUID()}`,
      accountId,
      riskPerTradeLimit: !isNaN(parseFloat(riskPerTradeLimit)) ? parseFloat(riskPerTradeLimit) : 2,
      dailyLossLimit: !isNaN(parseFloat(dailyLossLimit)) ? parseFloat(dailyLossLimit) : 500,
      weeklyLossLimit: !isNaN(parseFloat(weeklyLossLimit)) ? parseFloat(weeklyLossLimit) : 1500,
      maxDrawdownLimit: !isNaN(parseFloat(maxDrawdownLimit)) ? parseFloat(maxDrawdownLimit) : 10,
      disciplineEnabled: disciplineEnabled !== void 0 ? !!disciplineEnabled : true,
      maxTradesPerDay: !isNaN(parseInt(maxTradesPerDay)) ? parseInt(maxTradesPerDay) : 5
    };
    db.riskSettings.push(newRisk);
    await saveDatabase(db, authEmail);
    res.json({ message: "Risk parameters created", riskSettings: newRisk });
  }
});
app.get("/api/mt5/ea/:accountId/download", async (req, res) => {
  let db = req.userDb;
  let currentUser = req.currentUser;
  if (!currentUser || !db) return res.status(401).json({ error: "Not authenticated" });
  const account = db.accounts.find((a) => a.id === req.params.accountId);
  if (!account) return res.status(404).json({ error: "Account not found" });
  if (account.userId !== currentUser.id) return res.status(403).json({ error: "Access denied" });
  if (!account.eaToken) {
    account.eaToken = generateEaToken();
    account.eaStatus = account.eaStatus || "Not Connected";
    await saveDatabase(db, currentUser.email);
  }
  const apiUrl = apiBaseUrl(req);
  const source = generateEaSource(account, apiUrl);
  const safeName = String(account.name || "account").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 30);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="FXJournalPro_Sync_${safeName}.mq5"`);
  res.send(source);
});
app.post("/api/mt5/ea/:accountId/reset-token", async (req, res) => {
  let db = req.userDb;
  let currentUser = req.currentUser;
  if (!currentUser || !db) return res.status(401).json({ error: "Not authenticated" });
  const account = db.accounts.find((a) => a.id === req.params.accountId);
  if (!account) return res.status(404).json({ error: "Account not found" });
  if (account.userId !== currentUser.id) return res.status(403).json({ error: "Access denied" });
  account.eaToken = generateEaToken();
  account.eaStatus = "Not Connected";
  account.eaConnectedAt = void 0;
  account.eaLastDealId = 0;
  account.eaLastSyncTime = void 0;
  account.eaSyncTradeCount = account.eaSyncTradeCount || 0;
  await saveDatabase(db, currentUser.email);
  res.json({ message: "EA token reset. Download a fresh EA file for this account.", account });
});
app.post("/api/mt5/ea/authenticate", ...eaProtection, async (req, res) => {
  const body = req.body || {};
  if (!body.accountId || !body.token) return res.status(400).json({ error: "accountId and token are required" });
  const auth2 = await authEaRequest(req, res, body.token);
  if (!auth2) return;
  const { db, account } = auth2;
  if (body.terminal && typeof body.terminal === "object") {
    if (body.terminal.login !== void 0) account.eaTerminalLogin = String(body.terminal.login);
    if (body.terminal.server !== void 0) account.eaTerminalServer = String(body.terminal.server);
  }
  account.eaStatus = "Connected";
  account.connectionStatus = "Connected";
  account.eaConnectedAt = account.eaConnectedAt || (/* @__PURE__ */ new Date()).toISOString();
  account.lastHeartbeatAt = (/* @__PURE__ */ new Date()).toISOString();
  logEaEvent(db, account, "EA_AUTHENTICATE", "info", "EA handshake (legacy) succeeded");
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true, status: "Connected", lastDealId: account.eaLastDealId || 0 });
});
app.post("/api/mt5/ea/validate", ...eaProtection, async (req, res) => {
  const body = validateEaBody(res, EaValidateSchema, req.body || {});
  if (!body) return;
  const auth2 = await authEaRequest(req, res, body.token);
  if (!auth2) return;
  const { db, account } = auth2;
  const terminal = body.terminal || {};
  const reportedLogin = body.login || terminal.login;
  const reportedServer = body.server || terminal.server;
  if (reportedLogin !== void 0 && reportedLogin !== "") {
    account.eaTerminalLogin = String(reportedLogin);
    if (account.mt5Login && String(account.mt5Login) !== String(reportedLogin)) {
      logEaEvent(db, account, "EA_VALIDATE_FAIL", "warn", "Terminal login does not match portfolio login");
      return res.status(403).json({ error: "Terminal login does not match the portfolio account login", code: "EA_LOGIN_MISMATCH" });
    }
  }
  if (reportedServer !== void 0 && reportedServer !== "") {
    account.eaTerminalServer = String(reportedServer);
    if (account.mt5Server && String(account.mt5Server) !== String(reportedServer)) {
      logEaEvent(db, account, "EA_VALIDATE_FAIL", "warn", "Terminal server does not match portfolio server");
      return res.status(403).json({ error: "Terminal server does not match the portfolio account server", code: "EA_SERVER_MISMATCH" });
    }
  }
  if (body.build) account.mt5Build = String(body.build);
  account.eaStatus = "Connected";
  account.connectionStatus = "Connected";
  account.eaConnectedAt = account.eaConnectedAt || (/* @__PURE__ */ new Date()).toISOString();
  account.lastHeartbeatAt = (/* @__PURE__ */ new Date()).toISOString();
  logEaEvent(db, account, "EA_VALIDATE", "info", "EA validate succeeded");
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true, status: "Connected", lastDealId: account.eaLastDealId || 0, portfolioId: account.id });
});
app.post("/api/mt5/ea/account", ...eaProtection, async (req, res) => {
  const body = validateEaBody(res, EaAccountSchema, req.body || {});
  if (!body) return;
  const auth2 = await authEaRequest(req, res, body.token);
  if (!auth2) return;
  const { db, account } = auth2;
  if (!Array.isArray(db.mt5Snapshots)) db.mt5Snapshots = [];
  db.mt5Snapshots.push({
    accountId: account.id,
    userId: db.users?.[0]?.id,
    balance: body.balance,
    equity: body.equity,
    margin: body.margin ?? null,
    marginFree: body.marginFree ?? null,
    marginLevel: body.marginLevel ?? null,
    currency: body.currency || account.currency || null,
    leverage: body.leverage ?? null,
    capturedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  if (db.mt5Snapshots.length > 2e4) db.mt5Snapshots = db.mt5Snapshots.slice(-2e4);
  account.currentBalance = body.balance;
  account.equity = body.equity;
  if (body.currency) account.currency = body.currency;
  if (body.leverage) account.leverage = body.leverage;
  account.eaStatus = "Connected";
  account.connectionStatus = "Connected";
  account.lastHeartbeatAt = (/* @__PURE__ */ new Date()).toISOString();
  logEaEvent(db, account, "EA_ACCOUNT", "info", "Account snapshot recorded");
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true, captured: true });
});
app.post("/api/mt5/ea/positions", ...eaProtection, async (req, res) => {
  const body = validateEaBody(res, EaPositionSchema, req.body || {});
  if (!body) return;
  const auth2 = await authEaRequest(req, res, body.token);
  if (!auth2) return;
  const { db, account } = auth2;
  if (!Array.isArray(db.mt5OpenPositions)) db.mt5OpenPositions = [];
  const posMap = /* @__PURE__ */ new Map();
  for (const p of body.positions) {
    posMap.set(`${account.id}:${p.positionId}`, {
      accountId: account.id,
      userId: db.users?.[0]?.id,
      positionId: Number(p.positionId),
      ticket: Number(p.ticket),
      symbol: String(p.symbol || "").toUpperCase(),
      side: String(p.side || ""),
      volume: p.volume,
      openTime: new Date(p.openTime * 1e3).toISOString(),
      openPrice: p.openPrice,
      sl: p.sl ?? null,
      tp: p.tp ?? null,
      commission: p.commission ?? 0,
      swap: p.swap ?? 0,
      profit: p.profit ?? 0,
      currentPrice: p.currentPrice ?? null,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  db.mt5OpenPositions = db.mt5OpenPositions.filter((op) => op.accountId !== account.id);
  db.mt5OpenPositions.push(...posMap.values());
  account.eaStatus = "Connected";
  account.connectionStatus = "Connected";
  account.lastHeartbeatAt = (/* @__PURE__ */ new Date()).toISOString();
  logEaEvent(db, account, "EA_POSITIONS", "info", `Open positions snapshot: ${body.positions.length}`);
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true, positions: body.positions.length });
});
app.post("/api/mt5/ea/orders", ...eaProtection, async (req, res) => {
  const body = validateEaBody(res, EaOrderSchema, req.body || {});
  if (!body) return;
  const auth2 = await authEaRequest(req, res, body.token);
  if (!auth2) return;
  const { db, account } = auth2;
  if (!Array.isArray(db.mt5PendingOrders)) db.mt5PendingOrders = [];
  const orderMap = /* @__PURE__ */ new Map();
  for (const o of body.orders) {
    orderMap.set(`${account.id}:${o.orderId}`, {
      accountId: account.id,
      userId: db.users?.[0]?.id,
      orderId: Number(o.orderId),
      symbol: String(o.symbol || "").toUpperCase(),
      type: String(o.type || ""),
      volume: o.volume,
      openPrice: o.openPrice,
      sl: o.sl ?? null,
      tp: o.tp ?? null,
      magic: o.magic ?? 0,
      state: String(o.state || ""),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  db.mt5PendingOrders = db.mt5PendingOrders.filter((op) => op.accountId !== account.id);
  db.mt5PendingOrders.push(...orderMap.values());
  account.eaStatus = "Connected";
  account.connectionStatus = "Connected";
  account.lastHeartbeatAt = (/* @__PURE__ */ new Date()).toISOString();
  logEaEvent(db, account, "EA_ORDERS", "info", `Pending orders snapshot: ${body.orders.length}`);
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true, orders: body.orders.length });
});
app.post("/api/mt5/ea/heartbeat", ...eaProtection, async (req, res) => {
  const body = validateEaBody(res, EaHeartbeatSchema, req.body || {});
  if (!body) return;
  const auth2 = await authEaRequest(req, res, body.token);
  if (!auth2) return;
  const { db, account } = auth2;
  if (body.balance !== void 0) account.currentBalance = body.balance;
  if (body.equity !== void 0) account.equity = body.equity;
  if (body.tradeCount !== void 0) account.eaSyncTradeCount = body.tradeCount;
  account.eaStatus = "Connected";
  account.connectionStatus = "Connected";
  account.lastHeartbeatAt = (/* @__PURE__ */ new Date()).toISOString();
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true });
});
app.post("/api/mt5/ea/error", ...eaProtection, async (req, res) => {
  const body = validateEaBody(res, EaErrorSchema, req.body || {});
  if (!body) return;
  const auth2 = await authEaRequest(req, res, body.token);
  if (!auth2) return;
  const { db, account } = auth2;
  if (!Array.isArray(db.mt5ConnectionErrors)) db.mt5ConnectionErrors = [];
  db.mt5ConnectionErrors.push({
    accountId: account.id,
    userId: db.users?.[0]?.id,
    errorCode: body.code || "EA_ERROR",
    errorMessage: String(body.message || "").slice(0, 500),
    occurredAt: (/* @__PURE__ */ new Date()).toISOString(),
    resolvedAt: null
  });
  if (db.mt5ConnectionErrors.length > 1e3) db.mt5ConnectionErrors = db.mt5ConnectionErrors.slice(-1e3);
  account.connectionStatus = "Error";
  logEaEvent(db, account, "EA_ERROR", "error", `${body.code || "EA_ERROR"}: ${String(body.message || "").slice(0, 200)}`);
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true });
});
function applyEaSyncPayload(db, acc, deals, moneyFlows, account) {
  const userId = db.users?.[0]?.id;
  const accountId = String(acc.id);
  if (!Array.isArray(db.mt5Deals)) db.mt5Deals = [];
  const seen = new Set(
    db.mt5Deals.filter((d) => d.accountId === accountId).map((d) => d.ticket)
  );
  let added = 0;
  let maxTicket = acc.eaLastDealId || 0;
  for (const raw of deals) {
    const d = normalizeDeal(raw);
    if (!d.ticket) continue;
    if (!seen.has(d.ticket)) {
      addEaDeal(db, acc, d, userId);
      seen.add(d.ticket);
      added++;
    }
    if (d.ticket > maxTicket) maxTicket = d.ticket;
  }
  let moneyFlowAdded = 0;
  if (Array.isArray(moneyFlows)) {
    if (!Array.isArray(db.mt5MoneyFlows)) db.mt5MoneyFlows = [];
    for (const mf of moneyFlows) {
      const ticket = Number(mf.ticket);
      if (!ticket) continue;
      if (!db.mt5MoneyFlows.some((f) => f.accountId === acc.id && f.ticket === ticket)) {
        db.mt5MoneyFlows.push({
          accountId: acc.id,
          userId,
          ticket,
          flowType: mf.type,
          amount: Number(mf.amount) || 0,
          currency: mf.currency || acc.currency || null,
          time: new Date(Number(mf.time) * 1e3).toISOString()
        });
        moneyFlowAdded++;
      }
    }
    if (db.mt5MoneyFlows.length > 2e4) db.mt5MoneyFlows = db.mt5MoneyFlows.slice(-2e4);
  }
  const accountDeals = db.mt5Deals.filter((d) => d.accountId === accountId);
  let skipBalanceTicket;
  if (acc.isMt5Sync) {
    const deposits = accountDeals.filter((d) => d.type === DEAL_TYPE_BALANCE && (d.profit || 0) > 0).sort((a, b) => a.time - b.time);
    if (deposits.length > 0) {
      skipBalanceTicket = deposits[0].ticket;
      if (!acc.startingBalance || acc.startingBalance === 0) {
        acc.startingBalance = parseFloat(deposits[0].profit.toFixed(2));
      }
    }
  }
  const recomputed = recomputeMt5TradesForAccount(acc, accountDeals, skipBalanceTicket);
  const existingById = new Map(
    db.trades.filter((t) => t.accountId === accountId && t.eaDealId !== void 0).map((t) => [t.id, t])
  );
  let inserted = 0;
  let updated = 0;
  for (const tr of recomputed) {
    const prev = existingById.get(tr.id);
    if (prev) {
      Object.assign(prev, tr);
      updated++;
    } else {
      db.trades.push(tr);
      inserted++;
    }
  }
  const recomputedIds = new Set(recomputed.map((t) => t.id));
  db.trades = db.trades.filter((t) => {
    if (t.accountId === accountId && t.eaDealId !== void 0 && !recomputedIds.has(t.id)) return false;
    return true;
  });
  if (account && typeof account === "object") {
    if (account.balance !== void 0) acc.currentBalance = parseFloat(account.balance) || acc.currentBalance;
    if (account.equity !== void 0) acc.equity = parseFloat(account.equity) || acc.equity;
    if (account.currency !== void 0 && account.currency) acc.currency = String(account.currency);
  }
  acc.eaStatus = "Connected";
  acc.connectionStatus = "Connected";
  acc.eaConnectedAt = acc.eaConnectedAt || (/* @__PURE__ */ new Date()).toISOString();
  acc.eaLastSyncTime = (/* @__PURE__ */ new Date()).toISOString();
  acc.lastHeartbeatAt = (/* @__PURE__ */ new Date()).toISOString();
  acc.eaLastDealId = maxTicket;
  acc.eaSyncTradeCount = db.trades.filter(
    (t) => t.accountId === accountId && t.type !== "Deposit" && t.type !== "Withdrawal"
  ).length;
  return { inserted, updated, added, moneyFlowAdded, maxTicket };
}
app.post("/api/mt5/ea/sync", ...eaProtection, async (req, res) => {
  const body = validateEaBody(res, EaSyncSchema, req.body || {});
  if (!body) return;
  const auth2 = await authEaRequest(req, res, body.token);
  if (!auth2) return;
  const { db, account: acc } = auth2;
  const { deals, moneyFlows, account } = body;
  const summary = applyEaSyncPayload(db, acc, deals, moneyFlows, account);
  logEaEvent(db, acc, "EA_SYNC", "info", `Deals: ${summary.added} new / ${deals.length} received; money flows: ${summary.moneyFlowAdded} new`);
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true, inserted: summary.inserted, updated: summary.updated, totalTrades: acc.eaSyncTradeCount, cursor: summary.maxTicket, status: acc.eaStatus });
});
app.get("/api/mt5/:accountId/status", async (req, res) => {
  let db = req.userDb;
  let currentUser = req.currentUser;
  if (!currentUser || !db) return res.status(401).json({ error: "Not authenticated" });
  const account = db.accounts.find((a) => a.id === req.params.accountId);
  if (!account) return res.status(404).json({ error: "Account not found" });
  if (account.userId !== currentUser.id) return res.status(403).json({ error: "Access denied" });
  const openPositions = Array.isArray(db.mt5OpenPositions) ? db.mt5OpenPositions.filter((p) => p.accountId === account.id) : [];
  const pendingOrders = Array.isArray(db.mt5PendingOrders) ? db.mt5PendingOrders.filter((o) => o.accountId === account.id) : [];
  const moneyFlows = Array.isArray(db.mt5MoneyFlows) ? db.mt5MoneyFlows.filter((f) => f.accountId === account.id) : [];
  const lastErrors = Array.isArray(db.mt5ConnectionErrors) ? db.mt5ConnectionErrors.filter((e) => e.accountId === account.id).slice(-5) : [];
  const snapshots = Array.isArray(db.mt5Snapshots) ? db.mt5Snapshots.filter((s) => s.accountId === account.id).slice(-500) : [];
  const connectJobs = Array.isArray(db.mt5ConnectJobs) ? db.mt5ConnectJobs.filter((j) => j.accountId === account.id).slice(-5) : [];
  const workerConfigured = !!process.env.META_API_TOKEN?.trim();
  const cloudStuckValidating = account.syncMethod === "CLOUD" && account.connectionStatus === "Validating" && !workerConfigured;
  let connStatus = account.connectionStatus || account.eaStatus || "Not Connected";
  let resolvedErrors = lastErrors;
  if (cloudStuckValidating) {
    connStatus = "Error";
    const cloudUnavailable = {
      errorCode: "CLOUD_WORKER_UNAVAILABLE",
      errorMessage: "Cloud sync worker is not configured on this deployment (META_API_TOKEN missing). Use the EA method.",
      occurredAt: (/* @__PURE__ */ new Date()).toISOString(),
      resolvedAt: null
    };
    resolvedErrors = [cloudUnavailable, ...lastErrors];
  }
  res.json({
    accountId: account.id,
    status: connStatus,
    eaStatus: account.eaStatus || "Not Connected",
    syncMethod: account.syncMethod || "EA",
    cloudConnected: !!account.investorPasswordEnc,
    workerConfigured,
    connectJobs,
    lastSyncTime: account.eaLastSyncTime || null,
    lastHeartbeatAt: account.lastHeartbeatAt || null,
    lastDealId: account.eaLastDealId || 0,
    syncTradeCount: account.eaSyncTradeCount || 0,
    startingBalance: account.startingBalance || 0,
    currentBalance: account.currentBalance || 0,
    equity: account.equity || 0,
    terminalLogin: account.eaTerminalLogin || account.mt5Login || null,
    terminalServer: account.eaTerminalServer || account.mt5Server || null,
    openPositions,
    pendingOrders,
    moneyFlows,
    lastErrors: resolvedErrors,
    snapshots
  });
});
app.post("/api/mt5/cloud/connect", async (req, res) => {
  let db = req.userDb;
  let currentUser = req.currentUser;
  if (!currentUser || !db) return res.status(401).json({ error: "Not authenticated" });
  if (!requirePro(req, res, "mt5Sync")) return;
  const body = validateEaBody(res, CloudConnectSchema, req.body || {});
  if (!body) return;
  const account = db.accounts.find((a) => a.id === body.accountId);
  if (!account) return res.status(404).json({ error: "Account not found" });
  if (account.userId !== currentUser.id) return res.status(403).json({ error: "Access denied" });
  if (!process.env.META_API_TOKEN?.trim()) {
    return res.status(503).json({
      error: "The cloud sync worker is not configured on this deployment yet (META_API_TOKEN is missing). Use the EA method, which needs no extra setup.",
      code: "CLOUD_WORKER_UNAVAILABLE"
    });
  }
  const enc = encryptInvestorPassword(body.investorPassword);
  if (!enc) {
    return res.status(503).json({
      error: "Cloud sync is not configured on this deployment yet. Use the EA method instead.",
      code: "CLOUD_NOT_CONFIGURED"
    });
  }
  account.investorPasswordEnc = enc.enc;
  account.passwordEncNonce = "";
  account.passwordKmsKeyId = enc.keyId;
  account.mt5Login = body.login;
  account.mt5Server = body.server;
  account.syncMethod = "CLOUD";
  account.connectionStatus = "Validating";
  account.lastHeartbeatAt = void 0;
  account.eaStatus = "Not Connected";
  const jobId = enqueueConnectJob(db, account, "CONNECT");
  logEaEvent(db, account, "CLOUD_CONNECT_REQUESTED", "info", "Cloud connect requested; investor password stored encrypted");
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true, jobId, syncMethod: "CLOUD", status: "Validating" });
});
app.post("/api/mt5/cloud/disconnect", async (req, res) => {
  let db = req.userDb;
  let currentUser = req.currentUser;
  if (!currentUser || !db) return res.status(401).json({ error: "Not authenticated" });
  const body = validateEaBody(res, CloudDisconnectSchema, req.body || {});
  if (!body) return;
  const account = db.accounts.find((a) => a.id === body.accountId);
  if (!account) return res.status(404).json({ error: "Account not found" });
  if (account.userId !== currentUser.id) return res.status(403).json({ error: "Access denied" });
  clearInvestorPassword(account);
  account.syncMethod = "EA";
  account.connectionStatus = "Disconnected";
  account.lastHeartbeatAt = void 0;
  account.disconnectedAt = (/* @__PURE__ */ new Date()).toISOString();
  enqueueConnectJob(db, account, "DISCONNECT");
  logEaEvent(db, account, "CLOUD_DISCONNECT", "warn", "Cloud sync disconnected; encrypted credentials removed");
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true, status: "Disconnected" });
});
app.post("/api/mt5/cloud/sync", async (req, res) => {
  let db = req.userDb;
  let currentUser = req.currentUser;
  if (!currentUser || !db) return res.status(401).json({ error: "Not authenticated" });
  if (!requirePro(req, res, "mt5Sync")) return;
  const body = validateEaBody(res, CloudDisconnectSchema, req.body || {});
  if (!body) return;
  const account = db.accounts.find((a) => a.id === body.accountId);
  if (!account) return res.status(404).json({ error: "Account not found" });
  if (account.userId !== currentUser.id) return res.status(403).json({ error: "Access denied" });
  if (account.syncMethod !== "CLOUD") {
    return res.status(400).json({ error: "Account is not configured for cloud sync" });
  }
  if (!account.investorPasswordEnc) {
    return res.status(400).json({ error: "Cloud sync credentials not found. Please reconnect." });
  }
  const jobId = enqueueConnectJob(db, account, "SYNC_NOW");
  logEaEvent(db, account, "CLOUD_SYNC_REQUESTED", "info", "Manual on-demand cloud sync requested");
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true, jobId, status: "Validating" });
});
app.post("/api/mt5/:accountId/disconnect", async (req, res) => {
  let db = req.userDb;
  let currentUser = req.currentUser;
  if (!currentUser || !db) return res.status(401).json({ error: "Not authenticated" });
  const account = db.accounts.find((a) => a.id === req.params.accountId);
  if (!account) return res.status(404).json({ error: "Account not found" });
  if (account.userId !== currentUser.id) return res.status(403).json({ error: "Access denied" });
  account.eaToken = void 0;
  account.eaStatus = "Not Connected";
  account.connectionStatus = "Disconnected";
  account.eaConnectedAt = void 0;
  account.lastHeartbeatAt = void 0;
  account.eaTokenRevokedAt = (/* @__PURE__ */ new Date()).toISOString();
  account.disconnectedAt = (/* @__PURE__ */ new Date()).toISOString();
  logEaEvent(db, account, "EA_DISCONNECT", "warn", "User disconnected the MT5 sync");
  await saveDatabase(db, db.users?.[0]?.email);
  res.json({ ok: true, status: "Disconnected" });
});
app.post("/api/ai/mentor", async (req, res) => {
  let db = req.userDb;
  let currentUser = req.currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: "Not authenticated" });
  if (!requirePro(req, res, "aiMentor")) return;
  const { accountId, messages } = req.body;
  if (!accountId) return res.status(400).json({ error: "accountId is required" });
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }
  const targetAcc = db.accounts?.find((a) => a.id === accountId);
  const accountName = targetAcc ? targetAcc.name : "Primary Portfolio";
  const accountTrades = db.trades.filter(
    (t) => t.accountId === accountId && t.type !== "Deposit" && t.type !== "Withdrawal"
  );
  const recentTrades = accountTrades.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 50);
  const digest = recentTrades.map((t) => ({
    date: t.date.split("T")[0],
    symbol: t.symbol,
    type: t.type,
    lots: t.lotSize,
    profit: t.profit,
    risk: t.riskPercentage,
    emotion: t.emotion,
    strategy: t.strategy
  }));
  const geminiKey = process.env.GEMINI_API_KEY;
  const userMessage = messages.length > 0 ? messages[messages.length - 1]?.content || "" : "";
  const traderName = currentUser?.name ? currentUser.name.split(" ")[0] : "Trader";
  const generateSmartMentorFallback = (msgText, trades, accName) => {
    const msg = msgText.toLowerCase().trim();
    const totalTrades = trades.length;
    const wins = trades.filter((t) => (t.profit || 0) > 0);
    const losses = trades.filter((t) => (t.profit || 0) < 0);
    const totalProfit = trades.reduce((acc, t) => acc + (t.profit || 0), 0);
    const winRate = totalTrades > 0 ? (wins.length / totalTrades * 100).toFixed(1) : "0";
    const totalWinAmount = wins.reduce((acc, t) => acc + (t.profit || 0), 0);
    const totalLossAmount = Math.abs(losses.reduce((acc, t) => acc + (t.profit || 0), 0));
    const avgWin = wins.length > 0 ? (totalWinAmount / wins.length).toFixed(2) : "0.00";
    const avgLoss = losses.length > 0 ? (totalLossAmount / losses.length).toFixed(2) : "0.00";
    const profitFactor = totalLossAmount > 0 ? (totalWinAmount / totalLossAmount).toFixed(2) : totalWinAmount > 0 ? "Inf" : "1.0";
    const avgRisk = totalTrades > 0 ? (trades.reduce((acc, t) => acc + (t.riskPercentage || 1), 0) / totalTrades).toFixed(1) : "1.0";
    const symbolsCount = {};
    trades.forEach((t) => {
      if (t.symbol) symbolsCount[t.symbol] = (symbolsCount[t.symbol] || 0) + 1;
    });
    const topSymbol = Object.entries(symbolsCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "N/A";
    const emotionCount = {};
    trades.forEach((t) => {
      if (t.emotion) emotionCount[t.emotion] = (emotionCount[t.emotion] || 0) + 1;
    });
    const topEmotion = Object.entries(emotionCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "Neutral";
    const revengeCount = trades.filter((t) => (t.emotion || "").toLowerCase().includes("revenge") || (t.tags || []).some((tag) => tag.toLowerCase().includes("revenge"))).length;
    const fomoCount = trades.filter((t) => (t.emotion || "").toLowerCase().includes("fomo") || (t.tags || []).some((tag) => tag.toLowerCase().includes("fomo"))).length;
    if (/^(hy|hi|hello|hey|greetings|hola|sup|good morning|good afternoon|good evening|yo)\b/i.test(msg)) {
      if (totalTrades === 0) {
        return `Hey ${traderName}! \u{1F44B} Really great to meet you! \u{1F60A}

I'm your personal AI Trading Mentor & Coach on FX Journal Pro. Think of me as your 24/7 trading companion, mindset buddy, and partner in the markets!

Whether you want to chat about trading psychology, building iron discipline, managing risk, discussing setups, or just chatting about your trading goals \u2014 I'm right here with you.

Once you start logging trades in your journal, I'll also dive deep into your statistics to spot what's working and where we can level up together. How is your trading journey going so far? How are you feeling today? \u{1F680}`;
      }
      return `Hey ${traderName}! \u{1F44B} Really wonderful to see you! \u{1F60A}

How have your trading sessions been treating you lately? I'm always in your corner \u2014 whether you want to review your recent numbers, talk through a tricky setup, recalibrate your risk, or celebrate a disciplined win.

\u{1F4CA} Quick snapshot of **"${accName}"**:
\u2022 **P/L**: ${totalProfit >= 0 ? "+" : ""}$${totalProfit.toFixed(2)} ${totalProfit >= 0 ? "\u{1F7E2}" : "\u{1F534}"}
\u2022 **Win Rate**: ${winRate}% (${wins.length}W / ${losses.length}L)
\u2022 **Top Asset**: ${topSymbol}
\u2022 **Emotion**: ${topEmotion}

What's on your mind today? How can I help you level up? \u{1F680}`;
    }
    if (totalTrades === 0) {
      return `Hey ${traderName}! \u{1F60A} I'm right here with you!

I noticed you haven't logged any trades yet in **"${accName}"** \u2014 and that is 100% fine! Everyone starts from day one.

While you prepare your next setups, feel free to ask me anything about risk management, trading psychology, handling emotions like fear or FOMO, or building a high-probability trading routine.

Once you log your first few trades, I'll start sharing deep personalized insights. What would you like to explore today? \u{1F4AA}`;
    }
    if (/can i (be|become)|profitable trader|will i succeed|am i good|am i ready|is trading for me/.test(msg)) {
      const isCurrentlyProfitable = totalProfit > 0;
      return `### \u{1F31F} Can You Become a Profitable Trader?

**Absolutely \u2014 yes, you can.** But it takes the right mindset and approach.

` + (isCurrentlyProfitable ? `Looking at your data, you are **currently profitable** with a **+$${totalProfit.toFixed(2)} net P/L** across ${totalTrades} trades \u2014 that already puts you ahead of most retail traders!

` : `Right now your account shows a **-$${Math.abs(totalProfit).toFixed(2)} net P/L** across ${totalTrades} trades. That's normal in the learning phase \u2014 most traders are unprofitable before they become consistently profitable.

`) + `**What makes a profitable trader:**
1. **Consistency over perfection** \u2014 Aim to execute the same process every trade, not just win every trade.
2. **Risk management first** \u2014 Traders who blow accounts focus on profits. Profitable traders focus on survival.
3. **Journal everything** \u2014 You are already doing this! Reviewing your journal is your biggest edge.
4. **Patience** \u2014 Most traders become profitable after 12\u201324 months of intentional practice.

You have the tools. Keep building the habits. I believe in you. \u{1F4AA}`;
    }
    if (/loss|losing streak|consecutive loss|bad day|bad week|not profitable|struggling|giving up|quit trading|sad|depressed|frustrated|angry|fail|failing/.test(msg)) {
      const recentLosses = trades.slice(-5).filter((t) => (t.profit || 0) < 0).length;
      return `### \u{1F499} I'm Here For You \u2014 Mental Support

I hear you, and I want you to know that **every great trader has been exactly where you are right now.** Drawdowns and losing streaks are not a sign of failure \u2014 they are a part of the journey.

` + (recentLosses >= 3 ? `Looking at your recent trades, you have had **${recentLosses} losses in your last 5 trades**. That's a real losing streak, and it's important to respond to it with discipline, not emotion.

` : "") + `**What to do right now:**
1. **Stop trading today.** Seriously. Close the charts and step away. Continuing while emotional almost always makes it worse.
2. **Reduce your lot size by 50%** when you return. Rebuilding confidence with smaller risk is far more effective than trying to "win it back".
3. **Review your last 5 trades in your journal.** Were you following your rules? If not, the market is giving you feedback \u2014 listen to it.
4. **Remember why you started.** The goal is long-term consistency, not perfection this week.

You have not failed. You are in the training phase that every profitable trader goes through. Take a breath, rest today, and come back stronger tomorrow. \u{1F64F}`;
    }
    if (/motivat|inspire|confidence|believe|encourage|keep going|don.t give up|not sure|doubt/.test(msg)) {
      return `### \u{1F525} You've Got This!

Trading is one of the hardest mental skills in the world, but you are taking it seriously by journaling and reviewing your trades \u2014 that alone puts you in the **top 5% of traders**.

Here are your personal stats to remind you of your progress:
\u2022 You have logged **${totalTrades} trades** \u2014 each one is a lesson.
\u2022 Your win rate is **${winRate}%** \u2014 ${parseFloat(winRate) >= 50 ? "above average! Keep it up." : "there is room to grow, and that is exciting."}
\u2022 Your most traded pair is **${topSymbol}** \u2014 you are specializing, which is smart.

**Daily Affirmations for Traders:**
\u2022 "I follow my rules, every single trade."
\u2022 "My job is to execute well, not to predict the market."
\u2022 "I am building a skill that will last a lifetime."

The traders who succeed are not the smartest \u2014 they are the most consistent. Keep showing up. \u{1F4AA}`;
    }
    if (/strategy|setup|entry|confluence|timeframe|ema|sma|indicator|signal|trend|support|resistance|order block|supply|demand|breakout|scalp|swing|position/.test(msg)) {
      return `### \u{1F4C8} Strategy & Trade Execution

Based on your journal, your most traded pair is **${topSymbol}** and your win rate is **${winRate}%**.

**General Strategy Principles:**
1. **Trade with the higher timeframe trend.** Identify the trend on H4/Daily, then drop to H1/M15 for entry.
2. **Wait for confluence.** The best setups have 2\u20133 reasons to enter: structure, key level, and a trigger candle.
3. **Only trade your A+ setups.** If you are unsure, do not enter. The market will give you another opportunity.
4. **Pre-plan your trades.** Before the session, mark your levels and write down what you are looking for.

**For your ${topSymbol} trades specifically:**
Focus on the London (07:00\u201310:00 GMT) and New York (13:00\u201316:00 GMT) sessions for the highest probability moves on currency and gold pairs.

Would you like me to analyze a specific strategy or review your recent trades in more detail?`;
    }
    if (/fomo|revenge|overtrad|impulsiv|chasing|miss|missed|regret/.test(msg)) {
      return `### \u{1F9E0} FOMO & Revenge Trading Control

` + (fomoCount > 0 || revengeCount > 0 ? `I can see from your journal that you have had **${fomoCount} FOMO trade${fomoCount !== 1 ? "s" : ""}** and **${revengeCount} revenge trade${revengeCount !== 1 ? "s" : ""}** logged. This is incredibly honest of you \u2014 recognizing these patterns is the first step.

` : "") + `**The truth about FOMO and Revenge:**
These are the #1 account killers in retail trading. They feel urgent and justified in the moment but are almost always losers.

**How to break the cycle:**
1. **Set a "loss limit" rule.** If you lose 2 trades in a session, close the platform. Period.
2. **Use a pre-trade checklist.** Before every entry, ask: "Is this in my plan? Is this my setup?" If not, close the chart.
3. **Accept missed trades.** Remind yourself: "There will always be another setup tomorrow."
4. **Journal your emotions in real-time.** Even a one-word note \u2014 "FOMO" or "Calm" \u2014 creates awareness that rewires your behavior over time.

The market rewards patience. The impulse to chase is a signal to wait, not act.`;
    }
    if (/risk|lot size|position size|drawdown|money management|capital|leverage|margin/.test(msg)) {
      return `### \u{1F6E1}\uFE0F Risk Management Analysis for "${accName}"

\u2022 **Your Average Risk Per Trade**: ${avgRisk}%
\u2022 **Average Win vs Average Loss**: $${avgWin} vs $${avgLoss}
\u2022 **Profit Factor**: ${profitFactor}

**Risk Rules Every Profitable Trader Follows:**
1. **Risk 1% or less per trade.** At 1%, you can lose 20 trades in a row and still have 80% of your capital.
2. **Never move your stop loss against yourself.** If it gets hit, accept it and move on.
3. **Target a minimum 1:2 Risk-to-Reward.** Even with a 40% win rate, a 1:2 RR is profitable over time.
4. **Stop trading at your daily max loss** (e.g., 3%). Protect your capital above all else.

` + (parseFloat(avgRisk) > 2 ? `\u26A0\uFE0F **Your average risk of ${avgRisk}% per trade is above the recommended 1\u20132%.** Consider reducing your lot sizes to protect your account during losing streaks.` : `\u2705 Your risk per trade looks controlled. Keep maintaining this discipline!`);
    }
    if (/psychology|emotion|discipline|mindset|mental|patience|control|calm|anxiety|fear|greed/.test(msg)) {
      return `### \u{1F9E0} Trading Psychology & Emotional Control

Across your ${totalTrades} trades, your most recorded emotional state is **${topEmotion}**.

**The 5 Pillars of Trading Psychology:**
1. **Acceptance** \u2014 Accept that losses are inevitable and part of the process. Your goal is to control risk, not eliminate losses.
2. **Patience** \u2014 Wait for your setups. Most profitable traders only take 1\u20133 trades per day.
3. **Discipline** \u2014 Follow your rules even when you don't want to. That is where the edge lives.
4. **Detachment** \u2014 Detach your identity from individual trade outcomes. A loss does not make you a bad trader.
5. **Process Focus** \u2014 Judge yourself on execution quality, not just P&L.

**Daily Practices:**
\u2022 Before trading: Write your plan and set your max loss for the day.
\u2022 After trading: Journal every trade, including your emotion.
\u2022 Weekly: Review your journal. What patterns do you see?`;
    }
    if (/win rate|stat|performance|analyz|summary|how am i doing|result|profit|my trades|my account|my journal/.test(msg)) {
      return `### \u{1F4CA} Performance Analysis for "${accName}"

\u2022 **Total Trades Analyzed**: ${totalTrades}
\u2022 **Win Rate**: ${winRate}% (${wins.length} Wins, ${losses.length} Losses)
\u2022 **Net P/L**: ${totalProfit >= 0 ? "+" : ""}$${totalProfit.toFixed(2)}
\u2022 **Average Win**: $${avgWin} | **Average Loss**: $${avgLoss}
\u2022 **Profit Factor**: ${profitFactor}
\u2022 **Top Traded Pair**: ${topSymbol}
\u2022 **Dominant Emotion**: ${topEmotion}

**Mentor Insight**: ${parseFloat(winRate) >= 55 ? "\u{1F7E2} Strong win rate! Your edge is working. Focus on maximizing your winners by not closing trades early." : parseFloat(winRate) >= 45 ? "\u{1F7E1} Your win rate is near breakeven. Focus on improving your entry quality and targeting higher reward-to-risk setups." : "\u{1F534} Your win rate needs attention. Review your entry rules \u2014 are you entering at high-probability zones, or chasing price?"}`;
    }
    if (/how to use|how do i|journal|log|track|tag|note/.test(msg)) {
      return `### \u{1F4D3} How to Get the Most Out of Your Journal

Your journal is your most powerful tool. Here is how to use it effectively:

1. **Log every trade** \u2014 Use the "Add New Trade" button after every position you take.
2. **Tag your emotion** \u2014 Choose how you felt (Calm, FOMO, Revenge, Excited). This data builds over time and reveals patterns.
3. **Add your strategy** \u2014 Note which setup triggered the entry (e.g., Order Block, EMA Cross, Breakout).
4. **Write a note** \u2014 Even one sentence like "entered too early" or "good execution" is valuable for review.
5. **Review weekly** \u2014 Ask me "analyze my stats" every week to track your progress.

The more data you log, the smarter and more personalized my coaching becomes for you!`;
    }
    const motivations = [
      "Trading is not about being right \u2014 it's about managing risk when you're wrong. Keep your losses small and let your winners breathe.",
      "Every expert was once a beginner. Every profitable trader has a journal full of mistakes. Your losses are not failures \u2014 they are lessons you paid for.",
      "The market does not owe you a profit. But if you respect your risk, follow your plan, and stay consistent, the edge will show up over time.",
      "Discipline is the bridge between where you are and where you want to be. Execute your plan one trade at a time.",
      "Patience is not waiting \u2014 it's knowing when the right opportunity appears. The best trades almost take themselves.",
      "Your emotional state is part of your trading edge. A calm mind sees setups clearly; an emotional mind sees what it wants to see.",
      "Focus on what you can control: your entries, your risk, your exits, and your attitude. The rest is up to the market."
    ];
    const randomMotivation = motivations[Math.floor(Math.random() * motivations.length)];
    return `**\u{1F4A1} Mentor Insight**: ${randomMotivation}

I'm here to support your full trading journey! You can ask me things like:
\u2022 *"Can I become a profitable trader?"*
\u2022 *"I'm in a losing streak, help me"*
\u2022 *"How is my risk management?"*
\u2022 *"Analyze my performance"*
\u2022 *"Give me psychology tips"*
\u2022 *"How do I control FOMO?"*

What's on your mind today?`;
  };
  if (!geminiKey || geminiKey === "MY_GEMINI_API_KEY") {
    const fallbackReply = generateSmartMentorFallback(userMessage, accountTrades, accountName);
    return res.json({ reply: fallbackReply, fallback: true });
  }
  try {
    const ai = new GoogleGenAI({
      apiKey: geminiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });
    const systemInstruction = `You are ${traderName}'s personal trading mentor, coach, and companion on FX Journal Pro. Your name is "AI Mentor".

Personality & Vibe:
- Extremely warm, friendly, encouraging, and approachable \u2014 like a trusted mentor, brother, and trading companion who truly wants to see ${traderName} succeed!
- Always greet warmly and enthusiastically ("Hey ${traderName}! \u{1F44B} Really great to see you!", "Welcome back, my friend! \u{1F60A}").
- Speak in a natural, conversational, and supportive first-person tone: "I'm right here with you", "Let's work through this together", "I'm proud of your discipline".
- Never sound robotic, cold, bureaucratic, or dismissive.
- If ${traderName} has 0 or few trades logged, warmly welcome them, reassure them that every great trader started with trade #1, and offer to chat about mindset, discipline, setups, or risk rules.
- When ${traderName} expresses fear, doubt, loss, or FOMO, lead with heartfelt empathy FIRST before offering constructive guidance.
- Celebrate small milestones and positive habits, not just profits.
- Use uplifting emojis naturally to bring warmth (\u{1F44B}, \u{1F60A}, \u{1F680}, \u{1F4AA}, \u{1F3AF}, \u{1F4C8}, \u{1F9D8}, \u{1F64F}).

Trader Profile:
- Name: ${traderName}
- Account: ${accountName}
- Total Trades Logged: ${accountTrades.length}

Trading History Digest (Last 50 trades):
${JSON.stringify(digest)}

RESTRICTIONS:
- ONLY discuss trading, trading psychology, risk management, discipline, emotional control, performance improvement, and journal insights.
- If asked about unrelated topics, kindly redirect: "That's outside my expertise as your trading mentor \u2014 but I'm always here to talk trading, mindset, and strategy!"
- NEVER promise profits or guarantee outcomes.
- NEVER be dismissive or harsh. Always be encouraging and constructive.`;
    const firstUserIdx = messages.findIndex((m) => m.role === "user");
    const validMessages = firstUserIdx !== -1 ? messages.slice(firstUserIdx) : messages;
    const conversation = validMessages.map((msg) => ({
      role: msg.role === "mentor" ? "model" : "user",
      parts: [{ text: msg.content }]
    }));
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: conversation,
      config: {
        systemInstruction
      }
    });
    const replyText = response.text || generateSmartMentorFallback(userMessage, accountTrades, accountName);
    res.json({ reply: replyText });
  } catch (err) {
    console.error("Gemini API Error, using smart mentor fallback:", err);
    const fallbackReply = generateSmartMentorFallback(userMessage, accountTrades, accountName);
    res.json({ reply: fallbackReply });
  }
});
app.get("/api/tickets", async (req, res) => {
  let db = req.userDb;
  let currentUser = req.currentUser;
  if (!currentUser || !db) return res.json({ tickets: [] });
  const isAdmin = await checkIsAdmin(currentUser);
  if (isAdmin) {
    if (useSupabase) {
      try {
        const { data, error } = await supabase.from("support_tickets").select("*").order("date", { ascending: false });
        if (error) {
          console.error("[GET /api/tickets] Supabase error:", error);
          return res.status(500).json({ error: error.message });
        }
        const tickets2 = await attachTicketUserNames(data || []);
        return res.json({ tickets: tickets2 });
      } catch (e) {
        console.error("[GET /api/tickets] Admin query exception:", e);
        return res.status(500).json({ error: e?.message || "Failed to load tickets" });
      }
    }
    const tickets = await attachTicketUserNames(collectAllInMemoryTickets());
    return res.json({ tickets });
  }
  const userTickets = (db.supportTickets || []).filter((t) => t.userId === currentUser?.id);
  res.json({ tickets: userTickets });
});
app.post("/api/tickets", async (req, res) => {
  let db = req.userDb;
  let currentUser = req.currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: "Not authenticated" });
  const { title, description, category } = req.body;
  if (!title || !description) return res.status(400).json({ error: "Title and description are required" });
  const newTicket = {
    id: `ticket_${crypto2.randomUUID()}`,
    userId: currentUser.id,
    userEmail: currentUser.email,
    userName: currentUser.name || "",
    title,
    description,
    status: "Open",
    category: category || "Support",
    date: (/* @__PURE__ */ new Date()).toISOString()
  };
  db.supportTickets.push(newTicket);
  try {
    await saveDatabase(db);
  } catch (e) {
    console.error("[POST /api/tickets] Local persistence failed:", e?.message || e);
  }
  if (useSupabase) {
    const { error } = await supabase.from("support_tickets").insert({
      id: newTicket.id,
      user_id: currentUser.id,
      user_email: currentUser.email,
      title,
      description,
      status: "Open",
      category: newTicket.category,
      date: newTicket.date
    });
    if (error) {
      console.error("[POST /api/tickets] Supabase insert failed:", error.message);
      return res.status(500).json({ error: "Failed to save your submission. Please try again." });
    }
  }
  res.json({ message: "Support ticket submitted successfully", ticket: newTicket });
});
app.put("/api/tickets/:id", async (req, res) => {
  let db = req.userDb;
  let currentUser = req.currentUser;
  const authEmail = currentUser?.email;
  if (!currentUser || !db) return res.status(401).json({ error: "Not authenticated" });
  const { id } = req.params;
  const { status } = req.body;
  const isAdmin = await checkIsAdmin(currentUser);
  if (useSupabase) {
    const { data: ticketRow, error: fetchErr } = await supabase.from("support_tickets").select("id, user_id").eq("id", id).maybeSingle();
    if (fetchErr) {
      console.error("Error loading ticket from Supabase:", fetchErr);
      return res.status(500).json({ error: "Failed to update ticket" });
    }
    if (!ticketRow) return res.status(404).json({ error: "Ticket not found" });
    if (!isAdmin && ticketRow.user_id !== currentUser.id) {
      return res.status(403).json({ error: "You can only update your own tickets." });
    }
    const { error } = await supabase.from("support_tickets").update({ status: status || "Closed" }).eq("id", id);
    if (error) {
      console.error("Error updating ticket in Supabase:", error);
      return res.status(500).json({ error: "Failed to update ticket" });
    }
    return res.json({ message: "Ticket status updated" });
  }
  const idx = db.supportTickets.findIndex((t) => t.id === id);
  if (idx === -1) return res.status(404).json({ error: "Ticket not found" });
  if (!isAdmin && db.supportTickets[idx].userId !== currentUser.id) {
    return res.status(403).json({ error: "You can only update your own tickets." });
  }
  db.supportTickets[idx].status = status || "Closed";
  await saveDatabase(db);
  res.json({ message: "Ticket status updated", ticket: db.supportTickets[idx] });
});
app.get("/api/announcements", async (req, res) => {
  if (useSupabase) {
    const { data, error } = await supabase.from("announcements").select("*").order("date", { ascending: false }).limit(50);
    if (error) {
      console.error("[GET /api/announcements] Supabase error:", error);
      return res.status(500).json({ error: "Failed to load announcements" });
    }
    return res.json({ announcements: (data || []).map(toCamel) });
  }
  const db = req.userDb;
  res.json({ announcements: db?.announcements || [] });
});
var PRO_PLAN_AMOUNT_PAISE = 49900;
var PARTNER_PLATFORM_FLOOR_INR = 199;
var allowTestBilling = () => IS_DEV && process.env.ALLOW_TEST_BILLING === "true";
var RAZORPAY_API = "https://api.razorpay.com/v1";
var razorpayAuth = () => {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret, header: "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64") };
};
var razorpayFetch = async (path3, init = {}) => {
  const auth2 = razorpayAuth();
  if (!auth2) throw new Error("RAZORPAY_NOT_CONFIGURED");
  const res = await fetch(RAZORPAY_API + path3, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: auth2.header, ...init.headers || {} }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[razorpay] ${path3} failed:`, body);
    throw new Error(body?.error?.description || "Razorpay request failed");
  }
  return body;
};
var readProUntil = async (userId) => {
  try {
    if (useSupabase) {
      const { data } = await supabase.from("users").select("pro_until").eq("id", userId).maybeSingle();
      const raw2 = data?.pro_until;
      return raw2 ? new Date(raw2).getTime() : null;
    }
    const row = localFindUser((u) => u.id === userId);
    const raw = row?.proUntil ?? row?.pro_until ?? null;
    return raw ? new Date(raw).getTime() : null;
  } catch {
    return null;
  }
};
var claimPayment = async (opts) => {
  const { providerPaymentId, userId, userEmail, amountRupees, plan = "pro" } = opts;
  if (!providerPaymentId) return false;
  if (useSupabase) {
    const { error } = await supabase.from("payments").insert({
      id: `pay_${crypto2.randomUUID()}`,
      user_id: userId,
      provider: "razorpay",
      provider_payment_id: providerPaymentId,
      amount: amountRupees,
      currency: "INR",
      plan,
      status: "captured",
      paid_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (!error) return true;
    if (error?.code === "23505") {
      console.warn("[claimPayment] replay refused for", providerPaymentId);
      return false;
    }
    console.error("[claimPayment] insert failed:", error);
    return false;
  }
  const seen = localAllPayments().some(
    (row) => (row?.providerPaymentId || row?.provider_payment_id) === providerPaymentId
  );
  if (seen) {
    console.warn("[claimPayment] replay refused for", providerPaymentId);
    return false;
  }
  try {
    const fileDb = loadDatabaseFromFile();
    fileDb.payments = fileDb.payments || [];
    fileDb.payments.unshift({
      id: `pay_${crypto2.randomUUID()}`,
      userId,
      userEmail: userEmail || null,
      provider: "razorpay",
      providerPaymentId,
      amount: amountRupees,
      currency: "INR",
      plan,
      status: "captured",
      paidAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    fs.writeFileSync(DB_FILE, JSON.stringify(fileDb, null, 2), "utf-8");
  } catch (err) {
    console.error("[claimPayment] local write failed:", err);
  }
  return true;
};
var applyProState = async (userId, proUntil) => {
  const isPro = !!proUntil && proUntil.getTime() > Date.now();
  if (useSupabase) {
    await supabase.from("users").update({
      is_pro: isPro,
      pro_until: proUntil ? proUntil.toISOString() : null,
      plan: isPro ? "pro" : "free"
    }).eq("id", userId);
    userDatabases.delete(userId);
    return;
  }
  const patch = (row) => {
    row.isPro = isPro;
    row.proUntil = proUntil ? proUntil.toISOString() : null;
    row.plan = isPro ? "pro" : "free";
  };
  for (const cached of userDatabases.values()) {
    const row = (cached?.users || []).find((u) => u.id === userId);
    if (row) patch(row);
  }
  try {
    const shared = loadDatabaseFromFile();
    const row = (shared.users || []).find((u) => u.id === userId);
    if (row) {
      patch(row);
      fs.writeFileSync(DB_FILE, JSON.stringify(shared, null, 2), "utf-8");
    }
  } catch (err) {
    console.error("[applyProState] local write failed:", err);
  }
};
app.get("/api/payments/config", (req, res) => {
  const auth2 = razorpayAuth();
  const configured = !!auth2;
  res.json({
    configured,
    // Only true on a dev box with ALLOW_TEST_BILLING=true. The client uses it
    // to decide whether to show the test-tier switch at all.
    testBilling: allowTestBilling(),
    sandboxMode: !configured && allowTestBilling(),
    keyId: auth2?.keyId || "rzp_test_sandbox_mode",
    amount: PRO_PLAN_AMOUNT_PAISE,
    amountRupees: 499,
    currency: "INR",
    merchantName: "FX Journal Pro"
  });
});
app.post(["/api/payments/order", "/api/payments/create-order"], async (req, res) => {
  const currentUser = req.currentUser;
  if (!currentUser) return res.status(401).json({ error: "Not authenticated" });
  let orderAmountPaise = PRO_PLAN_AMOUNT_PAISE;
  let appliedOfferPrice = 499;
  const couponCode = String(req.body?.couponCode || "").trim();
  let partner = null;
  if (couponCode) {
    partner = await findPartnerByCode(couponCode);
    if (partner && partner.isActive !== false) {
      appliedOfferPrice = Math.min(499, Math.max(PARTNER_PLATFORM_FLOOR_INR, Number(partner.offerPrice) || 499));
      orderAmountPaise = appliedOfferPrice * 100;
      await linkReferral(req, currentUser.id, couponCode);
    }
  }
  const mentorCommission = partner ? Math.max(0, appliedOfferPrice - PARTNER_PLATFORM_FLOOR_INR) : 0;
  const auth2 = razorpayAuth();
  if (!auth2) {
    if (!allowTestBilling()) {
      console.error("[payments/order] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set.");
      return res.status(503).json({
        error: "Payments are not configured yet. Please try again shortly."
      });
    }
    return res.json({
      sandboxMode: true,
      keyId: "rzp_test_sandbox",
      orderId: `order_test_${currentUser.id.slice(-6)}_${crypto2.randomUUID()}`,
      amount: orderAmountPaise,
      amountRupees: appliedOfferPrice,
      originalPrice: 499,
      mentorCommission,
      discountApplied: !!partner && appliedOfferPrice < 499,
      couponCode: partner?.code || null,
      currency: "INR",
      message: partner ? `Mentor offer applied: \u20B9${appliedOfferPrice} (Regular \u20B9499)` : "Razorpay running in test/sandbox mode."
    });
  }
  try {
    const order = await razorpayFetch("/orders", {
      method: "POST",
      body: JSON.stringify({
        amount: orderAmountPaise,
        currency: "INR",
        receipt: `rcpt_${currentUser.id.slice(0, 8)}_${Date.now().toString(36)}`,
        notes: {
          userId: currentUser.id,
          email: currentUser.email || "",
          plan: "pro",
          periodDays: "30",
          couponCode: partner?.code || "",
          partnerId: partner?.userId || "",
          offerPrice: String(appliedOfferPrice),
          mentorCommission: String(mentorCommission)
        }
      })
    });
    res.json({
      orderId: order.id,
      amount: order.amount,
      amountRupees: appliedOfferPrice,
      originalPrice: 499,
      mentorCommission,
      discountApplied: !!partner && appliedOfferPrice < 499,
      couponCode: partner?.code || null,
      currency: order.currency,
      keyId: auth2.keyId
    });
  } catch (err) {
    console.error("[payments/order]", err?.message || err);
    res.status(502).json({ error: "Could not initiate Razorpay order. Please try again." });
  }
});
app.post("/api/payments/subscribe", async (req, res) => {
  const currentUser = req.currentUser;
  if (!currentUser) return res.status(401).json({ error: "Not authenticated" });
  const planId = process.env.RAZORPAY_PLAN_ID?.trim();
  const auth2 = razorpayAuth();
  if (!auth2 || !planId) {
    if (!allowTestBilling()) {
      console.error(auth2 ? "[payments/subscribe] RAZORPAY_PLAN_ID is not set \u2014 run `npm run razorpay:check`." : "[payments/subscribe] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set.");
      return res.status(503).json({
        error: "Payments are not configured yet. Please try again shortly."
      });
    }
    return res.json({
      sandboxMode: true,
      keyId: "rzp_test_sandbox",
      subscriptionId: `sub_test_${currentUser.id.slice(-6)}_${Date.now()}`,
      message: "Razorpay running in test/sandbox mode."
    });
  }
  try {
    if (useSupabase) {
      const { data: existing } = await supabase.from("subscriptions").select("*").eq("user_id", currentUser.id).in("status", ["created", "authenticated", "active", "pending"]).maybeSingle();
      if (existing?.provider_subscription_id && existing.status !== "active") {
        return res.json({ subscriptionId: existing.provider_subscription_id, keyId: auth2.keyId, reused: true });
      }
      if (existing?.status === "active") {
        return res.status(409).json({ error: "You already have an active Pro subscription." });
      }
    }
    const subscription = await razorpayFetch("/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        plan_id: planId,
        customer_notify: 1,
        total_count: 120,
        // ten years of monthly cycles; cancellation ends it
        notes: { userId: currentUser.id, email: currentUser.email }
      })
    });
    if (useSupabase) {
      await supabase.from("subscriptions").insert({
        id: `sub_${crypto2.randomUUID()}`,
        user_id: currentUser.id,
        provider: "razorpay",
        provider_subscription_id: subscription.id,
        plan: "pro",
        status: subscription.status || "created"
      });
    }
    res.json({ subscriptionId: subscription.id, keyId: auth2.keyId });
  } catch (err) {
    console.error("[payments/subscribe]", err?.message || err);
    res.status(502).json({ error: "Could not start the subscription. Please try again." });
  }
});
app.post("/api/payments/toggle-test-tier", async (req, res) => {
  const currentUser = req.currentUser;
  if (!currentUser) return res.status(401).json({ error: "Not authenticated" });
  if (!allowTestBilling()) return res.status(404).json({ error: "Not found" });
  const targetTier = req.body?.tier === "pro" ? "pro" : "free";
  const isPro = targetTier === "pro";
  const proUntil = isPro ? new Date(Date.now() + 30 * 864e5) : null;
  await applyProState(currentUser.id, proUntil);
  const db = req.userDb;
  if (db && Array.isArray(db.users)) {
    const u = db.users.find((x) => x.id === currentUser.id);
    if (u) {
      u.isPro = isPro;
      u.proUntil = proUntil ? proUntil.toISOString() : null;
      await saveDatabase(db);
    }
  }
  res.json({
    success: true,
    isPro,
    proUntil: proUntil ? proUntil.toISOString() : null,
    message: isPro ? "Activated Pro Mode! All features unlocked." : "Switched to Free Tier."
  });
});
app.post("/api/payments/webhook", async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error("[webhook] RAZORPAY_WEBHOOK_SECRET is not set \u2014 rejecting.");
    return res.status(503).end();
  }
  const signature = req.headers["x-razorpay-signature"];
  const raw = typeof req.rawBody === "string" ? req.rawBody : "";
  if (!raw) {
    console.error("[webhook] raw body unavailable \u2014 cannot verify signature.");
    return res.status(400).end();
  }
  const expected = crypto2.createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  if (!signature || !safeTokenEqual(expected, String(signature))) {
    console.warn("[webhook] signature mismatch \u2014 ignoring.");
    return res.status(400).end();
  }
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return res.status(400).end();
  }
  res.status(200).json({ received: true });
  try {
    const type = event.event;
    const sub = event.payload?.subscription?.entity;
    const payment = event.payload?.payment?.entity;
    const providerSubId = sub?.id || payment?.subscription_id;
    if (!providerSubId) {
      if (type !== "payment.captured" && type !== "order.paid") return;
      const payUserId = payment?.notes?.userId || event.payload?.order?.entity?.notes?.userId;
      const payId = payment?.id;
      if (!payUserId || !payId) {
        console.warn("[webhook] one-time payment with no userId in notes:", payId);
        return;
      }
      if (useSupabase) {
        const { data: seen } = await supabase.from("payments").select("id").eq("provider_payment_id", payId).maybeSingle();
        if (seen) {
          console.log("[webhook] payment already recorded, skipping:", payId);
          return;
        }
      } else {
        const local = loadDatabaseFromFile();
        if ((local.payments || []).some((x) => x.providerPaymentId === payId)) {
          console.log("[webhook] payment already recorded, skipping:", payId);
          return;
        }
      }
      const existingUntil = await readProUntil(payUserId);
      const base = existingUntil && existingUntil > Date.now() ? existingUntil : Date.now();
      const until = new Date(base + 30 * 864e5);
      await applyProState(payUserId, until);
      if (useSupabase) {
        await supabase.from("payments").upsert({
          id: `pay_${crypto2.randomUUID()}`,
          user_id: payUserId,
          provider: "razorpay",
          provider_payment_id: payId,
          amount: (payment.amount || PRO_PLAN_AMOUNT_PAISE) / 100,
          currency: payment.currency || "INR",
          plan: "pro",
          status: payment.status || "captured",
          paid_at: (/* @__PURE__ */ new Date()).toISOString()
        }, { onConflict: "provider_payment_id" });
      }
      console.log(`[webhook] ${type} \u2014 Pro until ${until.toISOString()} for ${payUserId} (order path)`);
      return;
    }
    if (!useSupabase) return;
    const { data: row } = await supabase.from("subscriptions").select("*").eq("provider_subscription_id", providerSubId).maybeSingle();
    if (!row) {
      console.warn("[webhook] no local subscription for", providerSubId);
      return;
    }
    const periodEnd = sub?.current_end ? new Date(sub.current_end * 1e3) : null;
    switch (type) {
      case "subscription.activated":
      case "subscription.charged": {
        const until = periodEnd || new Date(Date.now() + 31 * 24 * 60 * 60 * 1e3);
        await supabase.from("subscriptions").update({
          status: "active",
          current_period_end: until.toISOString(),
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        }).eq("id", row.id);
        await applyProState(row.user_id, until);
        if (payment?.id) {
          await supabase.from("payments").upsert({
            id: `pay_${crypto2.randomUUID()}`,
            user_id: row.user_id,
            subscription_id: row.id,
            provider: "razorpay",
            provider_payment_id: payment.id,
            amount: (payment.amount || PRO_PLAN_AMOUNT_PAISE) / 100,
            currency: payment.currency || "INR",
            plan: "pro",
            status: payment.status || "captured",
            paid_at: (/* @__PURE__ */ new Date()).toISOString()
          }, { onConflict: "provider_payment_id" });
        }
        console.log(`[webhook] ${type} \u2014 Pro until ${until.toISOString()} for ${row.user_id}`);
        break;
      }
      case "subscription.cancelled":
      case "subscription.completed":
      case "subscription.expired": {
        await supabase.from("subscriptions").update({
          status: type.split(".")[1],
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        }).eq("id", row.id);
        const until = row.current_period_end ? new Date(row.current_period_end) : null;
        await applyProState(row.user_id, until);
        break;
      }
      case "subscription.halted":
      case "subscription.pending": {
        await supabase.from("subscriptions").update({
          status: type.split(".")[1],
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        }).eq("id", row.id);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error("[webhook] handler error:", err?.message || err);
  }
});
app.post("/api/payments/verify", async (req, res) => {
  const currentUser = req.currentUser;
  if (!currentUser) return res.status(401).json({ error: "Not authenticated" });
  if (req.body?.isSandbox) {
    if (!allowTestBilling()) {
      return res.status(400).json({ error: "Payment verification failed." });
    }
    const proUntil2 = new Date(Date.now() + 30 * 864e5);
    await applyProState(currentUser.id, proUntil2);
    const db2 = req.userDb;
    const u = db2?.users?.find((x) => x.id === currentUser.id);
    if (u) {
      u.isPro = true;
      u.proUntil = proUntil2.toISOString();
      await saveDatabase(db2);
    }
    return res.json({
      success: true,
      active: true,
      message: "Sandbox Upgrade Complete! Welcome to Pro."
    });
  }
  const {
    razorpay_order_id,
    razorpay_subscription_id,
    razorpay_payment_id,
    razorpay_signature
  } = req.body || {};
  const auth2 = razorpayAuth();
  if (!auth2) return res.status(503).json({ error: "Payments are not configured yet." });
  if (!razorpay_payment_id || !razorpay_signature || !razorpay_order_id && !razorpay_subscription_id) {
    return res.status(400).json({ error: "Incomplete payment confirmation." });
  }
  if (razorpay_order_id) {
    const expected2 = crypto2.createHmac("sha256", auth2.keySecret).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");
    if (!safeTokenEqual(expected2, String(razorpay_signature))) {
      console.warn(`[payments/verify] order signature mismatch for user ${currentUser.id}`);
      return res.status(400).json({ error: "Payment verification failed." });
    }
    const claimed = await claimPayment({
      providerPaymentId: String(razorpay_payment_id),
      userId: currentUser.id,
      userEmail: currentUser.email,
      amountRupees: PRO_PLAN_AMOUNT_PAISE / 100
    });
    if (!claimed) {
      return res.json({
        success: true,
        active: !!currentUser.isPro,
        proUntil: currentUser.proUntil || null,
        alreadyApplied: true,
        message: "This payment was already applied to your account."
      });
    }
    const currentProUntil = currentUser.proUntil ? new Date(currentUser.proUntil).getTime() : 0;
    const baseTime = currentProUntil > Date.now() ? currentProUntil : Date.now();
    const proUntil2 = new Date(baseTime + 30 * 864e5);
    await applyProState(currentUser.id, proUntil2);
    const db2 = req.userDb;
    if (db2 && Array.isArray(db2.users)) {
      const u = db2.users.find((x) => x.id === currentUser.id);
      if (u) {
        u.isPro = true;
        u.proUntil = proUntil2.toISOString();
        await saveDatabase(db2);
      }
    }
    return res.json({
      success: true,
      active: true,
      proUntil: proUntil2.toISOString(),
      message: "Payment verified successfully! Welcome to Pro (30 days access)."
    });
  }
  const expected = crypto2.createHmac("sha256", auth2.keySecret).update(`${razorpay_payment_id}|${razorpay_subscription_id}`).digest("hex");
  if (!safeTokenEqual(expected, String(razorpay_signature))) {
    console.warn(`[payments/verify] signature mismatch for user ${currentUser.id}`);
    return res.status(400).json({ error: "Payment verification failed." });
  }
  const subClaimed = await claimPayment({
    providerPaymentId: String(razorpay_payment_id),
    userId: currentUser.id,
    userEmail: currentUser.email,
    amountRupees: PRO_PLAN_AMOUNT_PAISE / 100
  });
  if (!subClaimed) {
    return res.json({
      success: true,
      active: !!currentUser.isPro,
      proUntil: currentUser.proUntil || null,
      alreadyApplied: true,
      message: "This payment was already applied to your account."
    });
  }
  const proUntil = new Date(Date.now() + 31 * 864e5);
  await applyProState(currentUser.id, proUntil);
  let active = true;
  if (useSupabase) {
    await supabase.from("subscriptions").update({
      status: "active",
      current_period_end: proUntil.toISOString(),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("provider_subscription_id", razorpay_subscription_id);
  }
  const db = req.userDb;
  if (db && Array.isArray(db.users)) {
    const u = db.users.find((x) => x.id === currentUser.id);
    if (u) {
      u.isPro = true;
      u.proUntil = proUntil.toISOString();
      await saveDatabase(db);
    }
  }
  res.json({
    success: true,
    active,
    proUntil: proUntil.toISOString(),
    message: "Payment received. Welcome to Pro!"
  });
});
app.post("/api/payments/cancel", async (req, res) => {
  const currentUser = req.currentUser;
  if (!currentUser) return res.status(401).json({ error: "Not authenticated" });
  if (!useSupabase) return res.status(503).json({ error: "Billing requires the database." });
  const { data: row } = await supabase.from("subscriptions").select("*").eq("user_id", currentUser.id).in("status", ["active", "authenticated", "pending", "halted"]).maybeSingle();
  if (!row?.provider_subscription_id) {
    return res.status(404).json({ error: "No active subscription to cancel." });
  }
  try {
    await razorpayFetch(`/subscriptions/${row.provider_subscription_id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ cancel_at_cycle_end: 1 })
    });
    await supabase.from("subscriptions").update({
      cancel_at_period_end: true,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("id", row.id);
    res.json({
      message: row.current_period_end ? `Cancelled. Pro stays active until ${new Date(row.current_period_end).toLocaleDateString()}.` : "Cancelled. Pro stays active until the end of your paid period."
    });
  } catch (err) {
    console.error("[payments/cancel]", err?.message || err);
    res.status(502).json({ error: "Could not cancel the subscription. Please contact support." });
  }
});
app.get("/api/payments/subscription", async (req, res) => {
  const currentUser = req.currentUser;
  if (!currentUser) return res.status(401).json({ error: "Not authenticated" });
  if (!useSupabase) return res.json({ subscription: null, payments: [] });
  const [{ data: sub }, { data: payments }] = await Promise.all([
    supabase.from("subscriptions").select("*").eq("user_id", currentUser.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("payments").select("*").eq("user_id", currentUser.id).order("paid_at", { ascending: false }).limit(24)
  ]);
  res.json({
    subscription: sub ? toCamel(sub) : null,
    payments: (payments || []).map(toCamel)
  });
});
var ROLE_PERMISSIONS = {
  SUPER_ADMIN: [
    "users.read",
    "users.manage",
    "users.roles",
    "tickets.read",
    "tickets.manage",
    "announcements.manage",
    "billing.read",
    "audit.read",
    "dashboard.read",
    "assigned.read",
    "subadmin.assign",
    "partner.manage",
    "partner.self"
  ],
  // Day-to-day operator: can run the product, cannot grant roles or read billing.
  ADMIN: [
    "users.read",
    "users.manage",
    "tickets.read",
    "tickets.manage",
    "announcements.manage",
    "dashboard.read",
    "partner.self"
  ],
  // Sub-admin: read-only, and only over the users a super admin assigned to
  // them. 'users.read' here does NOT mean every user — every route that
  // returns user data narrows the result with scopeUserIds() below.
  // No 'announcements.manage': an announcement is a global broadcast, which
  // is not a scoped power.
  SUB_ADMIN: [
    "users.read",
    "assigned.read",
    "tickets.read",
    "tickets.manage",
    "dashboard.read",
    "partner.self"
  ],
  // Partner: a normal trader who also runs a referral network. Same read-only
  // console as a sub-admin, but scoped by who signed up with their referral
  // code rather than by a hand-written assignment list, and with no ticket
  // desk — a partner is not staff and must not read other people's support
  // conversations. 'users.read' is scoped by scopeUserIds() like SUB_ADMIN's.
  PARTNER: [
    "users.read",
    "assigned.read",
    "partner.self"
  ],
  // Support desk only: answers tickets, can look up a user to help them
  SUPPORT: ["users.read", "tickets.read", "tickets.manage", "dashboard.read"],
  USER: []
};
var SCOPED_ROLES = /* @__PURE__ */ new Set(["SUB_ADMIN", "PARTNER"]);
var ADMIN_ROLES = /* @__PURE__ */ new Set(["SUPER_ADMIN", "ADMIN", "SUB_ADMIN", "PARTNER", "SUPPORT"]);
var getAdminRole = async (currentUser) => {
  if (!currentUser) return "USER";
  const email = (currentUser.email || "").toLowerCase().trim();
  if (isSuperAdminEmail(email)) return "SUPER_ADMIN";
  let role = currentUser.role;
  if (useSupabase && (currentUser.id || currentUser.email)) {
    const query = currentUser.id ? supabase.from("users").select("role").eq("id", currentUser.id).maybeSingle() : supabase.from("users").select("role").eq("email", currentUser.email).maybeSingle();
    const { data } = await query;
    if (data?.role) role = data.role;
  }
  return ADMIN_ROLES.has(role) ? role : "USER";
};
var roleHas = (role, permission) => (ROLE_PERMISSIONS[role] || []).includes(permission);
var checkIsAdmin = async (currentUser) => ADMIN_ROLES.has(await getAdminRole(currentUser));
var requirePermission = async (req, res, permission) => {
  const user = req.currentUser;
  const role = await getAdminRole(user);
  if (!roleHas(role, permission)) {
    res.status(403).json({ error: "You do not have permission to do that.", required: permission });
    return null;
  }
  return { role, user };
};
var inMemoryAuditLogs = [];
var writeAuditLog = async (req, actor, action, targetType, targetId, detail = {}) => {
  const entry = {
    id: `audit_${crypto2.randomUUID()}`,
    actor_id: actor.user?.id || null,
    actor_email: actor.user?.email || null,
    actor_role: actor.role,
    action,
    target_type: targetType || null,
    target_id: targetId || null,
    detail,
    ip: (req.headers["x-forwarded-for"]?.toString().split(",")[0] || req.ip || "").slice(0, 64),
    created_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (useSupabase) {
    const { error } = await supabase.from("admin_audit_logs").insert(entry);
    if (error) console.error("[audit] write failed:", error.message, action);
  } else {
    inMemoryAuditLogs.unshift(toCamel(entry));
    console.log("[audit]", JSON.stringify(entry));
  }
};
var readAssignments = () => {
  try {
    return loadDatabaseFromFile().subAdminAssignments || [];
  } catch {
    return [];
  }
};
var writeAssignments = (rows) => {
  const shared = loadDatabaseFromFile();
  shared.subAdminAssignments = rows;
  fs.writeFileSync(DB_FILE, JSON.stringify(shared, null, 2), "utf-8");
};
var scopeUserIds = async (role, adminUserId) => {
  if (!SCOPED_ROLES.has(role)) return null;
  if (!adminUserId) return [];
  if (role === "PARTNER") {
    if (!useSupabase) {
      return localAllUsers().filter((u) => u.referredBy === adminUserId).map((u) => u.id);
    }
    const { data: data2, error: error2 } = await supabase.from("users").select("id").eq("referred_by", adminUserId);
    if (error2) {
      console.error("[scopeUserIds] referral lookup failed:", error2.message);
      return [];
    }
    return (data2 || []).map((r) => r.id);
  }
  if (!useSupabase) {
    return readAssignments().filter((a) => a.subAdminId === adminUserId).map((a) => a.userId);
  }
  const { data, error } = await supabase.from("sub_admin_assignments").select("user_id").eq("sub_admin_id", adminUserId);
  if (error) {
    console.error("[scopeUserIds] assignment lookup failed:", error.message);
    return [];
  }
  return (data || []).map((r) => r.user_id);
};
var canSeeUser = (scope, userId) => scope === null || scope.includes(userId);
var tradeVisibleUserIds = async (role, adminUserId) => {
  if (role !== "PARTNER") return null;
  const scope = await scopeUserIds(role, adminUserId);
  const ids = scope || [];
  if (ids.length === 0) return [];
  if (!useSupabase) {
    return localAllUsers().filter((u) => ids.includes(u.id) && (u.id === "user_demo_pro" || u.id.startsWith("user_demo_") || u.allowPartnerTradeView === true)).map((u) => u.id);
  }
  const { data, error } = await supabase.from("users").select("id, allow_partner_trade_view").in("id", ids);
  if (error) {
    console.error("[tradeVisibleUserIds] consent lookup failed:", error.message);
    return [];
  }
  return (data || []).filter((r) => r.id === "user_demo_pro" || r.id.startsWith("user_demo_") || r.allow_partner_trade_view === true).map((r) => r.id);
};
var canSeeTrades = (visible, userId) => visible === null || visible.includes(userId);
var mentorAccessByUser = async (role, adminUserId) => {
  if (role !== "PARTNER") return null;
  const scope = await scopeUserIds(role, adminUserId);
  const ids = scope || [];
  const out = /* @__PURE__ */ new Map();
  if (ids.length === 0) return out;
  if (!useSupabase) {
    for (const u of localAllUsers()) {
      if (!ids.includes(u.id)) continue;
      const demo = u.id === "user_demo_pro" || String(u.id).startsWith("user_demo_");
      out.set(u.id, demo ? normaliseMentorAccess({ notebook: true }, true) : normaliseMentorAccess(u.mentorAccess, u.allowPartnerTradeView === true));
    }
    return out;
  }
  const { data, error } = await supabase.from("users").select("id, mentor_access, allow_partner_trade_view").in("id", ids);
  if (error) {
    console.error("[mentorAccessByUser] lookup failed:", error.message);
    return out;
  }
  for (const r of data || []) {
    const demo = r.id === "user_demo_pro" || String(r.id).startsWith("user_demo_");
    out.set(r.id, demo ? normaliseMentorAccess({ notebook: true }, true) : normaliseMentorAccess(r.mentor_access, r.allow_partner_trade_view === true));
  }
  return out;
};
var accessOf = (byUser, userId) => byUser === null ? normaliseMentorAccess(null, true) : byUser.get(userId) || normaliseMentorAccess(null, false);
var MENTOR_ACCESS_BOOLEAN_SECTIONS = [
  "dashboard",
  "analysis",
  "calendar",
  "liveCharts",
  "journal",
  "notebook"
];
var normaliseMentorAccess = (raw, _legacyAllow) => {
  const base = {
    dashboard: true,
    analysis: true,
    accounts: null,
    calendar: true,
    liveCharts: true,
    journal: true,
    notebook: false
  };
  if (!raw || typeof raw !== "object") return base;
  const out = { ...base };
  for (const key of MENTOR_ACCESS_BOOLEAN_SECTIONS) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  if (typeof raw.live_charts === "boolean" && typeof raw.liveCharts !== "boolean") {
    out.liveCharts = raw.live_charts;
  }
  if (raw.accounts === null) out.accounts = null;
  else if (Array.isArray(raw.accounts)) {
    out.accounts = raw.accounts.filter((x) => typeof x === "string");
  }
  return out;
};
var mentorCanSee = (access, section) => {
  if (section === "accounts") return access.accounts === null || access.accounts.length > 0;
  return access[section] === true;
};
var readMentorAccess = async (userId) => {
  if (userId === "user_demo_pro" || userId.startsWith("user_demo_")) {
    return normaliseMentorAccess({ notebook: true }, true);
  }
  if (!useSupabase) {
    const row = localFindUser((u) => u.id === userId);
    return normaliseMentorAccess(row?.mentorAccess, row?.allowPartnerTradeView === true);
  }
  const { data } = await supabase.from("users").select("mentor_access, allow_partner_trade_view").eq("id", userId).maybeSingle();
  return normaliseMentorAccess(data?.mentor_access, data?.allow_partner_trade_view === true);
};
var readTradeConsent = async (userId) => {
  if (userId === "user_demo_pro" || userId.startsWith("user_demo_")) return true;
  if (!useSupabase) return localFindUser((u) => u.id === userId)?.allowPartnerTradeView === true;
  const { data } = await supabase.from("users").select("allow_partner_trade_view").eq("id", userId).maybeSingle();
  return data?.allow_partner_trade_view === true;
};
app.use("/api/admin", async (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const role = await getAdminRole(req.currentUser);
  if (SCOPED_ROLES.has(role) || role === "SUPPORT") {
    return res.status(403).json({ error: "Your account has read-only access.", role });
  }
  next();
});
app.get("/api/admin/assignments", async (req, res) => {
  const ctx = await requirePermission(req, res, "subadmin.assign");
  if (!ctx) return;
  const subAdminId = String(req.query.subAdminId || "").trim();
  if (!subAdminId) return res.status(400).json({ error: "subAdminId is required" });
  if (!useSupabase) {
    const ids2 = readAssignments().filter((a) => a.subAdminId === subAdminId).map((a) => a.userId);
    const assigned = localAllUsers().filter((u) => ids2.includes(u.id)).map((u) => sanitizeUser(u));
    return res.json({ subAdminId, assigned });
  }
  const { data: rows, error } = await supabase.from("sub_admin_assignments").select("user_id, created_at").eq("sub_admin_id", subAdminId);
  if (error) {
    console.error("[GET /api/admin/assignments] error:", error);
    return res.status(500).json({ error: "Failed to load assignments" });
  }
  const ids = (rows || []).map((r) => r.user_id);
  if (ids.length === 0) return res.json({ subAdminId, assigned: [] });
  const { data: users } = await supabase.from("users").select("id, email, name, is_pro, status, created_at, last_login, referred_by, referred_at, allow_partner_trade_view").in("id", ids);
  res.json({ subAdminId, assigned: (users || []).map((u) => sanitizeUser(toCamel(u))) });
});
app.post("/api/admin/assignments", async (req, res) => {
  const ctx = await requirePermission(req, res, "subadmin.assign");
  if (!ctx) return;
  const { subAdminId, userEmail } = req.body || {};
  const email = String(userEmail || "").toLowerCase().trim();
  if (!subAdminId || !email) return res.status(400).json({ error: "subAdminId and userEmail are required" });
  if (!useSupabase) {
    const everyone = localAllUsers();
    const subAdmin2 = everyone.find((u) => u.id === subAdminId);
    if (!subAdmin2) return res.status(404).json({ error: "Sub-admin not found." });
    if (subAdmin2.role !== "SUB_ADMIN") return res.status(400).json({ error: "That account is not a sub-admin." });
    const target2 = everyone.find((u) => u.email?.toLowerCase() === email);
    if (!target2) return res.status(404).json({ error: "No account with that email." });
    if (target2.id === subAdminId) return res.status(400).json({ error: "A sub-admin cannot be assigned to themselves." });
    const rows = readAssignments();
    if (rows.some((a) => a.subAdminId === subAdminId && a.userId === target2.id)) {
      return res.status(409).json({ error: "That user is already assigned." });
    }
    rows.push({
      subAdminId,
      userId: target2.id,
      assignedBy: ctx.user?.id || "",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    writeAssignments(rows);
    await writeAuditLog(req, ctx, "subadmin.assign", "user", target2.id, { subAdminId, email });
    return res.json({ message: `${email} assigned.` });
  }
  const { data: subAdmin } = await supabase.from("users").select("id, role, email").eq("id", subAdminId).maybeSingle();
  if (!subAdmin) return res.status(404).json({ error: "Sub-admin not found." });
  if (subAdmin.role !== "SUB_ADMIN") return res.status(400).json({ error: "That account is not a sub-admin." });
  const { data: target } = await supabase.from("users").select("id, email").eq("email", email).maybeSingle();
  if (!target) return res.status(404).json({ error: "No account with that email." });
  if (target.id === subAdminId) return res.status(400).json({ error: "A sub-admin cannot be assigned to themselves." });
  const { error } = await supabase.from("sub_admin_assignments").insert({
    id: `saa_${crypto2.randomUUID()}`,
    sub_admin_id: subAdminId,
    user_id: target.id,
    assigned_by: ctx.user?.id || null,
    created_at: (/* @__PURE__ */ new Date()).toISOString()
  });
  if (error) {
    if (error.code === "23505") return res.status(409).json({ error: "That user is already assigned." });
    console.error("[POST /api/admin/assignments] error:", error);
    return res.status(500).json({ error: "Failed to assign user" });
  }
  await writeAuditLog(req, ctx, "subadmin.assign", "user", target.id, { subAdminId, email });
  res.json({ message: `${email} assigned.` });
});
app.delete("/api/admin/assignments", async (req, res) => {
  const ctx = await requirePermission(req, res, "subadmin.assign");
  if (!ctx) return;
  const { subAdminId, userId } = req.body || {};
  if (!subAdminId || !userId) return res.status(400).json({ error: "subAdminId and userId are required" });
  if (!useSupabase) {
    const rows = readAssignments();
    const i = rows.findIndex((a) => a.subAdminId === subAdminId && a.userId === userId);
    if (i >= 0) {
      rows.splice(i, 1);
      writeAssignments(rows);
    }
  } else {
    const { error } = await supabase.from("sub_admin_assignments").delete().eq("sub_admin_id", subAdminId).eq("user_id", userId);
    if (error) {
      console.error("[DELETE /api/admin/assignments] error:", error);
      return res.status(500).json({ error: "Failed to remove assignment" });
    }
  }
  await writeAuditLog(req, ctx, "subadmin.unassign", "user", userId, { subAdminId });
  res.json({ message: "Assignment removed." });
});
var dayKey = (value) => {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};
var buildActivitySeries = (dates, days) => {
  const counts = {};
  for (const d of dates) {
    const key = dayKey(d);
    if (key) counts[key] = (counts[key] || 0) + 1;
  }
  const series = [];
  const today = /* @__PURE__ */ new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 864e5).toISOString().slice(0, 10);
    series.push({ date: d, count: counts[d] || 0 });
  }
  return series;
};
var netProfit = (t) => (Number(t.profit) || 0) + (Number(t.commission) || 0) + (Number(t.swap) || 0);
var summariseTrades = (trades) => {
  const closed = trades.filter((t) => t.exitPrice != null || t.profit != null);
  const pnls = closed.map(netProfit);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const rMultiples = closed.map((t) => {
    const entry = Number(t.entryPrice);
    const stop = Number(t.stopLoss);
    const exit = Number(t.exitPrice);
    if (!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(exit)) return null;
    const risk = Math.abs(entry - stop);
    if (risk <= 0) return null;
    const dir = String(t.type).toLowerCase().startsWith("s") ? -1 : 1;
    return (exit - entry) * dir / risk;
  }).filter((r) => r !== null);
  const byDate = [...closed].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  let runWins = 0;
  let runLosses = 0;
  for (const t of byDate) {
    const pnl = netProfit(t);
    if (pnl > 0) {
      runWins += 1;
      runLosses = 0;
      if (runWins > maxConsecutiveWins) maxConsecutiveWins = runWins;
    } else if (pnl < 0) {
      runLosses += 1;
      runWins = 0;
      if (runLosses > maxConsecutiveLosses) maxConsecutiveLosses = runLosses;
    }
  }
  const winTrades = closed.filter((t) => netProfit(t) > 0);
  const lossTrades = closed.filter((t) => netProfit(t) < 0);
  const sumLots = (rows) => rows.reduce((a, t) => a + (Number(t.lotSize) || 0), 0);
  const sumCommission = (rows) => rows.reduce((a, t) => a + Math.abs(Number(t.commission) || 0) + Math.abs(Number(t.swap) || 0), 0);
  const activeDays = (rows) => new Set(rows.map((t) => dayKey(t.date)).filter((d) => !!d)).size;
  const curve = (rows) => {
    const byDay = /* @__PURE__ */ new Map();
    for (const t of rows) {
      const key = dayKey(t.date);
      if (!key) continue;
      byDay.set(key, (byDay.get(key) || 0) + netProfit(t));
    }
    let running = 0;
    return [...byDay.keys()].sort().map((day) => {
      running += byDay.get(day) || 0;
      return { date: day, cumulative: Math.round(running * 100) / 100 };
    });
  };
  const sideSummary = (rows) => {
    const total = rows.reduce((a, t) => a + netProfit(t), 0);
    const days = activeDays(rows);
    const lots = sumLots(rows);
    return {
      totalPnl: Math.round(total * 100) / 100,
      trades: rows.length,
      activeDays: days,
      avgTrade: rows.length ? Math.round(total / rows.length * 100) / 100 : 0,
      totalVolume: Math.round(lots * 100) / 100,
      avgDailyVolume: days ? Math.round(lots / days * 100) / 100 : 0,
      totalCommissions: Math.round(sumCommission(rows) * 100) / 100,
      curve: curve(rows)
    };
  };
  return {
    totalTrades: trades.length,
    closedTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? wins.length / closed.length * 100 : 0,
    netPnl: pnls.reduce((a, b) => a + b, 0),
    grossWin,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    avgR: rMultiples.length ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : null,
    bestTrade: pnls.length ? Math.max(...pnls) : 0,
    worstTrade: pnls.length ? Math.min(...pnls) : 0,
    // Everything the Win and Loss Performance panels need, per side.
    winPerformance: { ...sideSummary(winTrades), maxConsecutive: maxConsecutiveWins },
    lossPerformance: { ...sideSummary(lossTrades), maxConsecutive: maxConsecutiveLosses }
  };
};
app.get("/api/subadmin/overview", async (req, res) => {
  const ctx = await requirePermission(req, res, "assigned.read");
  if (!ctx) return;
  let targetSubAdminId = ctx.user?.id || null;
  let scopeRole = req.query.type === "partner" ? "PARTNER" : ctx.role;
  if (!SCOPED_ROLES.has(ctx.role) && req.query.subAdminId) {
    targetSubAdminId = String(req.query.subAdminId);
    scopeRole = await lookupUserRole(targetSubAdminId) || (req.query.type === "partner" ? "PARTNER" : "SUB_ADMIN");
  } else if (!SCOPED_ROLES.has(ctx.role)) {
    scopeRole = req.query.type === "partner" ? "PARTNER" : "SUB_ADMIN";
  }
  const scope = await scopeUserIds(scopeRole, targetSubAdminId);
  const ids = scope || [];
  const visible = await tradeVisibleUserIds(scopeRole, targetSubAdminId);
  const accessByUser = await mentorAccessByUser(scopeRole, targetSubAdminId);
  const todayKey = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  let users = [];
  let trades = [];
  let assignedAt = {};
  const userAccountMap = /* @__PURE__ */ new Map();
  if (ids.length > 0) {
    if (useSupabase) {
      const [{ data: u }, { data: accs }, { data: t }, { data: a }] = await Promise.all([
        supabase.from("users").select("id, email, name, is_pro, status, created_at, last_login, referred_by, referred_at, allow_partner_trade_view").in("id", ids),
        supabase.from("trading_accounts").select("id, user_id").in("user_id", ids),
        supabase.from("trades").select("id, user_id, account_id, date, profit, commission, swap"),
        supabase.from("sub_admin_assignments").select("user_id, created_at").eq("sub_admin_id", targetSubAdminId)
      ]);
      users = (u || []).map(toCamel);
      trades = (t || []).map(toCamel);
      for (const acc of accs || []) {
        if (!userAccountMap.has(acc.user_id)) userAccountMap.set(acc.user_id, /* @__PURE__ */ new Set());
        userAccountMap.get(acc.user_id).add(acc.id);
      }
      for (const row of a || []) assignedAt[row.user_id] = row.created_at;
    } else {
      const db = loadDatabaseFromFile();
      users = localAllUsers().filter((x) => ids.includes(x.id));
      trades = (db?.trades || []).map(toCamel);
      for (const acc of db?.accounts || []) {
        if (!userAccountMap.has(acc.userId)) userAccountMap.set(acc.userId, /* @__PURE__ */ new Set());
        userAccountMap.get(acc.userId).add(acc.id);
      }
      for (const row of readAssignments().filter((x) => x.subAdminId === targetSubAdminId)) {
        assignedAt[row.userId] = row.createdAt;
      }
    }
  }
  const cards = users.map((u) => {
    const accIds = userAccountMap.get(u.id) || /* @__PURE__ */ new Set();
    const own = trades.filter((t) => t.userId === u.id || t.accountId && accIds.has(t.accountId));
    const access = accessOf(accessByUser, u.id);
    const shown = access.accounts === null ? own : own.filter((t) => t.accountId && access.accounts.includes(t.accountId));
    const tradesVisible = canSeeTrades(visible, u.id) && access.dashboard;
    const sharesAnything = MENTOR_ACCESS_BOOLEAN_SECTIONS.some((k) => access[k] === true) || mentorCanSee(access, "accounts");
    return {
      id: u.id,
      name: u.name || (u.email || "").split("@")[0],
      email: u.email,
      isPro: !!(u.isPro ?? u.is_pro),
      status: u.status || "ACTIVE",
      joinedAt: u.createdAt || u.created_at || null,
      lastLogin: u.lastLogin || u.last_login || null,
      tradeAccess: sharesAnything,
      access,
      tradesToday: tradesVisible ? shown.filter((t) => dayKey(t.date) === todayKey).length : null,
      tradesTotal: tradesVisible ? shown.length : null,
      netPnl: tradesVisible ? shown.reduce((sum, t) => sum + netProfit(t), 0) : null,
      activity: tradesVisible ? buildActivitySeries(shown.map((t) => t.date), 30) : []
    };
  }).sort((a, b) => (b.lastLogin || "").localeCompare(a.lastLogin || ""));
  const growthCounts = {};
  for (const id of ids) {
    const u = users.find((x) => x.id === id);
    const key = scopeRole === "PARTNER" ? dayKey(u?.referredAt) || dayKey(u?.createdAt) : dayKey(assignedAt[id]) || dayKey(u?.createdAt);
    if (key) growthCounts[key] = (growthCounts[key] || 0) + 1;
  }
  let running = 0;
  const growth = Object.keys(growthCounts).sort().map((date) => {
    running += growthCounts[date];
    return { date, count: running };
  });
  res.json({
    subAdminId: targetSubAdminId,
    stats: {
      totalUsers: cards.length,
      proUsers: cards.filter((c) => c.isPro).length,
      freeUsers: cards.filter((c) => !c.isPro).length,
      activeToday: cards.filter((c) => dayKey(c.lastLogin) === todayKey).length,
      tradesToday: cards.reduce((s, c) => s + (c.tradesToday || 0), 0),
      sharingTrades: cards.filter((c) => c.tradeAccess).length
    },
    growth,
    users: cards
  });
});
app.get("/api/subadmin/user/:id", async (req, res) => {
  const ctx = await requirePermission(req, res, "assigned.read");
  if (!ctx) return;
  const { id } = req.params;
  const scope = await scopeUserIds(ctx.role, ctx.user?.id || null);
  if (!canSeeUser(scope, id)) return res.status(404).json({ error: "User not found" });
  const access = ctx.role === "PARTNER" ? await readMentorAccess(id) : normaliseMentorAccess(null, true);
  const sharesAnything = ctx.role !== "PARTNER" || MENTOR_ACCESS_BOOLEAN_SECTIONS.some((k) => access[k] === true) || mentorCanSee(access, "accounts");
  if (!sharesAnything) {
    return res.status(403).json({
      error: "This user has not shared their trading data with you.",
      code: "TRADE_ACCESS_DENIED",
      tradeAccess: false,
      access
    });
  }
  let user = null;
  let accounts = [];
  let trades = [];
  if (useSupabase) {
    const [{ data: u }, { data: a }, { data: t }] = await Promise.all([
      supabase.from("users").select("id, email, name, is_pro, status, created_at, last_login, referred_by, referred_at, allow_partner_trade_view").eq("id", id).maybeSingle(),
      supabase.from("trading_accounts").select("*").eq("user_id", id),
      supabase.from("trades").select("*").eq("user_id", id).order("date", { ascending: false })
    ]);
    user = u ? toCamel(u) : null;
    accounts = (a || []).map(toCamel);
    let finalTrades = (t || []).map(toCamel);
    if (accounts && accounts.length > 0) {
      const accIds = accounts.map((acc) => acc.id);
      const { data: accTrades } = await supabase.from("trades").select("*").in("account_id", accIds).order("date", { ascending: false });
      if (accTrades && accTrades.length > 0) {
        const existingIds = new Set(finalTrades.map((trade) => trade.id));
        for (const trade of accTrades) {
          if (!existingIds.has(trade.id)) {
            finalTrades.push(toCamel(trade));
          }
        }
      }
    }
    trades = finalTrades.sort((x, y) => String(y.date || "").localeCompare(String(x.date || "")));
  } else {
    const db = loadDatabaseFromFile();
    user = localFindUser((x) => x.id === id);
    accounts = (db?.accounts || []).filter((x) => x.userId === id);
    const accIds = new Set(accounts.map((x) => x.id));
    trades = (db?.trades || []).filter((x) => x.userId === id || accIds.has(x.accountId)).sort((x, y) => String(y.date).localeCompare(String(x.date)));
  }
  if (!user) return res.status(404).json({ error: "User not found" });
  const permittedAccounts = access.accounts === null ? accounts : accounts.filter((a) => access.accounts.includes(a.id));
  const permittedIds = new Set(permittedAccounts.map((a) => a.id));
  const permittedTrades = access.accounts === null ? trades : trades.filter((t) => permittedIds.has(t.accountId));
  res.json({
    readOnly: true,
    user: sanitizeUser(user),
    // What the viewer is allowed to see, so the console can render the same
    // shape without guessing why a section came back empty.
    access,
    accounts: permittedAccounts,
    // Trades underpin the dashboard, the calendar and the chart markers, so
    // they travel when any of those is shared.
    trades: access.dashboard || access.calendar || access.liveCharts ? permittedTrades : [],
    analysis: access.analysis ? summariseTrades(permittedTrades) : null,
    activity: access.dashboard ? buildActivitySeries(permittedTrades.map((t) => t.date), 365) : [],
    calendar: access.calendar ? permittedTrades.map((t) => ({ date: t.date, profit: netProfit(t) })) : [],
    // Built from the permitted trades, not all of them — a journal entry
    // carries the same symbol, direction and profit as its trade, so deriving
    // it before the account filter would hand back a hidden account's history
    // in a different shape.
    journal: access.journal ? permittedTrades.filter((t) => t.notes && String(t.notes).trim() || t.emotion || t.strategy).map((t) => ({
      id: t.id,
      date: t.date,
      symbol: t.symbol,
      type: t.type,
      profit: netProfit(t),
      notes: t.notes || "",
      emotion: t.emotion || null,
      strategy: t.strategy || null,
      tags: t.tags || []
    })) : []
  });
});
var localFindUser = (predicate) => {
  try {
    const fileRow = (loadDatabaseFromFile()?.users || []).find(predicate);
    if (fileRow) return fileRow;
  } catch {
  }
  for (const cached of userDatabases.values()) {
    const row = (cached?.users || []).find(predicate);
    if (row) return row;
  }
  return null;
};
var localAllUsers = () => {
  const byId = /* @__PURE__ */ new Map();
  try {
    for (const u of loadDatabaseFromFile()?.users || []) if (u?.id) byId.set(u.id, u);
  } catch {
  }
  for (const cached of userDatabases.values()) {
    for (const u of cached?.users || []) if (u?.id && !byId.has(u.id)) byId.set(u.id, u);
  }
  return [...byId.values()];
};
var localAllPayments = () => {
  const byId = /* @__PURE__ */ new Map();
  try {
    for (const p of loadDatabaseFromFile()?.payments || []) if (p?.id) byId.set(p.id, p);
  } catch {
  }
  for (const cached of userDatabases.values()) {
    for (const p of cached?.payments || []) if (p?.id && !byId.has(p.id)) byId.set(p.id, p);
  }
  return [...byId.values()];
};
var referralEarningsByReferrer = (users, payments) => {
  const referrerOf = {};
  for (const u of users || []) {
    if (u?.referredBy && u.id) referrerOf[u.id] = u.referredBy;
  }
  const earned = {};
  for (const pay of payments || []) {
    if (String(pay?.status || "").toLowerCase() !== "captured") continue;
    const key = referrerOf[pay.userId || pay.user_id];
    if (!key) continue;
    earned[key] = (earned[key] || 0) + Math.max(0, (Number(pay.amount) || 0) - PARTNER_PLATFORM_FLOOR_INR);
  }
  return earned;
};
var localUserRows = (userId) => {
  const rows = [];
  let fileDb = null;
  try {
    fileDb = loadDatabaseFromFile();
    const fileRow = (fileDb?.users || []).find((u) => u.id === userId);
    if (fileRow) rows.push(fileRow);
    else fileDb = null;
  } catch {
    fileDb = null;
  }
  for (const cached of userDatabases.values()) {
    const row = (cached?.users || []).find((u) => u.id === userId);
    if (row) rows.push(row);
  }
  return { rows, fileDb };
};
var localPatchUser = (userId, patch) => {
  const { rows, fileDb } = localUserRows(userId);
  if (rows.length === 0) return false;
  for (const row of rows) patch(row);
  if (fileDb) {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(fileDb, null, 2), "utf-8");
    } catch (err) {
      console.error("[localPatchUser] file write failed:", err);
    }
  }
  return true;
};
var lookupUserRole = async (userId) => {
  if (!userId) return null;
  if (!useSupabase) return localFindUser((u) => u.id === userId)?.role || null;
  const { data } = await supabase.from("users").select("role").eq("id", userId).maybeSingle();
  return data?.role || null;
};
var CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
var CODE_PATTERN = /^[A-Z0-9]{4,16}$/;
var generateReferralCode = (seed) => {
  const base = (seed || "PARTNER").replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 6) || "PARTNER";
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += CODE_ALPHABET[crypto2.randomInt(0, CODE_ALPHABET.length)];
  }
  return `${base}${suffix}`.slice(0, 16);
};
var PARTNER_PRO_UNTIL = () => new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1e3);
var readPartnerProfiles = () => {
  try {
    return loadDatabaseFromFile().partnerProfiles || [];
  } catch {
    return [];
  }
};
var writePartnerProfiles = (rows) => {
  const shared = loadDatabaseFromFile();
  shared.partnerProfiles = rows;
  fs.writeFileSync(DB_FILE, JSON.stringify(shared, null, 2), "utf-8");
};
var readPayoutRequests = () => {
  try {
    return loadDatabaseFromFile().partnerPayoutRequests || [];
  } catch {
    return [];
  }
};
var writePayoutRequests = (rows) => {
  const shared = loadDatabaseFromFile();
  shared.partnerPayoutRequests = rows;
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(shared, null, 2), "utf-8");
  } catch (err) {
    console.error("[writePayoutRequests] Failed to write to DB_FILE:", err);
  }
};
async function getPartnerData(userId) {
  let referralCode = "";
  let offerPrice = 499;
  let links = [];
  let payoutDetails = null;
  let createdBy = null;
  let createdAt = (/* @__PURE__ */ new Date()).toISOString();
  if (!useSupabase) {
    const prof = readPartnerProfiles().find((p) => p.userId === userId);
    if (prof) {
      referralCode = prof.referralCode || "";
      offerPrice = typeof prof.offerPrice === "number" ? prof.offerPrice : 499;
      links = Array.isArray(prof.links) ? prof.links : [];
      payoutDetails = prof.payoutDetails || null;
      createdBy = prof.createdBy || null;
      createdAt = prof.createdAt || createdAt;
    }
  } else {
    try {
      const [{ data: profData }, { data: userData }] = await Promise.all([
        supabase.from("partner_profiles").select("*").eq("user_id", userId).maybeSingle(),
        supabase.from("users").select("preferences").eq("id", userId).maybeSingle()
      ]);
      const userPrefs = userData?.preferences || {};
      referralCode = profData?.referral_code || "";
      createdBy = profData?.created_by || null;
      createdAt = profData?.created_at || createdAt;
      if (typeof profData?.offer_price === "number") {
        offerPrice = profData.offer_price;
      } else if (typeof userPrefs?.partnerOfferPrice === "number") {
        offerPrice = userPrefs.partnerOfferPrice;
      }
      if (Array.isArray(profData?.links)) {
        links = profData.links;
      } else if (Array.isArray(userPrefs?.partnerLinks)) {
        links = userPrefs.partnerLinks;
      }
      payoutDetails = profData?.payout_details || userPrefs?.payoutDetails || null;
    } catch (err) {
      console.warn("[getPartnerData] Error loading partner data:", err);
    }
  }
  return { referralCode, offerPrice, links, payoutDetails, createdBy, createdAt };
}
async function savePartnerLinks(userId, links) {
  if (!useSupabase) {
    const rows = readPartnerProfiles();
    const p = rows.find((x) => x.userId === userId);
    if (p) {
      p.links = links;
      writePartnerProfiles(rows);
    }
    return;
  }
  try {
    const { data: u } = await supabase.from("users").select("preferences").eq("id", userId).maybeSingle();
    const nextPrefs = { ...u?.preferences || {}, partnerLinks: links };
    await supabase.from("users").update({ preferences: nextPrefs }).eq("id", userId);
  } catch (err) {
    console.warn("[savePartnerLinks] Error updating users.preferences:", err);
  }
  try {
    await supabase.from("partner_profiles").update({ links }).eq("user_id", userId);
  } catch {
  }
}
async function savePartnerOfferPrice(userId, price) {
  if (!useSupabase) {
    const rows = readPartnerProfiles();
    const p = rows.find((x) => x.userId === userId);
    if (p) {
      p.offerPrice = price;
      writePartnerProfiles(rows);
    }
    return;
  }
  try {
    const { data: u } = await supabase.from("users").select("preferences").eq("id", userId).maybeSingle();
    const nextPrefs = { ...u?.preferences || {}, partnerOfferPrice: price };
    await supabase.from("users").update({ preferences: nextPrefs }).eq("id", userId);
  } catch (err) {
    console.warn("[savePartnerOfferPrice] Error updating users.preferences:", err);
  }
  try {
    await supabase.from("partner_profiles").update({ offer_price: price }).eq("user_id", userId);
  } catch {
  }
}
var findPartnerByCode = async (rawCode) => {
  const code = String(rawCode || "").trim();
  if (!code) return null;
  const lower = code.toLowerCase();
  if (!useSupabase) {
    const profiles = readPartnerProfiles();
    for (const p of profiles) {
      if (p.referralCode && p.referralCode.toLowerCase() === lower) {
        return {
          userId: p.userId,
          code: p.referralCode,
          offerPrice: typeof p.offerPrice === "number" ? p.offerPrice : 499,
          isActive: true
        };
      }
      if (Array.isArray(p.links)) {
        const link = p.links.find((l) => l.code && l.code.toLowerCase() === lower);
        if (link) {
          return {
            userId: p.userId,
            code: link.code,
            offerPrice: typeof link.offerPrice === "number" ? link.offerPrice : p.offerPrice || 499,
            isActive: link.isActive !== false,
            linkId: link.id,
            label: link.label
          };
        }
      }
    }
    return null;
  }
  try {
    const { data: primaryMatch } = await supabase.from("partner_profiles").select("user_id, referral_code").ilike("referral_code", code).maybeSingle();
    if (primaryMatch) {
      const pData = await getPartnerData(primaryMatch.user_id);
      return {
        userId: primaryMatch.user_id,
        code: primaryMatch.referral_code,
        offerPrice: pData.offerPrice || 499,
        isActive: true
      };
    }
  } catch (err) {
    console.warn("[findPartnerByCode] Error searching primary partner code:", err);
  }
  try {
    const { data: partnerUsers } = await supabase.from("users").select("id, preferences").eq("role", "PARTNER");
    for (const u of partnerUsers || []) {
      const links = u.preferences?.partnerLinks || [];
      const link = links.find((l) => l.code && l.code.toLowerCase() === lower);
      if (link) {
        return {
          userId: u.id,
          code: link.code,
          offerPrice: link.offerPrice || u.preferences?.partnerOfferPrice || 499,
          isActive: link.isActive !== false,
          linkId: link.id,
          label: link.label
        };
      }
    }
  } catch (err) {
    console.warn("[findPartnerByCode] Error searching custom links in users:", err);
  }
  try {
    const { data: allP } = await supabase.from("partner_profiles").select("user_id, referral_code, links");
    for (const p of allP || []) {
      const links = p.links || [];
      const link = links.find((l) => l.code && l.code.toLowerCase() === lower);
      if (link) {
        return {
          userId: p.user_id,
          code: link.code,
          offerPrice: link.offerPrice || 499,
          isActive: link.isActive !== false,
          linkId: link.id,
          label: link.label
        };
      }
    }
  } catch {
  }
  return null;
};
var isCodeAvailable = async (code, forUserId, excludeLinkId) => {
  const owner = await findPartnerByCode(code);
  if (!owner) return true;
  if (owner.userId !== forUserId) return false;
  if (excludeLinkId && owner.linkId === excludeLinkId) return true;
  return false;
};
var partnerReferralUrl = (req, code) => {
  const configured = process.env.PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  const origin = configured || `${req.protocol}://${req.get("host")}`;
  return `${origin}/?ref=${encodeURIComponent(code)}`;
};
async function linkReferral(req, userId, rawCode) {
  try {
    const partner = await findPartnerByCode(rawCode);
    if (!partner) return null;
    if (partner.userId === userId) return null;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (!useSupabase) {
      const existing2 = localFindUser((u) => u.id === userId);
      if (!existing2) return null;
      if (existing2.referredBy) return existing2.referredBy;
      const patched = localPatchUser(userId, (row) => {
        row.referredBy = partner.userId;
        row.referredAt = now;
        if (row.allowPartnerTradeView === void 0) row.allowPartnerTradeView = false;
      });
      if (!patched) return null;
      const rows = readAssignments();
      if (!rows.some((a) => a.subAdminId === partner.userId && a.userId === userId)) {
        rows.push({ subAdminId: partner.userId, userId, assignedBy: "referral", createdAt: now });
        writeAssignments(rows);
      }
      return partner.userId;
    }
    const { data: existing } = await supabase.from("users").select("referred_by").eq("id", userId).maybeSingle();
    if (existing?.referred_by) return existing.referred_by;
    await supabase.from("users").update({ referred_by: partner.userId, referred_at: now }).eq("id", userId);
    try {
      await supabase.from("sub_admin_assignments").upsert(
        {
          id: `saa_${crypto2.randomUUID()}`,
          sub_admin_id: partner.userId,
          user_id: userId,
          assigned_by: null,
          created_at: now
        },
        { onConflict: "sub_admin_id, user_id" }
      );
    } catch (insertErr) {
      console.warn("[linkReferral] sub_admin_assignments upsert error:", insertErr);
    }
    return partner.userId;
  } catch (err) {
    console.error("[linkReferral] failed:", err);
    return null;
  }
}
app.get(["/api/referral/:code", "/api/coupon/validate/:code", "/api/coupon/:code"], async (req, res) => {
  const partner = await findPartnerByCode(req.params.code);
  if (!partner) {
    return res.status(404).json({ valid: false, error: "That coupon or referral code is not recognised." });
  }
  if (partner.isActive === false) {
    return res.status(400).json({ valid: false, error: "This referral link has been revoked or deactivated by the mentor." });
  }
  let name = "a mentor";
  if (!useSupabase) {
    const u = localFindUser((x) => x.id === partner.userId);
    name = u?.name || (u?.email || "").split("@")[0] || name;
  } else {
    const { data } = await supabase.from("users").select("name, email").eq("id", partner.userId).maybeSingle();
    name = data?.name || String(data?.email || "").split("@")[0] || name;
  }
  const standardPrice = 499;
  const offerPrice = Math.min(499, Math.max(PARTNER_PLATFORM_FLOOR_INR, Number(partner.offerPrice) || 499));
  const discountAmount = Math.max(0, standardPrice - offerPrice);
  const discountPercent = Math.round(discountAmount / standardPrice * 100);
  const mentorCommission = Math.max(0, offerPrice - PARTNER_PLATFORM_FLOOR_INR);
  res.json({
    valid: true,
    code: partner.code,
    partnerName: name,
    standardPrice,
    originalPrice: standardPrice,
    offerPrice,
    finalPrice: offerPrice,
    discountAmount,
    discountPercent,
    mentorCommission,
    message: discountAmount > 0 ? `\u20B9${discountAmount} mentor discount applied! You pay \u20B9${offerPrice} instead of \u20B9${standardPrice}.` : `Mentor referral code from ${name} applied!`
  });
});
async function savePartnerProfile(userId, code, createdBy, offerPrice = 499, links, payoutDetails) {
  if (!useSupabase) {
    const rows = readPartnerProfiles();
    const existing = rows.find((p) => p.userId === userId);
    const existingLinks = links !== void 0 ? links : existing?.links || [];
    const existingOfferPrice = offerPrice !== void 0 ? offerPrice : existing?.offerPrice || 499;
    const existingPayoutDetails = payoutDetails !== void 0 ? payoutDetails : existing?.payoutDetails;
    const filtered = rows.filter((p) => p.userId !== userId);
    filtered.push({
      userId,
      referralCode: code,
      offerPrice: existingOfferPrice,
      links: existingLinks,
      payoutDetails: existingPayoutDetails,
      createdAt: existing?.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
      createdBy: existing?.createdBy || createdBy
    });
    writePartnerProfiles(filtered);
    return;
  }
  try {
    const { error: upsertErr } = await supabase.from("partner_profiles").upsert(
      {
        user_id: userId,
        referral_code: code,
        offer_price: offerPrice,
        links: links || [],
        payout_details: payoutDetails || {},
        created_by: createdBy || null
      },
      { onConflict: "user_id" }
    );
    if (upsertErr) {
      await supabase.from("partner_profiles").upsert(
        {
          user_id: userId,
          referral_code: code,
          created_by: createdBy || null
        },
        { onConflict: "user_id" }
      );
    }
  } catch (err) {
    console.warn("[savePartnerProfile] Supabase upsert error:", err);
  }
  try {
    const { data: u } = await supabase.from("users").select("preferences").eq("id", userId).maybeSingle();
    const curPrefs = u?.preferences || {};
    const nextPrefs = { ...curPrefs };
    if (offerPrice !== void 0) nextPrefs.partnerOfferPrice = offerPrice;
    if (links !== void 0) nextPrefs.partnerLinks = links;
    if (payoutDetails !== void 0) nextPrefs.payoutDetails = payoutDetails;
    await supabase.from("users").update({ preferences: nextPrefs }).eq("id", userId);
  } catch (err) {
    console.warn("[savePartnerProfile] Error syncing with users.preferences:", err);
  }
}
app.get("/api/partner/me", async (req, res) => {
  const ctx = await requirePermission(req, res, "partner.self");
  if (!ctx) return;
  const userId = ctx.user?.id || "";
  const { referralCode: code, offerPrice, links } = await getPartnerData(userId);
  let activeCode = code;
  if (!activeCode) {
    activeCode = generateReferralCode(ctx.user?.name || ctx.user?.email || "");
    for (let i = 0; i < 5 && !await isCodeAvailable(activeCode, userId); i++) {
      activeCode = generateReferralCode(ctx.user?.name || ctx.user?.email || "");
    }
    await savePartnerProfile(userId, activeCode, userId, 499, []);
  }
  const standardPrice = 499;
  const mentorEarns = Math.max(0, offerPrice - 199);
  const formattedLinks = (links || []).map((l) => ({
    ...l,
    offerPrice: l.offerPrice || offerPrice,
    referralUrl: partnerReferralUrl(req, l.code),
    mentorEarns: Math.max(0, (l.offerPrice || offerPrice) - 199),
    studentSaves: Math.max(0, standardPrice - (l.offerPrice || offerPrice))
  }));
  res.json({
    partnerId: userId,
    name: ctx.user?.name || null,
    referralCode: activeCode,
    offerPrice,
    standardPrice,
    mentorEarns,
    referralUrl: partnerReferralUrl(req, activeCode),
    links: formattedLinks
  });
});
app.put("/api/partner/code", async (req, res) => {
  const ctx = await requirePermission(req, res, "partner.self");
  if (!ctx) return;
  const userId = ctx.user?.id || "";
  const code = String(req.body?.referralCode || "").trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    return res.status(400).json({ error: "Use 4-16 letters and numbers only, no spaces or symbols." });
  }
  if (["ADMIN", "SUPPORT", "FXJOURNALPRO", "OFFICIAL"].includes(code)) {
    return res.status(400).json({ error: "That code is reserved. Please choose another." });
  }
  if (!await isCodeAvailable(code, userId)) {
    return res.status(409).json({ error: "That code is already taken. Please choose another." });
  }
  const { offerPrice, links, payoutDetails } = await getPartnerData(userId);
  await savePartnerProfile(userId, code, userId, offerPrice, links, payoutDetails);
  res.json({ referralCode: code, referralUrl: partnerReferralUrl(req, code) });
});
app.put("/api/partner/offer-price", async (req, res) => {
  const ctx = await requirePermission(req, res, "partner.self");
  if (!ctx) return;
  const userId = ctx.user?.id || "";
  const price = Number(req.body?.offerPrice);
  if (isNaN(price) || price < 199 || price > 499) {
    return res.status(400).json({ error: "Offer price must be between \u20B9199 and \u20B9499." });
  }
  const rounded = Math.round(price);
  await savePartnerOfferPrice(userId, rounded);
  const mentorEarns = Math.max(0, rounded - 199);
  res.json({
    success: true,
    offerPrice: rounded,
    standardPrice: 499,
    mentorEarns,
    studentSaves: 499 - rounded,
    message: `Offer price updated to \u20B9${rounded}. You will earn \u20B9${mentorEarns} per student.`
  });
});
app.get("/api/partner/links", async (req, res) => {
  const ctx = await requirePermission(req, res, "partner.self");
  if (!ctx) return;
  const userId = ctx.user?.id || "";
  const { links, offerPrice: defaultOfferPrice } = await getPartnerData(userId);
  const enriched = (links || []).map((l) => ({
    ...l,
    referralUrl: partnerReferralUrl(req, l.code),
    mentorEarns: Math.max(0, (l.offerPrice || defaultOfferPrice) - 199),
    studentSaves: Math.max(0, 499 - (l.offerPrice || defaultOfferPrice))
  }));
  res.json({ links: enriched });
});
app.post("/api/partner/links", async (req, res) => {
  const ctx = await requirePermission(req, res, "partner.self");
  if (!ctx) return;
  const userId = ctx.user?.id || "";
  let code = String(req.body?.code || "").trim().toUpperCase();
  const label = String(req.body?.label || "Special Offer").trim();
  let offerPrice = Number(req.body?.offerPrice);
  if (isNaN(offerPrice) || offerPrice < 199 || offerPrice > 499) {
    offerPrice = 499;
  }
  offerPrice = Math.round(offerPrice);
  if (!code) {
    code = generateReferralCode(label || ctx.user?.name || "LINK");
    for (let i = 0; i < 5 && !await isCodeAvailable(code, userId); i++) {
      code = generateReferralCode(label || ctx.user?.name || "LINK");
    }
  } else {
    if (!CODE_PATTERN.test(code)) {
      return res.status(400).json({ error: "Use 4-16 letters and numbers only, no spaces or symbols." });
    }
    if (["ADMIN", "SUPPORT", "FXJOURNALPRO", "OFFICIAL"].includes(code)) {
      return res.status(400).json({ error: "That code is reserved. Please choose another." });
    }
    if (!await isCodeAvailable(code, userId)) {
      return res.status(409).json({ error: "That code is already in use. Please choose another." });
    }
  }
  const newLink = {
    id: `link_${crypto2.randomUUID().slice(0, 8)}`,
    code,
    label: label || "Custom Offer",
    offerPrice,
    isActive: true,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  const { links: existingLinks } = await getPartnerData(userId);
  const curLinks = [newLink, ...existingLinks || []];
  await savePartnerLinks(userId, curLinks);
  res.json({
    success: true,
    link: {
      ...newLink,
      referralUrl: partnerReferralUrl(req, newLink.code),
      mentorEarns: Math.max(0, newLink.offerPrice - 199),
      studentSaves: Math.max(0, 499 - newLink.offerPrice)
    },
    message: `Referral link ${newLink.code} created successfully!`
  });
});
app.put("/api/partner/links/:id", async (req, res) => {
  const ctx = await requirePermission(req, res, "partner.self");
  if (!ctx) return;
  const userId = ctx.user?.id || "";
  const { id } = req.params;
  const patch = req.body || {};
  const { links: existingLinks } = await getPartnerData(userId);
  const curLinks = [...existingLinks || []];
  const target = curLinks.find((l) => l.id === id);
  if (!target) return res.status(404).json({ error: "Link not found" });
  if (patch.code) {
    const code = String(patch.code).trim().toUpperCase();
    if (!CODE_PATTERN.test(code)) return res.status(400).json({ error: "Use 4-16 letters and numbers only." });
    if (code !== target.code && !await isCodeAvailable(code, userId, id)) {
      return res.status(409).json({ error: "That code is already in use." });
    }
    target.code = code;
  }
  if (patch.label !== void 0) target.label = String(patch.label).trim();
  if (patch.offerPrice !== void 0) {
    const pNum = Number(patch.offerPrice);
    if (!isNaN(pNum) && pNum >= 199 && pNum <= 499) target.offerPrice = Math.round(pNum);
  }
  if (typeof patch.isActive === "boolean") target.isActive = patch.isActive;
  target.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await savePartnerLinks(userId, curLinks);
  res.json({
    success: true,
    link: {
      ...target,
      referralUrl: partnerReferralUrl(req, target.code),
      mentorEarns: Math.max(0, target.offerPrice - 199),
      studentSaves: Math.max(0, 499 - target.offerPrice)
    },
    message: target.isActive ? "Link updated." : "Link revoked / deactivated."
  });
});
app.delete("/api/partner/links/:id", async (req, res) => {
  const ctx = await requirePermission(req, res, "partner.self");
  if (!ctx) return;
  const userId = ctx.user?.id || "";
  const { id } = req.params;
  const { links: existingLinks } = await getPartnerData(userId);
  const curLinks = (existingLinks || []).filter((l) => l.id !== id);
  await savePartnerLinks(userId, curLinks);
  res.json({ success: true, message: "Referral link removed." });
});
app.patch("/api/user/partner-visibility", async (req, res) => {
  const currentUser = req.currentUser;
  if (!currentUser?.id) return res.status(401).json({ error: "Not signed in" });
  const allow = req.body?.allow === true;
  if (!useSupabase) {
    const patched = localPatchUser(currentUser.id, (row) => {
      row.allowPartnerTradeView = allow;
    });
    if (!patched) return res.status(404).json({ error: "User not found" });
  } else {
    const { error } = await supabase.from("users").update({ allow_partner_trade_view: allow }).eq("id", currentUser.id);
    if (error) {
      console.error("[PATCH /api/user/partner-visibility] error:", error);
      return res.status(500).json({ error: "Failed to update the setting." });
    }
  }
  res.json({ allowPartnerTradeView: allow });
});
app.get("/api/user/mentor-access", async (req, res) => {
  const currentUser = req.currentUser;
  if (!currentUser?.id) return res.status(401).json({ error: "Not signed in" });
  const access = await readMentorAccess(currentUser.id);
  let accounts = [];
  if (!useSupabase) {
    accounts = (req.userDb?.accounts || []).filter((a) => a.userId === currentUser.id).map((a) => ({ id: a.id, name: a.name }));
  } else {
    const { data } = await supabase.from("trading_accounts").select("id, name").eq("user_id", currentUser.id);
    accounts = (data || []).map((a) => ({ id: a.id, name: a.name }));
  }
  res.json({ access, accounts });
});
app.patch("/api/user/mentor-access", async (req, res) => {
  const currentUser = req.currentUser;
  if (!currentUser?.id) return res.status(401).json({ error: "Not signed in" });
  const current = await readMentorAccess(currentUser.id);
  const patch = req.body || {};
  const next = { ...current };
  for (const key of MENTOR_ACCESS_BOOLEAN_SECTIONS) {
    if (typeof patch[key] === "boolean") next[key] = patch[key];
  }
  if ("accounts" in patch) {
    if (patch.accounts === null) next.accounts = null;
    else if (Array.isArray(patch.accounts)) {
      let owned = [];
      if (!useSupabase) {
        owned = (req.userDb?.accounts || []).filter((a) => a.userId === currentUser.id).map((a) => a.id);
      } else {
        const { data } = await supabase.from("trading_accounts").select("id").eq("user_id", currentUser.id);
        owned = (data || []).map((a) => a.id);
      }
      next.accounts = patch.accounts.filter((id) => typeof id === "string" && owned.includes(id));
    } else {
      return res.status(400).json({ error: "accounts must be null or a list of account ids." });
    }
  }
  if (!useSupabase) {
    const patched = localPatchUser(currentUser.id, (row) => {
      row.mentorAccess = next;
    });
    if (!patched) return res.status(404).json({ error: "User not found" });
  } else {
    const { error } = await supabase.from("users").update({ mentor_access: next }).eq("id", currentUser.id);
    if (error) {
      console.error("[PATCH /api/user/mentor-access] error:", error);
      return res.status(500).json({ error: "Failed to update your sharing settings." });
    }
  }
  res.json({ access: next });
});
app.get("/api/user/partner-link", async (req, res) => {
  const currentUser = req.currentUser;
  if (!currentUser?.id) return res.status(401).json({ error: "Not signed in" });
  let referredBy = null;
  let allow = false;
  if (!useSupabase) {
    const row = localFindUser((u) => u.id === currentUser.id);
    referredBy = row?.referredBy || null;
    allow = row?.allowPartnerTradeView === true;
  } else {
    const { data } = await supabase.from("users").select("referred_by, allow_partner_trade_view").eq("id", currentUser.id).maybeSingle();
    referredBy = data?.referred_by || null;
    allow = data?.allow_partner_trade_view === true;
  }
  if (!referredBy) return res.json({ hasPartner: false, allowPartnerTradeView: allow });
  let partnerName = "your partner";
  let partnerUsername = "mentor";
  let partnerEmail = null;
  let referralCode = null;
  if (!useSupabase) {
    const p = localFindUser((u) => u.id === referredBy || u.referralCode === referredBy);
    partnerName = p?.name || (p?.email || "").split("@")[0] || partnerName;
    partnerEmail = p?.email || null;
    partnerUsername = p?.name || (p?.email || "").split("@")[0] || partnerName;
    referralCode = p?.referralCode || null;
  } else {
    let { data } = await supabase.from("users").select("id, name, email, referral_code").eq("id", referredBy).maybeSingle();
    if (!data) {
      const resCode = await supabase.from("users").select("id, name, email, referral_code").eq("referral_code", referredBy).maybeSingle();
      data = resCode.data;
    }
    const partnerUserId = data?.id || referredBy;
    const { data: profile } = await supabase.from("partner_profiles").select("referral_code").eq("user_id", partnerUserId).maybeSingle();
    partnerName = data?.name || String(data?.email || "").split("@")[0] || partnerName;
    partnerEmail = data?.email || null;
    partnerUsername = data?.name || String(data?.email || "").split("@")[0] || partnerName;
    referralCode = profile?.referral_code || data?.referral_code || (typeof referredBy === "string" && referredBy.startsWith("FX") ? referredBy : null);
  }
  res.json({
    hasPartner: true,
    partnerName,
    partnerUsername,
    partnerEmail,
    referralCode,
    allowPartnerTradeView: allow
  });
});
app.post("/api/user/link-partner", async (req, res) => {
  const currentUser = req.currentUser;
  if (!currentUser?.id) return res.status(401).json({ error: "Not signed in" });
  const rawCode = String(req.body?.code || "").trim().toUpperCase();
  if (!rawCode) return res.status(400).json({ error: "Please enter a referral / mentor code." });
  const partner = await findPartnerByCode(rawCode);
  if (!partner) {
    return res.status(404).json({ error: "That mentor referral code does not exist. Please check the code and try again." });
  }
  if (partner.isActive === false) {
    return res.status(400).json({ error: "This referral code has been deactivated by the mentor." });
  }
  if (partner.userId === currentUser.id) {
    return res.status(400).json({ error: "You cannot link your own referral / mentor code to your account." });
  }
  let existingReferredBy = null;
  if (!useSupabase) {
    const existing = localFindUser((u) => u.id === currentUser.id);
    existingReferredBy = existing?.referredBy || null;
  } else {
    const { data: existing } = await supabase.from("users").select("referred_by").eq("id", currentUser.id).maybeSingle();
    existingReferredBy = existing?.referred_by || null;
  }
  if (existingReferredBy) {
    if (existingReferredBy === partner.userId) {
      return res.status(400).json({ error: "You are already linked to this mentor." });
    }
    return res.status(400).json({ error: "Your account is already linked to another mentor." });
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (!useSupabase) {
    localPatchUser(currentUser.id, (row) => {
      row.referredBy = partner.userId;
      row.referredAt = now;
      if (row.allowPartnerTradeView === void 0) row.allowPartnerTradeView = false;
    });
    const rows = readAssignments();
    if (!rows.some((a) => a.subAdminId === partner.userId && a.userId === currentUser.id)) {
      rows.push({ subAdminId: partner.userId, userId: currentUser.id, assignedBy: "referral", createdAt: now });
      writeAssignments(rows);
    }
  } else {
    await supabase.from("users").update({ referred_by: partner.userId, referred_at: now }).eq("id", currentUser.id);
    try {
      await supabase.from("sub_admin_assignments").upsert(
        {
          id: `saa_${crypto2.randomUUID()}`,
          sub_admin_id: partner.userId,
          user_id: currentUser.id,
          assigned_by: null,
          created_at: now
        },
        { onConflict: "sub_admin_id, user_id" }
      );
    } catch (insertErr) {
      console.warn("[link-partner] sub_admin_assignments upsert error:", insertErr);
    }
  }
  let partnerName = "your partner";
  let partnerUsername = "mentor";
  let partnerEmail = null;
  let referralCode = partner?.code || rawCode;
  if (partner?.userId) {
    if (!useSupabase) {
      const p = localFindUser((u) => u.id === partner.userId);
      partnerName = p?.name || (p?.email || "").split("@")[0] || partnerName;
      partnerEmail = p?.email || null;
      partnerUsername = p?.name || (p?.email || "").split("@")[0] || partnerName;
    } else {
      const { data } = await supabase.from("users").select("name, email, referral_code").eq("id", partner.userId).maybeSingle();
      partnerName = data?.name || String(data?.email || "").split("@")[0] || partnerName;
      partnerEmail = data?.email || null;
      partnerUsername = data?.name || String(data?.email || "").split("@")[0] || partnerName;
      if (data?.referral_code) referralCode = data.referral_code;
    }
  }
  res.json({
    success: true,
    hasPartner: true,
    partnerName,
    partnerUsername,
    partnerEmail,
    referralCode,
    allowPartnerTradeView: false
  });
});
app.post("/api/admin/users/:id/partner", async (req, res) => {
  const ctx = await requirePermission(req, res, "partner.manage");
  if (!ctx) return;
  const { id } = req.params;
  const requested = String(req.body?.referralCode || "").trim().toUpperCase();
  let target = null;
  if (!useSupabase) {
    target = localFindUser((u) => u.id === id);
  } else {
    const { data } = await supabase.from("users").select("id, email, name, role").eq("id", id).maybeSingle();
    target = data;
  }
  if (!target) return res.status(404).json({ error: "User not found" });
  if (["SUPER_ADMIN", "ADMIN"].includes(target.role)) {
    return res.status(400).json({ error: "Admins cannot be converted into partners." });
  }
  let code = requested;
  if (code) {
    if (!CODE_PATTERN.test(code)) {
      return res.status(400).json({ error: "Use 4-16 letters and numbers only, no spaces or symbols." });
    }
    if (!await isCodeAvailable(code, id)) {
      return res.status(409).json({ error: "That code is already taken." });
    }
  } else {
    code = generateReferralCode(target.name || target.email || "");
    for (let i = 0; i < 5 && !await isCodeAvailable(code, id); i++) {
      code = generateReferralCode(target.name || target.email || "");
    }
  }
  if (!useSupabase) {
    localPatchUser(id, (row) => {
      row.role = "PARTNER";
    });
  } else {
    const { error } = await supabase.from("users").update({ role: "PARTNER" }).eq("id", id);
    if (error) {
      console.error("[POST /api/admin/users/:id/partner] error:", error);
      return res.status(500).json({ error: "Failed to upgrade this user." });
    }
  }
  await applyProState(id, PARTNER_PRO_UNTIL());
  await savePartnerProfile(id, code, ctx.user?.id || "");
  await writeAuditLog(req, ctx, "partner.promote", "user", id, { email: target.email, referralCode: code });
  res.json({
    message: `${target.email} is now a Partner.`,
    userId: id,
    role: "PARTNER",
    isPro: true,
    referralCode: code,
    referralUrl: partnerReferralUrl(req, code)
  });
});
app.delete("/api/admin/users/:id/partner", async (req, res) => {
  const ctx = await requirePermission(req, res, "partner.manage");
  if (!ctx) return;
  const { id } = req.params;
  if (!useSupabase) {
    const row = localFindUser((u) => u.id === id);
    if (!row) return res.status(404).json({ error: "User not found" });
    if (row.role !== "PARTNER") return res.status(400).json({ error: "That account is not a partner." });
    localPatchUser(id, (r) => {
      r.role = "USER";
    });
    writePartnerProfiles(readPartnerProfiles().filter((pp) => pp.userId !== id));
  } else {
    const { data: row } = await supabase.from("users").select("role").eq("id", id).maybeSingle();
    if (!row) return res.status(404).json({ error: "User not found" });
    if (row.role !== "PARTNER") return res.status(400).json({ error: "That account is not a partner." });
    await supabase.from("users").update({ role: "USER" }).eq("id", id);
    await supabase.from("partner_profiles").delete().eq("user_id", id);
  }
  await writeAuditLog(req, ctx, "partner.demote", "user", id, {});
  res.json({ message: "Partner access removed.", userId: id, role: "USER" });
});
async function getPartnerPayoutData(userId, partnerCode) {
  let totalEarned = 0;
  if (!useSupabase) {
    const all = localAllUsers();
    const referrerOf = {};
    for (const u of all) {
      if (u.referredBy) referrerOf[u.id] = u.referredBy;
    }
    for (const pay of localAllPayments()) {
      if (String(pay.status || "").toLowerCase() !== "captured") continue;
      const key = referrerOf[pay.userId || pay.user_id];
      if (key === userId || partnerCode && key === partnerCode) {
        totalEarned += Math.max(0, (Number(pay.amount) || 0) - PARTNER_PLATFORM_FLOOR_INR);
      }
    }
  } else {
    try {
      const { data: users } = await supabase.from("users").select("id, referred_by");
      const { data: payments } = await supabase.from("payments").select("amount, status, user_id").eq("status", "captured");
      const referrerOf = {};
      for (const u of users || []) {
        if (u.referred_by) referrerOf[u.id] = u.referred_by;
      }
      for (const pay of payments || []) {
        const key = referrerOf[pay.user_id];
        if (key === userId || partnerCode && key === partnerCode) {
          totalEarned += Math.max(0, (Number(pay.amount) || 0) - PARTNER_PLATFORM_FLOOR_INR);
        }
      }
    } catch (err) {
      console.warn("[getPartnerPayoutData] Supabase fetch error:", err);
    }
  }
  let allRequests = [];
  if (useSupabase) {
    try {
      const { data, error } = await supabase.from("partner_payout_requests").select("*").eq("partner_id", userId).order("requested_at", { ascending: false });
      if (!error && Array.isArray(data)) {
        allRequests = data.map((r) => ({
          id: r.id,
          partnerId: r.partner_id,
          partnerName: r.partner_name || "",
          partnerEmail: r.partner_email || "",
          partnerCode: r.partner_code || partnerCode,
          amount: Number(r.amount) || 0,
          method: r.method,
          payoutDetails: r.payout_details || {},
          status: r.status,
          utrNumber: r.utr_number,
          adminNotes: r.admin_notes,
          requestedAt: r.requested_at,
          processedAt: r.processed_at,
          processedBy: r.processed_by
        }));
      } else {
        const { data: u } = await supabase.from("users").select("preferences").eq("id", userId).maybeSingle();
        if (Array.isArray(u?.preferences?.payoutRequests)) {
          allRequests = u.preferences.payoutRequests;
        } else {
          allRequests = readPayoutRequests().filter((r) => r.partnerId === userId);
        }
      }
    } catch {
      allRequests = readPayoutRequests().filter((r) => r.partnerId === userId);
    }
  } else {
    allRequests = readPayoutRequests().filter((r) => r.partnerId === userId);
  }
  allRequests.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
  const totalWithdrawn = allRequests.filter((r) => r.status === "PAID").reduce((sum, r) => sum + r.amount, 0);
  const totalPending = allRequests.filter((r) => r.status === "PENDING").reduce((sum, r) => sum + r.amount, 0);
  const availableBalance = Math.max(0, totalEarned - totalWithdrawn - totalPending);
  return {
    totalEarned,
    totalWithdrawn,
    totalPending,
    availableBalance,
    minPayoutThreshold: 500,
    requests: allRequests
  };
}
app.get("/api/partner/payout", async (req, res) => {
  const ctx = await requirePermission(req, res, "partner.self");
  if (!ctx) return;
  const userId = ctx.user?.id || "";
  let profile = null;
  let payoutDetails = null;
  if (!useSupabase) {
    profile = readPartnerProfiles().find((p) => p.userId === userId) || null;
    payoutDetails = profile?.payoutDetails || null;
  } else {
    const [{ data: profData }, { data: userData }] = await Promise.all([
      supabase.from("partner_profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("users").select("preferences").eq("id", userId).maybeSingle()
    ]);
    profile = profData ? toCamel(profData) : null;
    payoutDetails = profile?.payoutDetails || userData?.preferences?.payoutDetails || null;
  }
  const partnerCode = profile?.referralCode || "";
  const payoutData = await getPartnerPayoutData(userId, partnerCode);
  res.json({
    payoutDetails,
    earnings: {
      totalEarned: payoutData.totalEarned,
      totalWithdrawn: payoutData.totalWithdrawn,
      totalPending: payoutData.totalPending,
      availableBalance: payoutData.availableBalance,
      minPayoutThreshold: payoutData.minPayoutThreshold
    },
    requests: payoutData.requests
  });
});
app.put("/api/partner/payout-settings", async (req, res) => {
  const ctx = await requirePermission(req, res, "partner.self");
  if (!ctx) return;
  const userId = ctx.user?.id || "";
  const type = req.body?.type === "BANK" ? "BANK" : "UPI";
  const upiId = String(req.body?.upiId || "").trim();
  const accountHolderName = String(req.body?.accountHolderName || "").trim();
  const accountNumber = String(req.body?.accountNumber || "").trim();
  const ifsc = String(req.body?.ifsc || "").trim().toUpperCase();
  const bankName = String(req.body?.bankName || "").trim();
  if (type === "UPI" && upiId && !/^[\w.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(upiId)) {
    return res.status(400).json({ error: "Please enter a valid UPI ID (e.g. name@okhdfcbank, mobile@paytm)." });
  }
  if (type === "BANK") {
    if (accountNumber && !/^\d{9,18}$/.test(accountNumber)) {
      return res.status(400).json({ error: "Account number should be 9 to 18 digits." });
    }
    if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
      return res.status(400).json({ error: "Please enter a valid 11-character IFSC code (e.g. HDFC0001234)." });
    }
  }
  const payoutDetails = {
    type,
    upiId,
    accountHolderName,
    accountNumber,
    ifsc,
    bankName
  };
  const pData = await getPartnerData(userId);
  const code = pData.referralCode;
  const offerPrice = pData.offerPrice;
  const links = pData.links;
  await savePartnerProfile(userId, code, userId, offerPrice, links, payoutDetails);
  if (useSupabase) {
    try {
      const { data: u } = await supabase.from("users").select("preferences").eq("id", userId).maybeSingle();
      const nextPrefs = { ...u?.preferences || {}, payoutDetails };
      await supabase.from("users").update({ preferences: nextPrefs }).eq("id", userId);
    } catch {
    }
  }
  res.json({ success: true, payoutDetails });
});
app.post("/api/partner/payout-request", async (req, res) => {
  const ctx = await requirePermission(req, res, "partner.self");
  if (!ctx) return;
  const userId = ctx.user?.id || "";
  let profile = null;
  let payoutDetails = null;
  if (!useSupabase) {
    profile = readPartnerProfiles().find((p) => p.userId === userId) || null;
    payoutDetails = profile?.payoutDetails;
  } else {
    const [{ data: profData }, { data: userData }] = await Promise.all([
      supabase.from("partner_profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("users").select("preferences").eq("id", userId).maybeSingle()
    ]);
    profile = profData ? toCamel(profData) : null;
    payoutDetails = profile?.payoutDetails || userData?.preferences?.payoutDetails || null;
  }
  const method = req.body?.method === "BANK" ? "BANK" : "UPI";
  if (method === "UPI") {
    const passedUpi = typeof req.body?.upiId === "string" ? req.body.upiId.trim() : "";
    const finalUpi = passedUpi || payoutDetails?.upiId || "Direct on WhatsApp";
    payoutDetails = {
      ...payoutDetails || {},
      type: "UPI",
      upiId: finalUpi
    };
  }
  if (!payoutDetails) {
    return res.status(400).json({ error: "Please enter your UPI ID (or Bank details) to proceed." });
  }
  if (method === "BANK" && (!payoutDetails.accountNumber || !payoutDetails.ifsc)) {
    return res.status(400).json({ error: "Please enter your Bank Account Number and IFSC in Payout Settings first." });
  }
  const rawAmount = Math.floor(Number(req.body?.amount));
  if (isNaN(rawAmount) || rawAmount <= 0) {
    return res.status(400).json({ error: "Please enter a valid withdrawal amount." });
  }
  const partnerCode = profile?.referralCode || "";
  const payoutData = await getPartnerPayoutData(userId, partnerCode);
  const effectiveMin = Math.min(500, payoutData.availableBalance);
  if (rawAmount < Math.min(100, effectiveMin)) {
    return res.status(400).json({ error: `Minimum withdrawal amount is \u20B9${Math.min(100, effectiveMin)}.` });
  }
  if (rawAmount > payoutData.availableBalance) {
    return res.status(400).json({ error: `Withdrawal amount (\u20B9${rawAmount}) exceeds your available balance (\u20B9${payoutData.availableBalance}).` });
  }
  const requestId = `pr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const partnerName = ctx.user?.name || ctx.user?.email?.split("@")[0] || "Partner";
  const partnerEmail = ctx.user?.email || "";
  const newRequest = {
    id: requestId,
    partnerId: userId,
    partnerName,
    partnerEmail,
    partnerCode,
    amount: rawAmount,
    method,
    payoutDetails,
    status: "PENDING",
    requestedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  const currentRequests = readPayoutRequests();
  currentRequests.unshift(newRequest);
  writePayoutRequests(currentRequests);
  if (useSupabase) {
    try {
      await supabase.from("partner_payout_requests").insert({
        id: requestId,
        partner_id: userId,
        amount: rawAmount,
        method,
        payout_details: payoutDetails,
        status: "PENDING",
        requested_at: newRequest.requestedAt
      });
    } catch (err) {
      console.warn("[partner-payout-request] Supabase fallback to preferences storage:", err);
    }
    try {
      const { data: u } = await supabase.from("users").select("preferences").eq("id", userId).maybeSingle();
      const existingReqs = Array.isArray(u?.preferences?.payoutRequests) ? u.preferences.payoutRequests : [];
      existingReqs.unshift(newRequest);
      const nextPrefs = { ...u?.preferences || {}, payoutRequests: existingReqs };
      await supabase.from("users").update({ preferences: nextPrefs }).eq("id", userId);
    } catch {
    }
  }
  await writeAuditLog(req, ctx, "partner.payout_request", "payout", requestId, {
    amount: rawAmount,
    method,
    partnerEmail
  });
  res.json({
    success: true,
    message: `Withdrawal request for \u20B9${rawAmount} submitted successfully.`,
    request: newRequest
  });
});
app.get("/api/admin/payouts", async (req, res) => {
  const ctx = await requirePermission(req, res, "billing.read");
  if (!ctx) return;
  let requests = [];
  if (!useSupabase) {
    requests = readPayoutRequests();
  } else {
    try {
      const { data, error } = await supabase.from("partner_payout_requests").select("*").order("requested_at", { ascending: false });
      if (!error && Array.isArray(data)) {
        const { data: users } = await supabase.from("users").select("id, name, email");
        const { data: profs } = await supabase.from("partner_profiles").select("user_id, referral_code");
        const uMap = new Map((users || []).map((u) => [u.id, u]));
        const pMap = new Map((profs || []).map((p) => [p.user_id, p.referral_code]));
        requests = data.map((r) => {
          const u = uMap.get(r.partner_id);
          return {
            id: r.id,
            partnerId: r.partner_id,
            partnerName: u?.name || u?.email?.split("@")[0] || "Partner",
            partnerEmail: u?.email || "",
            partnerCode: pMap.get(r.partner_id) || "",
            amount: Number(r.amount) || 0,
            method: r.method,
            payoutDetails: r.payout_details || {},
            status: r.status,
            utrNumber: r.utr_number,
            adminNotes: r.admin_notes,
            requestedAt: r.requested_at,
            processedAt: r.processed_at,
            processedBy: r.processed_by
          };
        });
      } else {
        const { data: users } = await supabase.from("users").select("id, name, email, preferences");
        const { data: profs } = await supabase.from("partner_profiles").select("user_id, referral_code");
        const pMap = new Map((profs || []).map((p) => [p.user_id, p.referral_code]));
        const prefReqs = [];
        for (const u of users || []) {
          if (Array.isArray(u?.preferences?.payoutRequests)) {
            for (const r of u.preferences.payoutRequests) {
              prefReqs.push({
                ...r,
                partnerName: r.partnerName || u.name || "Partner",
                partnerEmail: r.partnerEmail || u.email || "",
                partnerCode: r.partnerCode || pMap.get(u.id) || ""
              });
            }
          }
        }
        if (prefReqs.length > 0) {
          requests = prefReqs;
        } else {
          requests = readPayoutRequests();
        }
      }
    } catch {
      requests = readPayoutRequests();
    }
  }
  const totalPending = requests.filter((r) => r.status === "PENDING").reduce((s, r) => s + r.amount, 0);
  const totalPaid = requests.filter((r) => r.status === "PAID").reduce((s, r) => s + r.amount, 0);
  const pendingCount = requests.filter((r) => r.status === "PENDING").length;
  res.json({
    requests,
    summary: {
      totalPending,
      totalPaid,
      pendingCount,
      totalCount: requests.length
    }
  });
});
app.post("/api/admin/payouts/:id/process", async (req, res) => {
  const ctx = await requirePermission(req, res, "billing.read");
  if (!ctx) return;
  const { id } = req.params;
  const action = req.body?.action;
  const utrNumber = String(req.body?.utrNumber || "").trim();
  const adminNotes = String(req.body?.adminNotes || "").trim();
  if (action !== "PAID" && action !== "REJECTED") {
    return res.status(400).json({ error: "Action must be either PAID or REJECTED." });
  }
  if (action === "PAID" && !utrNumber) {
    return res.status(400).json({ error: "Please enter a UTR or Transaction Reference number." });
  }
  if (action === "REJECTED" && !adminNotes) {
    return res.status(400).json({ error: "Please provide a reason for rejecting this payout request." });
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const processedBy = ctx.user?.email || "Admin";
  const all = readPayoutRequests();
  const target = all.find((r) => r.id === id);
  if (target) {
    target.status = action;
    target.utrNumber = utrNumber || void 0;
    target.adminNotes = adminNotes || void 0;
    target.processedAt = now;
    target.processedBy = processedBy;
    writePayoutRequests(all);
  }
  if (useSupabase) {
    try {
      await supabase.from("partner_payout_requests").update({
        status: action,
        utr_number: utrNumber || null,
        admin_notes: adminNotes || null,
        processed_at: now,
        processed_by: processedBy
      }).eq("id", id);
    } catch {
    }
    try {
      const { data: users } = await supabase.from("users").select("id, preferences");
      for (const u of users || []) {
        if (Array.isArray(u?.preferences?.payoutRequests)) {
          const matched = u.preferences.payoutRequests.find((r) => r.id === id);
          if (matched) {
            matched.status = action;
            matched.utrNumber = utrNumber || void 0;
            matched.adminNotes = adminNotes || void 0;
            matched.processedAt = now;
            matched.processedBy = processedBy;
            await supabase.from("users").update({ preferences: u.preferences }).eq("id", u.id);
            break;
          }
        }
      }
    } catch {
    }
  }
  await writeAuditLog(req, ctx, `partner.payout_${action.toLowerCase()}`, "payout", id, {
    action,
    utrNumber,
    adminNotes,
    amount: target?.amount
  });
  res.json({
    success: true,
    message: action === "PAID" ? `Payout marked as PAID (UTR: ${utrNumber})` : "Payout request rejected.",
    request: target
  });
});
app.get("/api/admin/partners", async (req, res) => {
  const ctx = await requirePermission(req, res, "partner.manage");
  if (!ctx) return;
  let partners = [];
  let profiles = {};
  let counts = {};
  let sharing = {};
  const income = {};
  const paidCounts = {};
  const creditPayment = (referrerId, amount) => {
    if (!referrerId) return;
    income[referrerId] = (income[referrerId] || 0) + Math.max(0, amount - PARTNER_PLATFORM_FLOOR_INR);
    paidCounts[referrerId] = (paidCounts[referrerId] || 0) + 1;
  };
  if (!useSupabase) {
    const all = localAllUsers();
    partners = all.filter((u) => u.role === "PARTNER");
    for (const p of readPartnerProfiles()) profiles[p.userId] = p.referralCode;
    const referrerOf = {};
    for (const u of all) {
      if (!u.referredBy) continue;
      referrerOf[u.id] = u.referredBy;
      counts[u.referredBy] = (counts[u.referredBy] || 0) + 1;
      if (u.allowPartnerTradeView === true) sharing[u.referredBy] = (sharing[u.referredBy] || 0) + 1;
    }
    for (const pay of localAllPayments()) {
      if (String(pay.status || "").toLowerCase() !== "captured") continue;
      creditPayment(referrerOf[pay.userId || pay.user_id], Number(pay.amount) || 0);
    }
  } else {
    const [{ data: ps }, { data: prof }, { data: refs }] = await Promise.all([
      supabase.from("users").select("id, email, name, is_pro, status, created_at").eq("role", "PARTNER"),
      supabase.from("partner_profiles").select("user_id, referral_code"),
      supabase.from("users").select("id, referred_by, allow_partner_trade_view").not("referred_by", "is", null)
    ]);
    partners = (ps || []).map(toCamel);
    for (const p of prof || []) profiles[p.user_id] = p.referral_code;
    const referrerOf = {};
    for (const r of refs || []) {
      const key = r.referred_by;
      referrerOf[r.id] = key;
      counts[key] = (counts[key] || 0) + 1;
      if (r.allow_partner_trade_view) sharing[key] = (sharing[key] || 0) + 1;
    }
    const referredIds = Object.keys(referrerOf);
    if (referredIds.length > 0) {
      const { data: pays } = await supabase.from("payments").select("user_id, amount, status").in("user_id", referredIds).eq("status", "captured");
      for (const pay of pays || []) {
        creditPayment(referrerOf[pay.user_id], Number(pay.amount) || 0);
      }
    }
  }
  res.json({
    partners: partners.map((p) => ({
      id: p.id,
      name: p.name || String(p.email || "").split("@")[0],
      email: p.email,
      isPro: !!(p.isPro ?? p.is_pro),
      status: p.status || "ACTIVE",
      joinedAt: p.createdAt || p.created_at || null,
      referralCode: profiles[p.id] || null,
      referralUrl: profiles[p.id] ? partnerReferralUrl(req, profiles[p.id]) : null,
      linkedUsers: counts[p.id] || 0,
      sharingTrades: sharing[p.id] || 0,
      paidReferrals: paidCounts[p.id] || 0,
      referralIncome: Math.round((income[p.id] || 0) * 100) / 100
    })).sort((a, b) => b.referralIncome - a.referralIncome || b.linkedUsers - a.linkedUsers),
    totals: {
      partners: partners.length,
      linkedUsers: Object.values(counts).reduce((a, b) => a + b, 0),
      paidReferrals: Object.values(paidCounts).reduce((a, b) => a + b, 0),
      referralIncome: Math.round(Object.values(income).reduce((a, b) => a + b, 0) * 100) / 100,
      platformFloor: PARTNER_PLATFORM_FLOOR_INR
    }
  });
});
app.get("/api/admin/check", async (req, res) => {
  const currentUser = req.currentUser;
  const role = await getAdminRole(currentUser);
  res.json({
    isAdmin: ADMIN_ROLES.has(role),
    role,
    permissions: ROLE_PERMISSIONS[role] || []
  });
});
app.get("/api/admin/users", async (req, res) => {
  let db = req.userDb;
  const ctx = await requirePermission(req, res, "users.read");
  if (!ctx) return;
  const scope = await scopeUserIds(ctx.role, ctx.user?.id || null);
  if (useSupabase) {
    let allUsers = null;
    const ordered = await supabase.from("users").select("*").order("last_login", { ascending: false, nullsFirst: false });
    if (ordered.error) {
      const fallback = await supabase.from("users").select("*").order("created_at", { ascending: false });
      allUsers = fallback.data;
    } else {
      allUsers = ordered.data;
    }
    if (scope !== null) allUsers = (allUsers || []).filter((u) => scope.includes(u.id));
    const { data: allAccounts } = await supabase.from("trading_accounts").select("*");
    const { data: allTrades } = await supabase.from("trades").select("id, user_id, account_id");
    const { data: allPays } = await supabase.from("payments").select("user_id, amount, status");
    const earnedByReferrer2 = referralEarningsByReferrer(
      (allUsers || []).map((u) => ({ id: u.id, referredBy: u.referred_by })),
      allPays || []
    );
    const usersWithStats2 = (allUsers || []).map((u) => {
      const uAccounts = (allAccounts || []).filter((acc) => acc.user_id === u.id);
      const accIds = new Set(uAccounts.map((a) => a.id));
      const uTrades = (allTrades || []).filter((t) => t.user_id === u.id || accIds.has(t.account_id));
      const refCode = u.referral_code || ("FX-" + (u.id || "").replace(/\D/g, "").slice(-4).padStart(4, "8") || "FX-100");
      const directReferrals = (allUsers || []).filter(
        (other) => other.referred_by && (other.referred_by === u.id || other.referred_by === refCode)
      ).length;
      return {
        ...sanitizeUser(toCamel(u)),
        accountsCount: uAccounts.length,
        tradesCount: uTrades.length,
        referralCode: refCode,
        referralCount: directReferrals,
        referralIncome: (earnedByReferrer2[u.id] || 0) + (earnedByReferrer2[refCode] || 0),
        isPro: !!u.is_pro
      };
    });
    return res.json({ users: usersWithStats2 });
  }
  db = loadDatabaseFromFile();
  const everyone = localAllUsers();
  const visibleUsers = scope === null ? everyone : everyone.filter((u) => scope.includes(u.id));
  const earnedByReferrer = referralEarningsByReferrer(everyone, localAllPayments());
  const usersWithStats = visibleUsers.map((u) => {
    const uAccounts = (db.accounts || []).filter((acc) => acc.userId === u.id);
    const accIds = uAccounts.map((a) => a.id);
    const uTrades = (db.trades || []).filter((t) => accIds.includes(t.accountId) || t.userId === u.id);
    const refCode = u.referralCode || ("FX-" + (u.id || "").replace(/\D/g, "").slice(-4).padStart(4, "8") || "FX-100");
    const directReferrals = everyone.filter(
      (other) => other.referredBy && (other.referredBy === u.id || other.referredBy === refCode)
    ).length;
    return {
      ...sanitizeUser(u),
      accountsCount: uAccounts.length,
      tradesCount: uTrades.length,
      referralCode: refCode,
      referralCount: directReferrals,
      referralIncome: (earnedByReferrer[u.id] || 0) + (earnedByReferrer[refCode] || 0),
      isPro: !!u.isPro
    };
  });
  res.json({ users: usersWithStats });
});
app.get("/api/admin/inspect-user/:id", async (req, res) => {
  const ctx = await requirePermission(req, res, "users.read");
  if (!ctx) return;
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "User ID is required" });
  const scope = await scopeUserIds(ctx.role, ctx.user?.id || null);
  if (!canSeeUser(scope, id)) return res.status(404).json({ error: "Target user not found" });
  if (ctx.role === "PARTNER" && !await readTradeConsent(id)) {
    return res.status(403).json({
      error: "This user has not shared their trading data with you.",
      code: "TRADE_ACCESS_DENIED"
    });
  }
  if (useSupabase) {
    const [
      { data: targetUser },
      { data: accounts2 },
      { data: trades2 },
      { data: riskSettings2 }
    ] = await Promise.all([
      supabase.from("users").select("*").eq("id", id).maybeSingle(),
      supabase.from("trading_accounts").select("*").eq("user_id", id),
      supabase.from("trades").select("*").eq("user_id", id),
      supabase.from("risk_settings").select("*").eq("user_id", id).maybeSingle()
    ]);
    if (!targetUser) return res.status(404).json({ error: "Target user not found" });
    let finalTrades = trades2 || [];
    if (accounts2 && accounts2.length > 0) {
      const accIds = accounts2.map((a) => a.id);
      const { data: accTrades } = await supabase.from("trades").select("*").in("account_id", accIds);
      if (accTrades && accTrades.length > 0) {
        const existingIds = new Set(finalTrades.map((t) => t.id));
        for (const t of accTrades) {
          if (!existingIds.has(t.id)) finalTrades.push(t);
        }
      }
    }
    return res.json({
      user: sanitizeUser(toCamel(targetUser)),
      accounts: (accounts2 || []).map(toCamel),
      trades: finalTrades.map(toCamel),
      riskSettings: riskSettings2 ? toCamel(riskSettings2) : null
    });
  }
  let allDbs = [];
  try {
    const fileDb = loadDatabaseFromFile();
    if (fileDb) allDbs.push(fileDb);
  } catch (e) {
  }
  try {
    const loaded = await ensureUserDbLoaded(id);
    if (loaded) allDbs.push(loaded);
  } catch (e) {
  }
  for (const [, uDb] of userDatabases.entries()) {
    allDbs.push(uDb);
  }
  let foundUser = null;
  let accounts = [];
  let trades = [];
  let riskSettings = null;
  for (const d of allDbs) {
    const u = d.users?.find((x) => x.id === id || x.email === id);
    if (u) {
      foundUser = u;
      const accs = (d.accounts || []).filter((a) => a.userId === u.id || a.user_id === u.id || a.userId === id);
      const accIds = new Set(accs.map((a) => a.id));
      accounts = accs;
      trades = (d.trades || []).filter(
        (t) => t.userId === u.id || t.user_id === u.id || t.userId === id || accIds.has(t.accountId) || accIds.has(t.account_id)
      );
      riskSettings = (d.riskSettings || []).find((r) => r.userId === u.id || r.userId === id) || null;
      break;
    }
  }
  if (!foundUser) {
    const mainDb = req.userDb;
    const u = mainDb?.users?.find((x) => x.id === id || x.email === id);
    if (u) {
      foundUser = u;
      const accs = (mainDb.accounts || []).filter((a) => a.userId === u.id || a.userId === id);
      const accIds = new Set(accs.map((a) => a.id));
      accounts = accs;
      trades = (mainDb.trades || []).filter(
        (t) => t.userId === u.id || t.userId === id || accIds.has(t.accountId)
      );
      riskSettings = (mainDb.riskSettings || []).find((r) => r.userId === u.id || r.userId === id) || null;
    }
  }
  if (!foundUser) return res.status(404).json({ error: "User not found" });
  res.json({
    user: sanitizeUser(foundUser),
    accounts,
    trades,
    riskSettings
  });
});
app.post("/api/admin/announcements", async (req, res) => {
  let db = req.userDb;
  const ctx = await requirePermission(req, res, "announcements.manage");
  if (!ctx) return;
  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: "Title and content are required" });
  const newAnn = {
    id: `ann_${crypto2.randomUUID()}`,
    title,
    content,
    date: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (useSupabase) {
    const { error } = await supabase.from("announcements").insert({
      id: newAnn.id,
      title: newAnn.title,
      content: newAnn.content,
      date: newAnn.date
    });
    if (error) {
      console.error("[POST /api/admin/announcements] Supabase insert failed:", error);
      return res.status(500).json({ error: "Failed to publish announcement" });
    }
    await writeAuditLog(req, ctx, "announcement.publish", "announcement", newAnn.id, { title });
    return res.json({ message: "Announcement published successfully", announcement: newAnn });
  }
  db.announcements = db.announcements || [];
  db.announcements.unshift(newAnn);
  await saveDatabase(db);
  res.json({ message: "Announcement published successfully", announcement: newAnn });
});
app.post("/api/admin/block-user", async (req, res) => {
  let db = req.userDb;
  const ctx = await requirePermission(req, res, "users.manage");
  if (!ctx) return;
  const { userId, block } = req.body;
  if (!userId) return res.status(400).json({ error: "userId is required" });
  if (useSupabase) {
    const { data, error } = await supabase.from("users").update({ status: block ? "Blocked" : "Active" }).eq("id", userId).select("id").maybeSingle();
    if (error) {
      console.error("[POST /api/admin/block-user] Supabase error:", error);
      return res.status(500).json({ error: "Failed to update user" });
    }
    if (!data) return res.status(404).json({ error: "User not found" });
    userDatabases.delete(userId);
    await writeAuditLog(req, ctx, block ? "user.block" : "user.unblock", "user", userId);
    return res.json({ message: block ? "User blocked" : "User unblocked" });
  }
  const idx = db.users.findIndex((u) => u.id === userId);
  if (idx !== -1) {
    db.users[idx].status = block ? "Blocked" : "Active";
    await saveDatabase(db);
    res.json({ message: block ? "User blocked" : "User unblocked" });
  } else {
    res.status(404).json({ error: "User not found" });
  }
});
var capturedRevenue = (payments) => {
  let total = 0;
  for (const p of payments || []) {
    if (String(p?.status || "").toLowerCase() !== "captured") continue;
    total += Number(p.amount) || 0;
  }
  return total;
};
var summarisePaymentTotals = (payments, referrerOf) => {
  let totalRevenue = 0;
  let referralIncome = 0;
  let paidReferrals = 0;
  for (const pay of payments || []) {
    if (String(pay?.status || "").toLowerCase() !== "captured") continue;
    const amount = Number(pay.amount) || 0;
    totalRevenue += amount;
    const userId = pay.userId || pay.user_id;
    if (userId && referrerOf[userId]) {
      referralIncome += Math.max(0, amount - PARTNER_PLATFORM_FLOOR_INR);
      paidReferrals += 1;
    }
  }
  return { totalRevenue, referralIncome, paidReferrals };
};
app.get("/api/admin/dashboard", async (req, res) => {
  const ctx = await requirePermission(req, res, "dashboard.read");
  if (!ctx) return;
  const scope = await scopeUserIds(ctx.role, ctx.user?.id || null);
  if (useSupabase) {
    const [{ data: rawUsers }, { data: rawTrades }, { data: allTickets }, { data: rawPayments }] = await Promise.all([
      supabase.from("users").select("id, status, created_at, is_pro, referral_code, referred_by"),
      supabase.from("trades").select("id, user_id"),
      supabase.from("support_tickets").select("id, status"),
      supabase.from("payments").select("user_id, amount, status")
    ]);
    const allUsers = scope === null ? rawUsers : (rawUsers || []).filter((u) => scope.includes(u.id));
    const allTrades = scope === null ? rawTrades : (rawTrades || []).filter((t) => scope.includes(t.user_id));
    const totalUsers2 = allUsers?.length || 0;
    const activeUsers2 = (allUsers || []).filter((u) => u.status === "ACTIVE" || !u.status).length;
    const paidUsers2 = (allUsers || []).filter((u) => !!u.is_pro).length;
    const freeUsers2 = Math.max(0, totalUsers2 - paidUsers2);
    const totalTrades2 = allTrades?.length || 0;
    const pendingTickets = (allTickets || []).filter((t) => t.status === "Open" || t.status === "In Progress").length;
    const totalReferrals2 = (allUsers || []).filter((u) => !!u.referred_by).length;
    const referrerOf = {};
    for (const u of allUsers || []) {
      if (u.referred_by) referrerOf[u.id] = u.referred_by;
    }
    const scopedPayments = scope === null ? rawPayments || [] : (rawPayments || []).filter((p) => scope.includes(p.user_id));
    const { totalRevenue: totalRevenue2, referralIncome: referralIncome2, paidReferrals: paidReferrals2 } = summarisePaymentTotals(scopedPayments, referrerOf);
    const dayBuckets = {};
    const sorted = (allUsers || []).filter((u) => u.created_at).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    for (const u of sorted) {
      const day = new Date(u.created_at).toISOString().slice(0, 10);
      dayBuckets[day] = (dayBuckets[day] || 0) + 1;
    }
    const userGrowth = Object.entries(dayBuckets).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));
    let cum = 0;
    for (const entry of userGrowth) {
      cum += entry.count;
      entry.count = cum;
    }
    return res.json({
      totalUsers: totalUsers2,
      activeUsers: activeUsers2,
      paidUsers: paidUsers2,
      freeUsers: freeUsers2,
      referralIncome: referralIncome2,
      paidReferrals: paidReferrals2,
      totalReferrals: totalReferrals2,
      totalTrades: totalTrades2,
      totalRevenue: totalRevenue2,
      pendingTickets,
      userGrowth
    });
  }
  const db = loadDatabaseFromFile();
  const allLocalUsers = localAllUsers();
  const usersList = scope === null ? allLocalUsers : allLocalUsers.filter((u) => scope.includes(u.id));
  const totalUsers = usersList.length;
  const activeUsers = usersList.filter((u) => u.status === "ACTIVE" || !u.status).length;
  const paidUsers = usersList.filter((u) => !!u.isPro).length;
  const freeUsers = Math.max(0, totalUsers - paidUsers);
  const totalTrades = (scope === null ? db?.trades || [] : (db?.trades || []).filter((t) => scope.includes(t.userId))).length;
  const totalReferrals = usersList.filter((u) => !!u.referredBy).length;
  const localReferrerOf = {};
  for (const u of usersList) {
    if (u.referredBy) localReferrerOf[u.id] = u.referredBy;
  }
  const localPayments = scope === null ? localAllPayments() : localAllPayments().filter((p) => scope.includes(p.userId || p.user_id));
  const { totalRevenue, referralIncome, paidReferrals } = summarisePaymentTotals(localPayments, localReferrerOf);
  res.json({
    totalUsers,
    activeUsers,
    paidUsers,
    freeUsers,
    referralIncome,
    paidReferrals,
    totalReferrals,
    totalTrades,
    totalRevenue,
    pendingTickets: db?.supportTickets?.filter((t) => t.status === "Open").length || 0,
    userGrowth: []
  });
});
app.post("/api/admin/users/:id/status", async (req, res) => {
  const ctx = await requirePermission(req, res, "users.manage");
  if (!ctx) return;
  const { id } = req.params;
  const { status } = req.body;
  if (useSupabase) {
    const { error } = await supabase.from("users").update({ status }).eq("id", id);
    if (error) {
      console.error("Error updating supabase user:", error);
      return res.status(500).json({ error: "Failed to update user status" });
    }
    await writeAuditLog(req, ctx, "user.status", "user", id, { status });
    return res.json({ message: `User status updated to ${status}` });
  }
  const db = req.userDb;
  const idx = db?.users?.findIndex((u) => u.id === id);
  if (idx !== void 0 && idx !== -1) {
    db.users[idx].status = status;
    res.json({ message: `User status updated to ${status}` });
  } else {
    res.status(404).json({ error: "User not found" });
  }
});
app.post("/api/admin/users/:id/plan", async (req, res) => {
  const ctx = await requirePermission(req, res, "users.manage");
  if (!ctx) return;
  const { id } = req.params;
  const { isPro } = req.body;
  if (useSupabase) {
    const { error } = await supabase.from("users").update({
      is_pro: !!isPro,
      pro_until: isPro ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1e3).toISOString() : null
    }).eq("id", id);
    if (error) {
      console.error("Error updating user plan:", error);
      return res.status(500).json({ error: "Failed to update user plan" });
    }
    userDatabases.delete(id);
    await writeAuditLog(req, ctx, isPro ? "user.grant_pro" : "user.revoke_pro", "user", id);
    return res.json({ message: `User plan updated to ${isPro ? "Pro" : "Free"}` });
  }
  const target = localFindUser((u) => u.id === id);
  if (!target) return res.status(404).json({ error: "User not found" });
  await applyProState(id, isPro ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1e3) : null);
  await writeAuditLog(req, ctx, isPro ? "user.grant_pro" : "user.revoke_pro", "user", id);
  res.json({ message: `User plan updated to ${isPro ? "Pro" : "Free"}` });
});
app.get("/api/admin/bugs", async (req, res) => {
  const ctx = await requirePermission(req, res, "tickets.read");
  if (!ctx) return;
  if (useSupabase) {
    const { data, error } = await supabase.from("support_tickets").select("*").eq("category", "Bug").order("date", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const tickets2 = await attachTicketUserNames(data || []);
    const bugs2 = tickets2.map((t) => {
      const m = /Severity:\s*(\w+)/i.exec(t.title || "");
      return { ...t, priority: (m?.[1] || "Low").toUpperCase() };
    });
    return res.json({ bugs: bugs2 });
  }
  const tickets = await attachTicketUserNames(
    collectAllInMemoryTickets().filter((t) => t.category === "Bug")
  );
  const bugs = tickets.map((t) => {
    const m = /Severity:\s*(\w+)/i.exec(t.title || "");
    return { ...t, priority: (m?.[1] || "Low").toUpperCase() };
  });
  res.json({ bugs });
});
app.get("/api/admin/team", async (req, res) => {
  const ctx = await requirePermission(req, res, "users.roles");
  if (!ctx) return;
  if (!useSupabase) {
    const team = localAllUsers().filter((u) => ["SUPER_ADMIN", "ADMIN", "SUB_ADMIN", "PARTNER", "SUPPORT"].includes(u.role || "")).map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role || "ADMIN",
      status: u.status || "ACTIVE",
      lastLogin: u.lastLogin
    }));
    return res.json({
      team,
      roles: Object.keys(ROLE_PERMISSIONS).filter((r) => r !== "USER"),
      permissions: ROLE_PERMISSIONS
    });
  }
  const { data, error } = await supabase.from("users").select("id, email, name, role, status, last_login").in("role", ["SUPER_ADMIN", "ADMIN", "SUB_ADMIN", "SUPPORT"]).order("role");
  if (error) {
    console.error("[GET /api/admin/team] error:", error);
    return res.status(500).json({ error: "Failed to load team" });
  }
  res.json({
    team: (data || []).map(toCamel),
    roles: Object.keys(ROLE_PERMISSIONS).filter((r) => r !== "USER"),
    permissions: ROLE_PERMISSIONS
  });
});
app.post("/api/admin/team/role", async (req, res) => {
  const ctx = await requirePermission(req, res, "users.roles");
  if (!ctx) return;
  const { email, role } = req.body || {};
  const targetEmail = String(email || "").toLowerCase().trim();
  if (!targetEmail || !role) return res.status(400).json({ error: "email and role are required" });
  if (!ROLE_PERMISSIONS[role]) {
    return res.status(400).json({ error: `role must be one of: ${Object.keys(ROLE_PERMISSIONS).join(", ")}` });
  }
  if (targetEmail === String(ctx.user?.email || "").toLowerCase() && role !== "SUPER_ADMIN") {
    return res.status(400).json({ error: "You cannot remove your own owner access. Ask another owner to do it." });
  }
  if (useSupabase) {
    const { data: target2 } = await supabase.from("users").select("id, role").eq("email", targetEmail).maybeSingle();
    if (!target2) return res.status(404).json({ error: "No account with that email." });
    if (target2.role === "SUPER_ADMIN" && role !== "SUPER_ADMIN") {
      const { count } = await supabase.from("users").select("id", { count: "exact", head: true }).eq("role", "SUPER_ADMIN");
      if ((count ?? 0) <= 1) {
        return res.status(400).json({ error: "This is the last owner account. Promote someone else first." });
      }
    }
    const { error } = await supabase.from("users").update({ role }).eq("id", target2.id);
    if (error) {
      console.error("[POST /api/admin/team/role] error:", error);
      return res.status(500).json({ error: "Failed to update role" });
    }
    userDatabases.delete(target2.id);
    await writeAuditLog(req, ctx, "user.role", "user", target2.id, { email: targetEmail, from: target2.role, to: role });
    return res.json({ message: `${targetEmail} is now ${role}.` });
  }
  const target = localFindUser((u) => u.email?.toLowerCase() === targetEmail);
  if (!target) return res.status(404).json({ error: "No account with that email." });
  const prevRole = target.role || "USER";
  localPatchUser(target.id, (row) => {
    row.role = role;
  });
  await writeAuditLog(req, ctx, "user.role", "user", target.id, { email: targetEmail, from: prevRole, to: role });
  res.json({ message: `${targetEmail} is now ${role}.` });
});
app.get("/api/admin/audit", async (req, res) => {
  const ctx = await requirePermission(req, res, "audit.read");
  if (!ctx) return;
  if (!useSupabase) {
    return res.json({ entries: inMemoryAuditLogs.slice(0, 100) });
  }
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || "100"), 10) || 100, 1), 500);
  const { data, error } = await supabase.from("admin_audit_logs").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) {
    console.error("[GET /api/admin/audit] error:", error);
    return res.status(500).json({ error: "Failed to load the audit log" });
  }
  res.json({ entries: (data || []).map(toCamel) });
});
app.get("/api/admin/billing", async (req, res) => {
  const ctx = await requirePermission(req, res, "billing.read");
  if (!ctx) return;
  if (!useSupabase) {
    const allUsers = localAllUsers();
    const paidUsers = allUsers.filter((u) => !!u.isPro);
    const freeUsers = Math.max(0, allUsers.length - paidUsers.length);
    const earnedByReferrer2 = referralEarningsByReferrer(allUsers, localAllPayments());
    const referralLeaderboard2 = allUsers.map((u) => {
      const refCode = u.referralCode || ("FX-" + (u.id || "").replace(/\D/g, "").slice(-4).padStart(4, "8") || "FX-100");
      const directRefs = allUsers.filter((o) => o.referredBy && (o.referredBy === u.id || o.referredBy === refCode));
      const paidRefs = directRefs.filter((o) => !!o.isPro).length;
      return {
        userId: u.id,
        name: u.name || "Trader",
        email: u.email,
        referralCode: refCode,
        referralsCount: directRefs.length,
        paidReferralsCount: paidRefs,
        referralIncome: (earnedByReferrer2[u.id] || 0) + (earnedByReferrer2[refCode] || 0)
      };
    }).filter((r) => r.referralsCount > 0).sort((a, b) => b.referralsCount - a.referralsCount);
    const totalReferralIncome2 = referralLeaderboard2.reduce((acc, r) => acc + r.referralIncome, 0);
    const payments2 = localAllPayments();
    return res.json({
      payments: payments2,
      subscriptions: [],
      activeCount: paidUsers.length,
      freeCount: freeUsers,
      totalUsers: allUsers.length,
      mrr: paidUsers.length * (PRO_PLAN_AMOUNT_PAISE / 100),
      totalRevenue: capturedRevenue(payments2),
      currency: "INR",
      totalReferralIncome: totalReferralIncome2,
      referralLeaderboard: referralLeaderboard2
    });
  }
  const [{ data: payments }, { data: subs }, { data: users }] = await Promise.all([
    supabase.from("payments").select("*").order("paid_at", { ascending: false }).limit(100),
    supabase.from("subscriptions").select("*").order("created_at", { ascending: false }).limit(200),
    supabase.from("users").select("id, email, name, is_pro, referral_code, referred_by")
  ]);
  const userMap = new Map((users || []).map((u) => [u.id, u]));
  const enrichedPayments = (payments || []).map((p) => {
    const u = userMap.get(p.user_id);
    return {
      ...toCamel(p),
      // No invented address: this defaulted to 'subscriber@axyfx.com', so a
      // payment whose user row had been deleted was attributed to an account
      // that does not exist.
      userEmail: u?.email || p.user_email || null,
      userName: u?.name || "Trader"
    };
  });
  const activeSubs = (subs || []).filter((s) => s.status === "active");
  const paidUsersCount = (users || []).filter((u) => !!u.is_pro).length;
  const freeUsersCount = Math.max(0, (users?.length || 0) - paidUsersCount);
  const earnedByReferrer = referralEarningsByReferrer(
    (users || []).map((u) => ({ id: u.id, referredBy: u.referred_by })),
    payments || []
  );
  const referralLeaderboard = (users || []).map((u) => {
    const refCode = u.referral_code || ("FX-" + (u.id || "").replace(/\D/g, "").slice(-4).padStart(4, "8") || "FX-100");
    const directRefs = (users || []).filter((o) => o.referred_by && (o.referred_by === u.id || o.referred_by === refCode));
    const paidRefs = directRefs.filter((o) => !!o.is_pro).length;
    return {
      userId: u.id,
      name: u.name || "Trader",
      email: u.email,
      referralCode: refCode,
      referralsCount: directRefs.length,
      paidReferralsCount: paidRefs,
      referralIncome: (earnedByReferrer[u.id] || 0) + (earnedByReferrer[refCode] || 0)
    };
  }).filter((r) => r.referralsCount > 0).sort((a, b) => b.referralsCount - a.referralsCount);
  const totalReferralIncome = referralLeaderboard.reduce((acc, r) => acc + r.referralIncome, 0);
  const totalRev = capturedRevenue(payments || []);
  res.json({
    payments: enrichedPayments,
    subscriptions: (subs || []).map(toCamel),
    activeCount: activeSubs.length || paidUsersCount,
    freeCount: freeUsersCount,
    totalUsers: users?.length || 0,
    mrr: (activeSubs.length || paidUsersCount) * (PRO_PLAN_AMOUNT_PAISE / 100),
    totalRevenue: totalRev,
    currency: "INR",
    totalReferralIncome,
    referralLeaderboard
  });
});
app.post("/api/admin/payments/record", async (req, res) => {
  const ctx = await requirePermission(req, res, "users.manage");
  if (!ctx) return;
  const {
    userEmail,
    userId,
    amount = PRO_PLAN_AMOUNT_PAISE / 100,
    method = "upi",
    notes = "",
    plan = "pro",
    days = 30
  } = req.body || {};
  if (!userEmail && !userId) {
    return res.status(400).json({ error: "User email or user ID is required" });
  }
  let targetUser = null;
  if (useSupabase) {
    const query = userId ? supabase.from("users").select("*").eq("id", userId).maybeSingle() : supabase.from("users").select("*").eq("email", userEmail.trim().toLowerCase()).maybeSingle();
    const { data } = await query;
    targetUser = data;
  } else {
    const wanted = userEmail ? userEmail.trim().toLowerCase() : "";
    targetUser = localFindUser(
      (u) => userId && u.id === userId || !!wanted && u.email?.toLowerCase() === wanted
    );
  }
  if (!targetUser) {
    return res.status(404).json({ error: "Trader account not found" });
  }
  const paymentId = `pay_manual_${crypto2.randomUUID().slice(0, 8)}`;
  const proUntilDate = new Date(Date.now() + days * 864e5);
  await applyProState(targetUser.id, proUntilDate);
  const paymentRecord = {
    id: paymentId,
    user_id: targetUser.id,
    provider: "manual",
    // randomUUID, not Date.now(): provider_payment_id is UNIQUE, and it is
    // what claimPayment dedupes on. Two offline payments recorded in the same
    // millisecond would have collided on it.
    provider_payment_id: `manual_${crypto2.randomUUID()}`,
    amount: Number(amount),
    currency: "INR",
    plan,
    status: "captured",
    paid_at: (/* @__PURE__ */ new Date()).toISOString(),
    created_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (useSupabase) {
    await supabase.from("payments").insert(paymentRecord);
  } else {
    const row = { ...toCamel(paymentRecord), userEmail: targetUser.email };
    try {
      const fileDb = loadDatabaseFromFile();
      fileDb.payments = fileDb.payments || [];
      fileDb.payments.unshift(row);
      fs.writeFileSync(DB_FILE, JSON.stringify(fileDb, null, 2), "utf-8");
    } catch (err) {
      console.error("[payments/record] file write failed:", err);
    }
    const db = req.userDb;
    if (db) {
      db.payments = db.payments || [];
      if (!db.payments.some((p) => p.id === row.id)) db.payments.unshift(row);
    }
  }
  await writeAuditLog(req, ctx, "payment.manual_record", "payment", paymentId, {
    targetUserId: targetUser.id,
    targetEmail: targetUser.email,
    amount,
    method,
    notes,
    proUntil: proUntilDate.toISOString()
  });
  res.json({
    success: true,
    message: `Recorded \u20B9${amount} offline payment for ${targetUser.email}. Pro plan activated for ${days} days.`,
    paymentId,
    proUntil: proUntilDate.toISOString()
  });
});
app.get("/api/admin/features", async (req, res) => {
  const ctx = await requirePermission(req, res, "tickets.read");
  if (!ctx) return;
  if (useSupabase) {
    const { data, error } = await supabase.from("support_tickets").select("*").eq("category", "Feature Request").order("date", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const features2 = await attachTicketUserNames(data || []);
    return res.json({ features: features2 });
  }
  const features = await attachTicketUserNames(
    collectAllInMemoryTickets().filter((t) => t.category === "Feature Request")
  );
  res.json({ features });
});
var ALPHA_VANTAGE_BASE = (process.env.ALPHA_VANTAGE_BASE_URL || "https://www.alphavantage.co").trim().replace(/\/+$/, "");
var FMP_BASE = (process.env.FMP_BASE_URL || "https://financialmodelingprep.com").trim().replace(/\/+$/, "");
var FINNHUB_BASE = (process.env.FINNHUB_BASE_URL || "https://finnhub.io").trim().replace(/\/+$/, "");
var XOOMAR_BASE = (process.env.XOOMAR_BASE_URL || "https://xoomar.com").trim().replace(/\/+$/, "");
var apiCache = /* @__PURE__ */ new Map();
function getCached(key) {
  const entry = apiCache.get(key);
  if (!entry) return void 0;
  if (Date.now() > entry.expiresAt) {
    apiCache.delete(key);
    return void 0;
  }
  return entry.data;
}
function setCached(key, data, ttlMs) {
  apiCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}
async function fetchJson(url, timeoutMs = 15e3) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "FXJournalPro/1.0", Accept: "application/json" }
    });
    if (!res.ok) {
      const err = new Error(`Upstream API responded with ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
var NEWS_CATEGORY_ORDER = [
  "Market Analysis",
  "Central Banks",
  "Interest Rates",
  "Inflation",
  "Employment",
  "GDP",
  "Commodities",
  "Geopolitics",
  "Government"
];
var AV_TOPIC_CATEGORY = {
  financial_markets: "Market Analysis",
  economy_monetary: "Central Banks",
  economy_fiscal: "Government",
  economy_macro: "GDP",
  energy_transportation: "Commodities",
  technology: "Market Analysis",
  mergers_and_acquisitions: "Market Analysis",
  retail_wholesale: "Market Analysis"
};
var FX_NEWS_TOPICS = "financial_markets,economy_monetary,economy_macro,economy_fiscal";
var CURRENCY_NAMES = {
  USD: "U.S. Dollar",
  EUR: "Euro",
  GBP: "British Pound",
  JPY: "Japanese Yen",
  AUD: "Australian Dollar",
  CAD: "Canadian Dollar",
  CHF: "Swiss Franc",
  NZD: "New Zealand Dollar",
  CNY: "Chinese Yuan"
};
var MAJOR_PAIRS = [
  "EUR/USD",
  "USD/JPY",
  "GBP/USD",
  "USD/CHF",
  "AUD/USD",
  "USD/CAD",
  "NZD/USD",
  "EUR/GBP",
  "EUR/JPY",
  "GBP/JPY",
  "EUR/CHF",
  "EUR/AUD",
  "AUD/JPY",
  "USD/CNY",
  "USD/CNH"
];
function mapTopicToCategory(topics) {
  for (const t of topics) {
    const mapped = AV_TOPIC_CATEGORY[t.toLowerCase()];
    if (mapped) return mapped;
  }
  return "Market Analysis";
}
function deriveSentimentLabel(score) {
  if (score === null) return "Neutral";
  if (score >= 0.35) return "Bullish";
  if (score <= -0.35) return "Bearish";
  if (score > 0.1) return "Somewhat Bullish";
  if (score < -0.1) return "Somewhat Bearish";
  return "Neutral";
}
function detectCurrenciesAndPairs(text, tickers) {
  const currencies = /* @__PURE__ */ new Set();
  const pairs = /* @__PURE__ */ new Set();
  const upper = ` ${text.toUpperCase()} `;
  for (const pair of MAJOR_PAIRS) {
    if (upper.includes(pair)) {
      pairs.add(pair);
      const [a, b] = pair.split("/");
      if (CURRENCY_NAMES[a]) currencies.add(a);
      if (CURRENCY_NAMES[b]) currencies.add(b);
    }
  }
  for (const code of Object.keys(CURRENCY_NAMES)) {
    if (new RegExp(`\\b${code}\\b`).test(upper)) currencies.add(code);
  }
  for (const tk of tickers || []) {
    const clean = tk.replace(/^FOREX:+/i, "").replace(/[^A-Za-z/]/g, "");
    const m = /^([A-Z]{3})\/?([A-Z]{3})$/.exec(clean);
    if (m) {
      if (CURRENCY_NAMES[m[1]] && CURRENCY_NAMES[m[2]]) {
        pairs.add(`${m[1]}/${m[2]}`);
        currencies.add(m[1]);
        currencies.add(m[2]);
      } else if (CURRENCY_NAMES[m[1]]) {
        currencies.add(m[1]);
      }
    }
  }
  return {
    currencies: Array.from(currencies),
    pairs: Array.from(pairs)
  };
}
function normalizeNewsArticle(item) {
  const title = (item?.title || "").trim();
  if (!title) return null;
  const timePublished = (item?.time_published || "").trim();
  let publishedAt = "";
  if (/^\d{8}T\d{6}$/.test(timePublished)) {
    publishedAt = `${timePublished.slice(0, 4)}-${timePublished.slice(4, 6)}-${timePublished.slice(6, 8)}T${timePublished.slice(9, 11)}:${timePublished.slice(11, 13)}:${timePublished.slice(13, 15)}Z`;
  } else {
    const d = new Date(timePublished);
    if (!isNaN(d.getTime())) publishedAt = d.toISOString();
  }
  const topics = Array.isArray(item?.topics) ? item.topics.map((t) => t?.topic || "").filter(Boolean) : [];
  const category = mapTopicToCategory(topics);
  const sentimentScore = typeof item?.overall_sentiment_score === "number" ? item.overall_sentiment_score : null;
  const sentimentLabel = item?.overall_sentiment_label || deriveSentimentLabel(sentimentScore);
  const tickers = Array.isArray(item?.ticker_sentiment) ? item.ticker_sentiment.map((t) => t?.ticker || "").filter(Boolean) : [];
  const { currencies, pairs } = detectCurrenciesAndPairs(`${title} ${item?.summary || ""}`, tickers);
  return {
    id: item?.url || title,
    title,
    summary: (item?.summary || "").trim(),
    url: item?.url || "#",
    source: item?.source || "Unknown",
    publishedAt,
    category,
    currencies,
    pairs,
    sentiment: { score: sentimentScore, label: sentimentLabel }
  };
}
var YAHOO_SYMBOL_MAP = {
  // Metals
  XAUUSD: "GC=F",
  GOLD: "GC=F",
  XAGUSD: "SI=F",
  SILVER: "SI=F",
  XPTUSD: "PL=F",
  XPDUSD: "PA=F",
  // Forex pairs
  EURUSD: "EURUSD=X",
  GBPUSD: "GBPUSD=X",
  USDJPY: "USDJPY=X",
  USDCHF: "USDCHF=X",
  USDCAD: "USDCAD=X",
  AUDUSD: "AUDUSD=X",
  NZDUSD: "NZDUSD=X",
  EURGBP: "EURGBP=X",
  EURJPY: "EURJPY=X",
  EURAUD: "EURAUD=X",
  EURCAD: "EURCAD=X",
  EURCHF: "EURCHF=X",
  EURNZD: "EURNZD=X",
  GBPJPY: "GBPJPY=X",
  GBPAUD: "GBPAUD=X",
  GBPCAD: "GBPCAD=X",
  GBPCHF: "GBPCHF=X",
  GBPNZD: "GBPNZD=X",
  AUDJPY: "AUDJPY=X",
  AUDCAD: "AUDCAD=X",
  AUDCHF: "AUDCHF=X",
  AUDNZD: "AUDNZD=X",
  NZDJPY: "NZDJPY=X",
  NZDCAD: "NZDCAD=X",
  NZDCHF: "NZDCHF=X",
  CADJPY: "CADJPY=X",
  CADCHF: "CADCHF=X",
  CHFJPY: "CHFJPY=X",
  // Crypto
  BTCUSD: "BTC-USD",
  ETHUSD: "ETH-USD",
  LTCUSD: "LTC-USD",
  XRPUSD: "XRP-USD",
  // Indices
  US30: "^DJI",
  US500: "^GSPC",
  NAS100: "^NDX",
  UK100: "^FTSE",
  GER40: "^GDAXI",
  JPN225: "^N225",
  // Oil
  USOIL: "CL=F",
  UKOIL: "BZ=F"
};
var YAHOO_INTERVAL_MAP = {
  "1m": { interval: "1m", range: "7d" },
  "5m": { interval: "5m", range: "60d" },
  "15m": { interval: "15m", range: "60d" },
  "30m": { interval: "30m", range: "60d" },
  "1h": { interval: "60m", range: "730d" },
  "4h": { interval: "60m", range: "730d" },
  // Yahoo doesn't have 4h, we use 1h and resample client-side
  "1d": { interval: "1d", range: "20y" },
  "1mo": { interval: "1mo", range: "max" }
};
app.get("/api/chart/ohlc", async (req, res) => {
  if (!requirePro(req, res, "liveChart")) return;
  try {
    const rawSymbol = (req.query.symbol || "XAUUSD").toUpperCase().trim();
    const timeframe = (req.query.timeframe || "1d").toLowerCase().trim();
    const yahooSymbol = YAHOO_SYMBOL_MAP[rawSymbol] || (rawSymbol.endsWith("=X") ? rawSymbol : `${rawSymbol}=X`);
    const mapping = YAHOO_INTERVAL_MAP[timeframe] || YAHOO_INTERVAL_MAP["1d"];
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${mapping.interval}&range=${mapping.range}&includePrePost=false`;
    const yahooRes = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FXJournalPro/1.0)",
        "Accept": "application/json"
      },
      signal: AbortSignal.timeout(1e4)
    });
    if (!yahooRes.ok) {
      console.warn(`[chart/ohlc] Yahoo Finance returned ${yahooRes.status} for ${yahooSymbol}`);
      return res.json({ candles: [], symbol: rawSymbol, timeframe, error: "No data available for this symbol." });
    }
    const data = await yahooRes.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      return res.json({ candles: [], symbol: rawSymbol, timeframe, error: "No chart data from provider." });
    }
    const timestamps = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0] || {};
    const opens = quotes.open || [];
    const highs = quotes.high || [];
    const lows = quotes.low || [];
    const closes = quotes.close || [];
    let candles = [];
    if (timeframe === "4h") {
      let i = 0;
      while (i < timestamps.length) {
        const group = [];
        for (let j = 0; j < 4 && i + j < timestamps.length; j++) {
          const idx = i + j;
          if (opens[idx] != null && highs[idx] != null && lows[idx] != null && closes[idx] != null) {
            group.push({ t: timestamps[idx], o: opens[idx], h: highs[idx], l: lows[idx], c: closes[idx] });
          }
        }
        if (group.length > 0) {
          candles.push({
            time: group[0].t,
            open: group[0].o,
            high: Math.max(...group.map((g) => g.h)),
            low: Math.min(...group.map((g) => g.l)),
            close: group[group.length - 1].c
          });
        }
        i += 4;
      }
    } else {
      candles = timestamps.map((t, i) => ({
        time: t,
        open: opens[i] ?? 0,
        high: highs[i] ?? 0,
        low: lows[i] ?? 0,
        close: closes[i] ?? 0
      })).filter((c) => c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0);
    }
    const seen = /* @__PURE__ */ new Set();
    candles = candles.filter((c) => {
      if (seen.has(c.time)) return false;
      seen.add(c.time);
      return true;
    }).sort((a, b) => a.time - b.time);
    res.json({ candles, symbol: rawSymbol, timeframe });
  } catch (err) {
    console.error("[chart/ohlc] Error:", err?.message || err);
    res.json({ candles: [], symbol: req.query.symbol || "", timeframe: req.query.timeframe || "1d", error: "Chart data temporarily unavailable." });
  }
});
app.get("/api/fx-news", async (req, res) => {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY?.trim();
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || "25"), 10) || 25, 1), 50);
  if (!apiKey) {
    return res.status(503).json({
      error: "FX news is not configured. Add ALPHA_VANTAGE_API_KEY to your environment.",
      code: "NOT_CONFIGURED"
    });
  }
  const cacheKey = `fx-news:${limit}`;
  try {
    let articles = getCached(cacheKey);
    if (!articles) {
      const url = `${ALPHA_VANTAGE_BASE}/query?function=NEWS_SENTIMENT&topics=${FX_NEWS_TOPICS}&limit=${limit}&sort=LATEST&apikey=${encodeURIComponent(apiKey)}`;
      const data = await fetchJson(url);
      if (data?.Note || data?.Information || data?.Error) {
        console.warn("[GET /api/fx-news] Provider rate limit or info message:", data?.Note || data?.Information || data?.Error);
        return res.status(429).json({
          error: "The news provider rate limit has been reached. Please try again later.",
          code: "RATE_LIMITED"
        });
      }
      const feed = Array.isArray(data?.feed) ? data.feed : [];
      articles = feed.map(normalizeNewsArticle).filter(Boolean);
      setCached(cacheKey, articles, 15 * 60 * 1e3);
    }
    let filtered = articles;
    const topic = typeof req.query.topic === "string" ? req.query.topic : "";
    const currency = typeof req.query.currency === "string" ? req.query.currency.toUpperCase() : "";
    if (topic) filtered = filtered.filter((a) => a.category === topic);
    if (currency) filtered = filtered.filter((a) => a.currencies.includes(currency));
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({
      articles: filtered,
      categories: NEWS_CATEGORY_ORDER,
      source: "Alpha Vantage News & Sentiment",
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (err) {
    console.error("[GET /api/fx-news] error:", err?.message || err);
    res.status(502).json({
      error: "Unable to fetch FX news right now. Please try again shortly.",
      code: "UPSTREAM_ERROR"
    });
  }
});
var COUNTRY_TO_CURRENCY = {
  US: "USD",
  EU: "EUR",
  EMU: "EUR",
  DE: "EUR",
  FR: "EUR",
  IT: "EUR",
  ES: "EUR",
  GB: "GBP",
  UK: "GBP",
  JP: "JPY",
  AU: "AUD",
  CA: "CAD",
  CH: "CHF",
  NZ: "NZD",
  CN: "CNY",
  HK: "HKD",
  KR: "KRW",
  SG: "SGD",
  IN: "INR",
  BR: "BRL",
  MX: "MXN",
  ZA: "ZAR",
  TR: "TRY",
  RU: "RUB",
  ID: "IDR",
  TH: "THB",
  MY: "MYR",
  PH: "PHP",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  PL: "PLN",
  CZ: "CZK",
  HU: "HUF",
  RO: "RON",
  GR: "EUR",
  PT: "EUR",
  NL: "EUR",
  BE: "EUR",
  AT: "EUR",
  FI: "EUR",
  IE: "EUR"
};
function normalizeImpact(value) {
  const s = String(value || "").toLowerCase();
  if (s.startsWith("high")) return "high";
  if (s.startsWith("med")) return "medium";
  if (s.startsWith("low")) return "low";
  return "none";
}
function toIsoUtc(dateStr) {
  if (!dateStr) return "";
  const trimmed = dateStr.trim();
  const asIso = trimmed.replace(" ", "T");
  const d = new Date(asIso.endsWith("Z") ? asIso : `${asIso}Z`);
  if (!isNaN(d.getTime())) return d.toISOString();
  const d2 = new Date(trimmed);
  if (!isNaN(d2.getTime())) return d2.toISOString();
  return "";
}
var ProviderAccessError = class extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
};
var economicCalendarProviders = {
  // Xoomar Economic Calendar — genuinely free, no API key required (30 req/min/IP).
  // US macro releases synced weekly from BLS, the Fed, and BEA (CPI, NFP, FOMC, GDP).
  // Docs: https://xoomar.com/markets/api/calendar
  xoomar: {
    name: "Xoomar Economic Calendar (BLS/Fed/BEA)",
    notConfiguredMessage: "Economic calendar is not configured.",
    configured: () => true,
    async fetchEvents(from, to) {
      const url = `${XOOMAR_BASE}/api/markets/calendar?from=${from}&to=${to}`;
      const data = await fetchJson(url);
      const rows = Array.isArray(data?.data) ? data.data : [];
      const fromMs = (/* @__PURE__ */ new Date(`${from}T00:00:00.000Z`)).getTime();
      const toMs = (/* @__PURE__ */ new Date(`${to}T23:59:59.999Z`)).getTime();
      const events = [];
      for (const row of rows) {
        const eventName = (row?.eventName || "").toString().trim();
        if (!eventName) continue;
        const date = toIsoUtc((row?.scheduledAt || "").toString());
        if (!date) continue;
        const eventMs = new Date(date).getTime();
        if (eventMs < fromMs || eventMs > toMs) continue;
        const numOrDash = (v) => v === null || v === void 0 || v === "" ? null : String(v).trim();
        events.push({
          id: `${date}:USD:${eventName}`,
          date,
          currency: "USD",
          country: "US",
          event: eventName,
          impact: normalizeImpact(row?.importance),
          actual: numOrDash(row?.actual),
          forecast: numOrDash(row?.forecast),
          previous: numOrDash(row?.previous)
        });
      }
      return events;
    }
  },
  // Finnhub Economic Calendar — free tier (60 calls/min) includes this endpoint.
  // Docs: https://finnhub.io/docs/api/economic-calendar
  finnhub: {
    name: "Finnhub Economic Calendar",
    notConfiguredMessage: "Economic calendar is not configured. Add FINNHUB_API_KEY to your environment.",
    configured: () => Boolean(process.env.FINNHUB_API_KEY?.trim()),
    async fetchEvents(from, to) {
      const apiKey = process.env.FINNHUB_API_KEY?.trim();
      if (!apiKey) throw new Error("FINNHUB_API_KEY is not configured");
      const url = `${FINNHUB_BASE}/api/v1/calendar/economic?from=${from}&to=${to}&token=${encodeURIComponent(apiKey)}`;
      let data;
      try {
        data = await fetchJson(url);
      } catch (err) {
        if (err?.status === 401 || err?.status === 403) {
          throw new ProviderAccessError("Your Finnhub API key is invalid or has no access to the Economic Calendar.", "RESTRICTED");
        }
        if (err?.status === 429) {
          throw new ProviderAccessError("Finnhub rate limit reached. Please try again shortly.", "RATE_LIMITED");
        }
        throw err;
      }
      const rows = Array.isArray(data?.economicCalendar) ? data.economicCalendar : [];
      const fromMs = (/* @__PURE__ */ new Date(`${from}T00:00:00.000Z`)).getTime();
      const toMs = (/* @__PURE__ */ new Date(`${to}T23:59:59.999Z`)).getTime();
      const events = [];
      for (const row of rows) {
        const eventName = (row?.event || "").toString().trim();
        if (!eventName) continue;
        const country = (row?.country || "").toString().toUpperCase().trim();
        const date = toIsoUtc((row?.time || "").toString());
        if (!date) continue;
        const eventMs = new Date(date).getTime();
        if (eventMs < fromMs || eventMs > toMs) continue;
        const currency = COUNTRY_TO_CURRENCY[country] || country || "--";
        const numOrDash = (v) => v === null || v === void 0 || v === "" ? null : String(v).trim();
        events.push({
          id: `${date}:${currency}:${eventName}`,
          date,
          currency,
          country,
          event: eventName,
          impact: normalizeImpact(row?.impact),
          actual: numOrDash(row?.actual),
          forecast: numOrDash(row?.estimate),
          previous: numOrDash(row?.prev)
        });
      }
      return events;
    }
  },
  fmp: {
    name: "Financial Modeling Prep Economic Calendar",
    notConfiguredMessage: "Economic calendar is not configured. Add FMP_API_KEY to your environment.",
    configured: () => Boolean(process.env.FMP_API_KEY?.trim()),
    async fetchEvents(from, to) {
      const apiKey = process.env.FMP_API_KEY?.trim();
      if (!apiKey) throw new Error("FMP_API_KEY is not configured");
      const url = `${FMP_BASE}/stable/economic-calendar?from=${from}&to=${to}&apikey=${encodeURIComponent(apiKey)}`;
      let data;
      try {
        data = await fetchJson(url);
      } catch (err) {
        if (err?.status === 402) {
          throw new ProviderAccessError(
            "Your Financial Modeling Prep plan does not include the Economic Calendar. Upgrade your FMP plan or switch providers.",
            "RESTRICTED"
          );
        }
        if (err?.status === 403) {
          throw new ProviderAccessError(
            "Your Financial Modeling Prep API key does not have access to the Economic Calendar.",
            "RESTRICTED"
          );
        }
        throw err;
      }
      const rows = Array.isArray(data) ? data : [];
      const fromMs = (/* @__PURE__ */ new Date(`${from}T00:00:00.000Z`)).getTime();
      const toMs = (/* @__PURE__ */ new Date(`${to}T23:59:59.999Z`)).getTime();
      const events = [];
      for (const row of rows) {
        const eventName = (row?.event || "").toString().trim();
        if (!eventName) continue;
        const country = (row?.country || "").toString().toUpperCase().trim();
        const date = toIsoUtc((row?.date || "").toString());
        if (!date) continue;
        const eventMs = new Date(date).getTime();
        if (eventMs < fromMs || eventMs > toMs) continue;
        const currencyRaw = (row?.currency || "").toString().toUpperCase().trim();
        const numOrDash = (v) => v === null || v === void 0 || v === "" ? null : String(v).trim();
        events.push({
          id: `${date}:${currencyRaw || country}:${eventName}`,
          date,
          currency: currencyRaw || COUNTRY_TO_CURRENCY[country] || country || "--",
          country,
          event: eventName,
          impact: normalizeImpact(row?.impact),
          actual: numOrDash(row?.actual),
          forecast: numOrDash(row?.estimate),
          previous: numOrDash(row?.previous)
        });
      }
      return events;
    }
  }
};
app.get("/api/economic-calendar", async (req, res) => {
  const providerName = (process.env.ECONOMIC_CALENDAR_PROVIDER || "xoomar").toLowerCase();
  const provider = economicCalendarProviders[providerName];
  if (!provider) {
    return res.status(500).json({ error: `Unknown economic calendar provider: ${providerName}` });
  }
  if (!provider.configured()) {
    return res.status(503).json({
      error: provider.notConfiguredMessage,
      code: "NOT_CONFIGURED"
    });
  }
  const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = /* @__PURE__ */ new Date();
  const fromRaw = req.query.from;
  const toRaw = req.query.to;
  const from = typeof fromRaw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : fmtDate(today);
  const to = typeof toRaw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? toRaw : fmtDate(new Date(today.getTime() + 21 * 864e5));
  const cacheKey = `economic-calendar:${providerName}:${from}:${to}`;
  try {
    let events = getCached(cacheKey);
    if (!events) {
      events = await provider.fetchEvents(from, to);
      setCached(cacheKey, events, 10 * 60 * 1e3);
    }
    const impact = typeof req.query.impact === "string" ? req.query.impact.toLowerCase() : "";
    const currency = typeof req.query.currency === "string" ? req.query.currency.toUpperCase() : "";
    let filtered = events;
    if (["high", "medium", "low"].includes(impact)) {
      filtered = filtered.filter((e) => e.impact === impact);
    }
    if (currency) filtered = filtered.filter((e) => e.currency === currency);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({
      events: filtered,
      provider: provider.name,
      from,
      to,
      timezone: "UTC",
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (err) {
    if (err?.code === "RESTRICTED") {
      console.error("[GET /api/economic-calendar] restricted:", err?.message || err);
      return res.status(403).json({
        error: err?.message || "Your economic calendar provider is not accessible with the current plan.",
        code: "RESTRICTED"
      });
    }
    if (err?.code === "RATE_LIMITED") {
      console.error("[GET /api/economic-calendar] rate limited:", err?.message || err);
      return res.status(429).json({
        error: err?.message || "Economic calendar provider rate limit reached. Please try again later.",
        code: "RATE_LIMITED"
      });
    }
    console.error("[GET /api/economic-calendar] error:", err?.message || err);
    res.status(502).json({
      error: "Economic calendar data is temporarily unavailable.",
      code: "UPSTREAM_ERROR"
    });
  }
});
var ALLOW_UNSENT_WHATSAPP_REMINDERS = process.env.ALLOW_UNSENT_WHATSAPP_REMINDERS === "true";
var whatsappReminders = [];
app.post("/api/reminders/whatsapp", async (req, res) => {
  try {
    const currentUser = req.currentUser;
    if (!currentUser) return res.status(401).json({ error: "Not authenticated." });
    if (!currentUser.isPro) {
      return res.status(403).json({ error: "WhatsApp reminders are a Pro feature. Please upgrade to access this." });
    }
    if (!ALLOW_UNSENT_WHATSAPP_REMINDERS) {
      return res.status(503).json({
        error: "WhatsApp reminders are not available yet. Nothing would be sent, so nothing is saved.",
        code: "NOT_IMPLEMENTED"
      });
    }
    const { eventId, eventName, eventDate, currency, impact, phone, minutesBefore } = req.body;
    if (!eventId || !eventName || !eventDate || !phone) {
      return res.status(400).json({ error: "Missing required fields: eventId, eventName, eventDate, phone." });
    }
    if (!/^\+?[\d\s\-()]{7,20}$/.test(String(phone).trim())) {
      return res.status(400).json({ error: "Invalid phone number format." });
    }
    const mins = Number(minutesBefore) || 15;
    if (mins < 5 || mins > 1440) {
      return res.status(400).json({ error: "minutesBefore must be between 5 and 1440." });
    }
    const idx = whatsappReminders.findIndex((r) => r.userId === currentUser.id && r.eventId === eventId);
    if (idx !== -1) whatsappReminders.splice(idx, 1);
    const reminder = {
      id: crypto2.randomUUID(),
      userId: currentUser.id,
      eventId: String(eventId),
      eventName: String(eventName),
      eventDate: String(eventDate),
      currency: String(currency || ""),
      impact: String(impact || ""),
      phone: String(phone).trim(),
      minutesBefore: mins,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    whatsappReminders.push(reminder);
    console.log(`[WhatsApp Reminder] Set for user ${currentUser.id} \u2013 ${eventName} at ${eventDate}, ${mins}m before \u2192 ${phone}`);
    res.json({ success: true, reminder });
  } catch (err) {
    console.error("[POST /api/reminders/whatsapp]", err?.message || err);
    res.status(500).json({ error: "Failed to save reminder." });
  }
});
app.delete("/api/reminders/whatsapp/:eventId", (req, res) => {
  const currentUser = req.currentUser;
  if (!currentUser) return res.status(401).json({ error: "Not authenticated." });
  const { eventId } = req.params;
  const idx = whatsappReminders.findIndex((r) => r.userId === currentUser.id && r.eventId === eventId);
  if (idx !== -1) {
    whatsappReminders.splice(idx, 1);
    return res.json({ success: true });
  }
  res.status(404).json({ error: "Reminder not found." });
});
app.get("/api/reminders/whatsapp", (req, res) => {
  const currentUser = req.currentUser;
  if (!currentUser) return res.status(401).json({ error: "Not authenticated." });
  const mine = whatsappReminders.filter((r) => r.userId === currentUser.id);
  res.json({ reminders: mine });
});
async function getUserSharedLinks(userId) {
  const links = [];
  if (useSupabase) {
    try {
      const { data: u } = await supabase.from("users").select("preferences").eq("id", userId).maybeSingle();
      if (Array.isArray(u?.preferences?.sharedLinks)) {
        links.push(...u.preferences.sharedLinks);
      }
      const { data: rows } = await supabase.from("shared_journal_links").select("*").eq("user_id", userId);
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (!links.some((l) => l.token === r.token)) {
            links.push({
              token: r.token,
              userId: r.user_id,
              userName: r.user_name || "Trader",
              sections: Array.isArray(r.sections) ? r.sections : ["dashboard", "journal"],
              months: r.months === "all" ? "all" : Number(r.months) || 3,
              active: r.active !== false,
              views: r.views || 0,
              createdAt: r.created_at || (/* @__PURE__ */ new Date()).toISOString()
            });
          }
        }
      }
    } catch (err) {
      console.warn("[getUserSharedLinks] Error loading from Supabase:", err?.message);
    }
  }
  return links;
}
async function saveUserSharedLink(userId, link) {
  if (useSupabase) {
    try {
      const { data: u } = await supabase.from("users").select("preferences").eq("id", userId).maybeSingle();
      const existing = Array.isArray(u?.preferences?.sharedLinks) ? u.preferences.sharedLinks : [];
      const idx = existing.findIndex((l) => l.token === link.token);
      let updated;
      if (idx >= 0) {
        updated = [...existing];
        updated[idx] = { ...existing[idx], ...link };
      } else {
        updated = [link, ...existing];
      }
      const nextPrefs = { ...u?.preferences || {}, sharedLinks: updated };
      await supabase.from("users").update({ preferences: nextPrefs }).eq("id", userId);
      try {
        await supabase.from("shared_journal_links").upsert({
          token: link.token,
          user_id: link.userId,
          user_name: link.userName,
          sections: link.sections,
          months: String(link.months),
          active: link.active,
          views: link.views || 0,
          created_at: link.createdAt,
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        }, { onConflict: "token" });
      } catch (_) {
      }
    } catch (err) {
      console.error("[saveUserSharedLink] Error saving shared link:", err?.message);
    }
  }
}
async function findSharedLinkByToken(token) {
  if (!token) return null;
  if (useSupabase) {
    try {
      const { data: row } = await supabase.from("shared_journal_links").select("*").eq("token", token).maybeSingle();
      if (row) {
        const { data: userRow } = await supabase.from("users").select("id, name, email, preferences").eq("id", row.user_id).maybeSingle();
        return {
          link: {
            token: row.token,
            userId: row.user_id,
            userName: row.user_name || userRow?.name || "Trader",
            sections: Array.isArray(row.sections) ? row.sections : ["dashboard", "journal"],
            months: row.months === "all" ? "all" : Number(row.months) || 3,
            active: row.active !== false,
            views: row.views || 0,
            createdAt: row.created_at || (/* @__PURE__ */ new Date()).toISOString()
          },
          ownerUser: userRow
        };
      }
      const { data: allUsers } = await supabase.from("users").select("id, name, email, preferences");
      if (Array.isArray(allUsers)) {
        for (const u of allUsers) {
          const links = Array.isArray(u.preferences?.sharedLinks) ? u.preferences.sharedLinks : [];
          const found = links.find((l) => l.token === token);
          if (found) {
            return {
              link: {
                ...found,
                userName: found.userName || u.name || (u.email ? u.email.split("@")[0] : "Trader")
              },
              ownerUser: u
            };
          }
        }
      }
    } catch (err) {
      console.error("[findSharedLinkByToken] Error finding shared link:", err?.message);
    }
  }
  return null;
}
app.get("/api/shared-links", async (req, res) => {
  const currentUser = req.currentUser;
  if (!currentUser) return res.status(401).json({ error: "Please log in to manage shared links." });
  const links = await getUserSharedLinks(currentUser.id);
  res.json({ links });
});
app.post("/api/shared-links", async (req, res) => {
  const currentUser = req.currentUser;
  if (!currentUser) return res.status(401).json({ error: "Please log in to create a share link." });
  const isPro = !!(currentUser.isPro || currentUser.is_pro);
  if (!isPro) {
    return res.status(403).json({
      error: "Sharing your journal is an exclusive Pro feature. Please upgrade to Pro to create shareable links."
    });
  }
  const { sections, months } = req.body || {};
  const allowedSections = ["dashboard", "analysis", "journal", "calendar"];
  const validSections = (Array.isArray(sections) ? sections : []).filter((s) => allowedSections.includes(s));
  if (validSections.length === 0) {
    validSections.push("dashboard", "journal");
  }
  let validMonths = "all";
  if (months !== "all") {
    const num = Number(months);
    if ([1, 3, 6, 12].includes(num)) {
      validMonths = num;
    } else {
      validMonths = 3;
    }
  }
  const token = crypto2.randomBytes(9).toString("base64url");
  const newLink = {
    token,
    userId: currentUser.id,
    userName: currentUser.name || (currentUser.email ? currentUser.email.split("@")[0] : "Trader"),
    sections: validSections,
    months: validMonths,
    active: true,
    views: 0,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await saveUserSharedLink(currentUser.id, newLink);
  res.status(201).json({
    success: true,
    link: newLink,
    shareUrl: `/shared/${token}`
  });
});
app.delete("/api/shared-links/:token", async (req, res) => {
  const currentUser = req.currentUser;
  if (!currentUser) return res.status(401).json({ error: "Please log in." });
  const { token } = req.params;
  const links = await getUserSharedLinks(currentUser.id);
  const target = links.find((l) => l.token === token);
  if (!target) {
    return res.status(404).json({ error: "Share link not found or belongs to another user." });
  }
  target.active = false;
  target.revokedAt = (/* @__PURE__ */ new Date()).toISOString();
  await saveUserSharedLink(currentUser.id, target);
  res.json({ success: true, message: "Share link disabled successfully." });
});
app.get("/api/shared/:token", async (req, res) => {
  const { token } = req.params;
  const match = await findSharedLinkByToken(token);
  if (!match || !match.link || !match.link.active) {
    return res.status(404).json({
      error: "This shared journal link does not exist, has expired, or was revoked by the trader."
    });
  }
  const { link } = match;
  link.views = (link.views || 0) + 1;
  saveUserSharedLink(link.userId, link).catch(() => {
  });
  let allTrades = [];
  if (useSupabase) {
    try {
      const { data: rows } = await supabase.from("trades").select("*").eq("user_id", link.userId).order("date", { ascending: false });
      if (rows) allTrades = toCamel(rows);
    } catch (err) {
      console.error("[GET /api/shared/:token] Error loading trades:", err?.message);
    }
  }
  let tradingTrades = allTrades.filter((t) => t.type !== "Deposit" && t.type !== "Withdrawal");
  if (link.months !== "all") {
    const cutoffMs = Date.now() - Number(link.months) * 30 * 24 * 60 * 60 * 1e3;
    tradingTrades = tradingTrades.filter((t) => {
      const d = new Date(t.date).getTime();
      return !isNaN(d) && d >= cutoffMs;
    });
  }
  const totalTrades = tradingTrades.length;
  const wins = tradingTrades.filter((t) => (Number(t.profit) || Number(t.pnl) || 0) > 0);
  const losses = tradingTrades.filter((t) => (Number(t.profit) || Number(t.pnl) || 0) < 0);
  const winRate = totalTrades > 0 ? wins.length / totalTrades * 100 : 0;
  const netProfit2 = tradingTrades.reduce((acc, t) => acc + (Number(t.profit) || Number(t.pnl) || 0), 0);
  const grossProfit = wins.reduce((acc, t) => acc + (Number(t.profit) || Number(t.pnl) || 0), 0);
  const grossLoss = Math.abs(losses.reduce((acc, t) => acc + (Number(t.profit) || Number(t.pnl) || 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99.9 : 0;
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const bestTrade = totalTrades > 0 ? Math.max(...tradingTrades.map((t) => Number(t.profit) || Number(t.pnl) || 0)) : 0;
  const worstTrade = totalTrades > 0 ? Math.min(...tradingTrades.map((t) => Number(t.profit) || Number(t.pnl) || 0)) : 0;
  let runningEquity = 0;
  const sortedChrono = [...tradingTrades].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const equityCurve = sortedChrono.map((t, idx) => {
    runningEquity += Number(t.profit) || Number(t.pnl) || 0;
    return {
      tradeNum: idx + 1,
      date: t.date ? String(t.date).slice(0, 10) : "",
      pnl: Number(t.profit) || Number(t.pnl) || 0,
      equity: Math.round(runningEquity * 100) / 100
    };
  });
  const sanitizedTrades = link.sections.includes("journal") ? tradingTrades.map((t) => ({
    id: t.id,
    symbol: t.symbol,
    type: t.type,
    lotSize: t.lotSize ?? t.lots ?? 0,
    entryPrice: t.entryPrice ?? 0,
    exitPrice: t.exitPrice ?? 0,
    date: t.date,
    exitTime: t.exitTime || null,
    profit: Number(t.profit) || Number(t.pnl) || 0,
    pnl: Number(t.profit) || Number(t.pnl) || 0,
    sl: t.sl || null,
    tp: t.tp || null,
    emotion: t.emotion || "Calm",
    strategy: t.strategy || "",
    commission: t.commission || 0,
    swap: t.swap || 0,
    notes: t.notes ? String(t.notes).slice(0, 300) : ""
  })) : link.sections.includes("calendar") ? tradingTrades.map((t) => ({
    id: t.id,
    symbol: t.symbol,
    type: t.type,
    date: t.date,
    exitTime: t.exitTime || null,
    profit: Number(t.profit) || Number(t.pnl) || 0,
    pnl: Number(t.profit) || Number(t.pnl) || 0
  })) : [];
  let analysisData = null;
  if (link.sections.includes("analysis")) {
    const pairMap = {};
    for (const t of tradingTrades) {
      const sym = (t.symbol || "OTHER").toUpperCase();
      if (!pairMap[sym]) pairMap[sym] = { trades: 0, wins: 0, profit: 0 };
      const p = Number(t.profit) || Number(t.pnl) || 0;
      pairMap[sym].trades += 1;
      if (p > 0) pairMap[sym].wins += 1;
      pairMap[sym].profit += p;
    }
    const pairs = Object.entries(pairMap).map(([symbol, stat]) => ({
      symbol,
      trades: stat.trades,
      winRate: Math.round(stat.wins / stat.trades * 100),
      profit: Math.round(stat.profit * 100) / 100
    })).sort((a, b) => b.trades - a.trades);
    analysisData = { pairs };
  }
  const currentViewer = req.currentUser;
  const isViewerRegistered = !!currentViewer;
  res.json({
    valid: true,
    ownerName: link.userName || "Verified Trader",
    sections: link.sections,
    months: link.months,
    createdAt: link.createdAt,
    views: link.views || 1,
    isViewerRegistered,
    stats: {
      totalTrades,
      winRate: Math.round(winRate * 10) / 10,
      netProfit: Math.round(netProfit2 * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      winsCount: wins.length,
      lossesCount: losses.length,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      bestTrade: Math.round(bestTrade * 100) / 100,
      worstTrade: Math.round(worstTrade * 100) / 100
    },
    equityCurve,
    trades: sanitizedTrades,
    analysis: analysisData
  });
});
if (IS_DEV) {
  import("vite").then(({ createServer }) => {
    createServer({
      server: { middlewareMode: true },
      appType: "spa"
    }).then((vite) => {
      app.use(vite.middlewares);
      startCloudWorker();
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`[AxyFx Journal Server] Dev listening on http://0.0.0.0:${PORT}`);
      });
    });
  }).catch((err) => {
    console.error("Vite Dev Server creation failed:", err);
  });
} else if (!IS_SERVERLESS2) {
  const distPath = path2.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path2.join(distPath, "index.html"));
  });
  startCloudWorker();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[AxyFx Journal Server] Prod listening on http://0.0.0.0:${PORT}`);
  });
}
var server_default = app;
export {
  server_default as default,
  startCloudWorkers
};
