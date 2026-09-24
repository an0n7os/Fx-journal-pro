# 📘 AxyFx Journal Pro – സമ്പൂർണ്ണ സിസ്റ്റം & കസ്റ്റമർ വർക്ക്ഫ്ലോ ഗൈഡ് (Master Workflow Documentation)

---

## 🌟 1. ആകെ സിസ്റ്റത്തിന്റെ സമഗ്രമായ മാസ്റ്റർ ഡയഗ്രം (All-in-One Master Workflow)

മുഴുവൻ സിസ്റ്റവും എങ്ങനെ ഒരൊറ്റ കുടക്കീഴിൽ പ്രവർത്തിക്കുന്നുവെന്ന് താഴെ കാണുന്ന മാസ്റ്റർ ഫ്ലോചാർട്ടിലൂടെ മനസ്സിലാക്കാം:

```mermaid
flowchart TB
    %% Users & Entry
    User([👤 കസ്റ്റമർ / ട്രേഡർ]) --> Auth[🔐 1. Sign Up & OTP Verification]
    Auth --> Onboarding[📋 2. Onboarding Survey & Guided Tour]
    
    %% Account Connection
    Onboarding --> Accounts[💼 3. Trading Account Setup]
    Accounts --> SyncChoice{സിങ്ക് രീതി}
    SyncChoice -->|Manual / CSV| ManualLog[മാനുവൽ / Excel Import]
    SyncChoice -->|MT5 EA Script| EASync[MetaTrader 5 EA Sync]
    SyncChoice -->|Cloud API| MetaApiSync[MetaApi Cloud Sync]
    
    %% Core Engine
    ManualLog --> TradeDB[(📊 Trade Database)]
    EASync --> TradeDB
    MetaApiSync --> TradeDB
    
    %% Features & Journaling
    TradeDB --> Journal[📔 4. Journaling & Psychology<br/>• Emotions FOMO/Revenge<br/>• Strategy Tags<br/>• Chart Screenshots]
    Journal --> Notebook[📝 Daily Trader Notebook]
    
    %% Analytics & Visuals
    TradeDB --> Analytics[📈 5. Performance Analytics Engine]
    subgraph AnalyticsEngine [അനലിറ്റിക്സ് ഫീച്ചറുകൾ]
        Analytics --> CalHeatmap[📅 Trading Calendar & Heatmap]
        Analytics --> LiveCharts[📉 TradingView Candlestick Markers]
        Analytics --> MetricKPI[🎯 Win Rate, Profit Factor, Drawdown]
        Analytics --> XPLevels[🏆 Trader Rank, XP & Badges]
    end
    
    %% Risk & AI Guardrails
    TradeDB --> RiskEngine{⚠️ 6. Risk Engine}
    RiskEngine -->|Limit Exceeded| RiskAlert[🚨 Loss Limit / Overtrade Alert]
    RiskEngine -->|Safe| AISystem[🧠 7. Google Gemini AI Insights]
    AISystem --> AIAdvice[💡 വ്യക്തിഗത ട്രേഡിംഗ് നിർദ്ദേശങ്ങൾ]
    
    %% Pro Upgrade & Payments
    User --> ProTrigger{💎 8. Pro Upgrade}
    ProTrigger --> Razorpay[💳 Razorpay Payment Gateway]
    Razorpay --> ProAccess[✨ Pro ഫീച്ചറുകൾ Unlock ആകുന്നു]
    
    %% Mentorship & Admin
    User --> Mentor[👨‍🏫 9. Read-Only Mentor Access]
    SuperAdmin([👑 Super Admin]) --> AdminPanel[🛠️ 10. Admin Panel<br/>• User Management<br/>• Billing Tracking<br/>• Support Tickets<br/>• Announcements]
```

---

## 🔄 2. ഓരോ ഘട്ടത്തിന്റെയും പ്രത്യേക ഡയഗ്രമുകൾ (Detailed Module Diagrams)

---

### ഘട്ടം 1: രജിസ്ട്രേഷനും ഓൺബോർഡിംഗും (Authentication & Onboarding)
കസ്റ്റമർ വെബ്‌സൈറ്റിൽ രജിസ്റ്റർ ചെയ്ത് ഡാഷ്‌ബോർഡിലേക്ക് പ്രവേശിക്കുന്ന പ്രക്രിയ:

```mermaid
flowchart TD
    Start([പുതിയ യൂസർ വരുന്നു]) --> Register[Sign Up: Email & Password നൽകുന്നു]
    Register --> OTPCheck{OTP / Email Verification}
    OTPCheck -- പരാജയം --> ResendOTP[വീണ്ടും OTP അയക്കുന്നു]
    ResendOTP --> OTPCheck
    OTPCheck -- വിജയം --> ProfileSetup[Onboarding ചോദ്യാവലി]
    
    subgraph ProfileSetup [ഓൺബോർഡിംഗ് ചോദ്യങ്ങൾ]
        Q1[Experience: Beginner / Inter / Pro]
        Q2[Trading Style: Scalp / Day / Swing]
        Q3[Markets: Forex / Gold / Crypto]
    end
    
    ProfileSetup --> SaveUser[ഡാറ്റാബേസിൽ യൂസർ പ്രൊഫൈൽ സേവ് ചെയ്യുന്നു]
    SaveUser --> GuidedTour[Interactive Guided Tour കാണിക്കുന്നു]
    GuidedTour --> DashboardReady([Main Dashboard ലേക്ക് പ്രവേശിക്കുന്നു])
```

---

### ഘട്ടം 2: ട്രേഡിംഗ് അക്കൗണ്ട് സെറ്റപ്പും MT5 ഓട്ടോ-സിങ്കും (Account Connectivity)
കസ്റ്റമറുടെ MT4/MT5 ബ്രോക്കർ അക്കൗണ്ടുകൾ സിസ്റ്റവുമായി ബന്ധിപ്പിക്കുന്നത്:

```mermaid
flowchart TD
    AddAcc([Add Trading Account ക്ലിക്ക് ചെയ്യുന്നു]) --> SelectBroker[Broker & Platform തിരഞ്ഞെടുക്കുന്നു<br/>MT4 / MT5 / cTrader / DXtrade]
    SelectBroker --> SetType[Account Type: Live / Demo & Starting Balance]
    SetType --> ChooseSync{സിങ്ക് മെത്തേഡ് തിരഞ്ഞെടുക്കുക}

    ChooseSync -- മാനുവൽ / CSV Import --> ManualMode[Manual Trade Entry / Excel Import]
    
    ChooseSync -- MT5 EA Script --> DownloadEA[EA Script ഡൗൺലോഡ് ചെയ്യുന്നു]
    DownloadEA --> RunEA[MT5 Terminal-ൽ EA റൺ ചെയ്യുന്നു + Token നൽകുന്നു]
    RunEA --> EASync[EA വഴി തത്സമയം സിൻക് ആകുന്നു]

    ChooseSync -- Cloud Sync MetaApi --> EnterCreds[MT5 Login & Server നൽകുന്നു]
    EnterCreds --> CloudWorker[Backend Background Worker കണക്ട് ചെയ്യുന്നു]
    CloudWorker --> AutoFetch[ട്രേഡുകൾ ഓട്ടോമാറ്റിക് ആയി Fetch ചെയ്യുന്നു]

    ManualMode --> AccReady([അക്കൗണ്ട് ആക്റ്റീവ് ആകുന്നു])
    EASync --> AccReady
    AutoFetch --> AccReady
```

---

### ഘട്ടം 3: ട്രേഡ് ലോഗിംഗും സൈക്കോളജി ജേർണലിംഗും (Trade Logging & Emotions)
ട്രേഡ് വിവരങ്ങളും മാനസികാവസ്ഥയും രേഖപ്പെടുത്തുന്ന രീതി:

```mermaid
flowchart TD
    NewTrade([ട്രേഡ് ലോഗ് ചെയ്യുന്നു]) --> Inputs[വിവരങ്ങൾ നൽകുന്നു:<br/>Symbol, Buy/Sell, Lots, Entry, Exit, SL, TP]
    Inputs --> AutoCalc[സിസ്റ്റം തനിയെ ലാഭനഷ്ടം (PnL), RRR,<br/>Pip Value എന്നിവ കണക്കുകൂട്ടുന്നു]
    
    AutoCalc --> PsychInfo[സൈക്കോളജി വിവരങ്ങൾ ചേർക്കുന്നു]
    subgraph PsychInfo [Emotion & Strategy]
        Emo[Emotion: Calm / FOMO / Greed / Revenge]
        Strat[Strategy: Breakout / Pullback / ICT etc.]
        Notes[Notes & Trade Screenshots അപ്‌ലോഡ് ചെയ്യുന്നു]
    end
    
    PsychInfo --> SaveTrade[ഡാറ്റാബേസിൽ ട്രേഡ് സേവ് ആകുന്നു]
    SaveTrade --> UpdateStats[Dashboard & Calendar തത്സമയം അപ്‌ഡേറ്റ് ആകുന്നു]
    UpdateStats --> XPBadge[Trader XP & Streaks അപ്‌ഡേറ്റ് ആകുന്നു]
```

---

### ഘട്ടം 4: പെർഫോമൻസ് അനലിറ്റിക്സും ചാർട്ടിംഗും (Analytics & Live Charts)
ട്രേഡറുടെ പെർഫോമൻസ് സിസ്റ്റം അനലൈസ് ചെയ്യുന്ന രീതി:

```mermaid
flowchart LR
    TradeData[(Trade Database)] --> AnalyticsEngine[Analytics Processing Engine]
    
    AnalyticsEngine --> Metric1[Win Rate %, Profit Factor & Drawdown]
    AnalyticsEngine --> Metric2[Calendar Heatmap: Green/Red Days]
    AnalyticsEngine --> Metric3[Strategy Performance Breakdown]
    AnalyticsEngine --> Metric4[Emotional Analysis: ഏത് ഇമോഷനിലാണ് കൂടുതൽ നഷ്ടം?]
    
    TradeData --> TVChart[TradingView / Lightweight Chart]
    TVChart --> PlotMarkers[ചാർട്ടിൽ Entry & Exit പോയിന്റുകൾ തനിയെ മാർക്ക് ചെയ്യുന്നു]
```

---

### ഘട്ടം 5: AI ഇൻസൈറ്റുകളും റിസ്ക് ഗാർഡ്‌റെയിൽസും (AI Insights & Risk Management)
AI ഉപദേശങ്ങളും, അക്കൗണ്ട് സംരക്ഷിക്കാനുള്ള റിസ്ക് മാനേജ്‌മെന്റും:

```mermaid
flowchart TD
    TraderActs[ട്രേഡർ ട്രേഡ് ചെയ്യുന്നു] --> RiskEngine{Risk Limits പരിശോധിക്കുന്നു}
    
    RiskEngine -- Daily Loss Limit കഴിഞ്ഞു --> LockAlert[⚠️ Red Alert: Daily Limit Reached! ട്രേഡിംഗ് നിർത്താൻ മുന്നറിയിപ്പ്]
    RiskEngine -- Max Trades എണ്ണം കഴിഞ്ഞു --> OvertradeAlert[⚠️ Overtrading Warning!]
    RiskEngine -- പരിധിക്കുള്ളിൽ --> NormalState[Safe Trading Mode]

    TraderActs --> TriggerAI[Request AI Insights ക്ലിക്ക് ചെയ്യുന്നു]
    TriggerAI --> PromptPrep[ട്രേഡറുടെ നഷ്ടങ്ങൾ, റിസ്ക്, ഇമോഷനുകൾ എന്നിവ ക്ലൗഡിലേക്ക് അയക്കുന്നു]
    PromptPrep --> GeminiAPI[Google Gemini AI Engine]
    GeminiAPI --> AIAdvice[വ്യക്തിഗത നിർദ്ദേശങ്ങൾ:<br/>1. തെറ്റുകൾ കണ്ടെത്തി നൽകുന്നു<br/>2. റിസ്ക് പ്ലാൻ മെച്ചപ്പെടുത്തുന്നു<br/>3. സൈക്കോളജി നിയന്ത്രിക്കാൻ സഹായിക്കുന്നു]
```

---

### ഘട്ടം 6: പ്രോ സബ്സ്ക്രിപ്ഷനും പെയ്‌മെന്റും (Pro Upgrade & Payments)
കസ്റ്റമർ പ്രോ പ്ലാൻ എടുക്കുന്ന പ്രക്രിയ:

```mermaid
sequenceDiagram
    autonumber
    actor User as കസ്റ്റമർ (User)
    participant UI as വെബ്സൈറ്റ് (Frontend)
    participant Server as ആപ്പ് സെർവർ (Backend)
    participant RP as Razorpay Gateway
    participant DB as ഡാറ്റാബേസ്

    User->>UI: Upgrade to Pro ക്ലിക്ക് ചെയ്യുന്നു
    UI->>Server: POST /api/billing/create-order
    Server->>RP: Razorpay ഓർഡർ ഉണ്ടാക്കുന്നു
    RP-->>Server: Order ID നൽകുന്നു
    Server-->>UI: Order ID & Amount തിരിച്ചയക്കുന്നു
    UI->>User: Razorpay Popup കാണിക്കുന്നു (UPI / Card / NetBanking)
    User->>RP: പണം അടയ്ക്കുന്നു
    RP-->>UI: Payment Success Signature നൽകുന്നു
    UI->>Server: POST /api/billing/verify-payment
    Server->>DB: User Status 'isPro = true' എന്ന് മാറ്റുന്നു
    Server-->>UI: Account Upgraded!
    UI->>User: എല്ലാ പ്രോ ഫീച്ചറുകളും അൺലോക്ക് ആകുന്നു 🎉
```

---

### ഘട്ടം 7: മെന്റർ ഷെയറിംഗും സൂപ്പർ അഡ്മിൻ പാനലും (Mentorship & Admin Management)

```mermaid
flowchart TD
    subgraph MentorWorkflow [മെന്റർ ഷെയറിംഗ് സിസ്റ്റം]
        Student[Student Trader] --> GenLink[Read-Only Mentor Link ഉണ്ടാക്കുന്നു]
        GenLink --> SendMentor[മെന്റർക്ക് അയച്ചുകൊടുക്കുന്നു]
        SendMentor --> MentorView[മെന്റർ ജേർണൽ, ചാർട്ടുകൾ, ഇമോഷനുകൾ റിവ്യൂ ചെയ്യുന്നു]
    end

    subgraph AdminWorkflow [സൂപ്പർ അഡ്മിൻ പാനൽ]
        Admin[Super Admin] --> LoginAdmin[Admin Dashboard-ലേക്ക് ലോഗിൻ ചെയ്യുന്നു]
        LoginAdmin --> ManageUsers[യൂസർമാരുടെ ലിസ്റ്റ്, ആക്റ്റിവിറ്റി, സ്റ്റാറ്റസ് കാണുന്നു]
        LoginAdmin --> ManageBilling[പെയ്‌മെന്റ് കളക്ഷനുകൾ ട്രാക്ക് ചെയ്യുന്നു]
        LoginAdmin --> Tickets[സപ്പോർട്ട് ടിക്കറ്റുകൾക്ക് മറുപടി നൽകുന്നു]
        LoginAdmin --> Announce[സൈറ്റിൽ പുതിയ അറിയിപ്പുകൾ പബ്ലിഷ് ചെയ്യുന്നു]
    end
```

---

## 📋 സംഗ്രഹം (Summary)
ഈ പ്ലാറ്റ്‌ഫോം ഒരു സാധാരണ ജേർണലിനേക്കാൾ ഉപരിയായി, ഒരു ട്രേഡറുടെ പൂർണ്ണ വളർച്ചയ്ക്കും അച്ചടക്കത്തിനും (Discipline) വേണ്ടി രൂപകൽപ്പന ചെയ്തിട്ടുള്ള സമ്പൂർണ്ണ ട്രേഡിംഗ് ഇക്കോസിസ്റ്റമാണ്.
