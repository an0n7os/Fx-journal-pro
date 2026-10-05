// Shared legal copy compliant with Indian payment-aggregator (Razorpay) merchant onboarding guidelines.
// Rendered by the in-app LegalFooter, public landing page modals, and dedicated standalone /terms, /privacy, etc. routes.

export interface LegalSection {
  heading?: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface LegalDoc {
  title: string;
  lastUpdated?: string;
  subtitle?: string;
  sections: LegalSection[];
  footerNote?: string;
  body: string[]; // Flat list of strings for backwards-compatible modal rendering
}

export const LEGAL_DOCS: Record<string, LegalDoc> = {
  terms: {
    title: 'Terms & Conditions',
    lastUpdated: 'October 2026',
    subtitle: 'Please review these terms carefully before using FXJournalPro.',
    sections: [
      {
        paragraphs: [
          'Welcome to FXJournalPro. By accessing or using the FXJournalPro website, web application, and related software services, you agree to these Terms & Conditions.',
        ],
      },
      {
        heading: '1. Nature of the Service',
        paragraphs: [
          'FXJournalPro is a cloud-based Software-as-a-Service (SaaS) platform designed for personal trade journaling, record keeping, organization, and performance analytics.',
          'The platform allows users to manually record trading activity and, where supported, synchronize or import their own trading records from compatible third-party platforms such as MetaTrader 5 (MT5).',
          'FXJournalPro is a software and analytics service only.',
          'FXJournalPro does not:',
        ],
        bullets: [
          'operate as a broker or trading platform;',
          'execute trades on behalf of users;',
          'hold, custody, or manage customer funds;',
          'accept trading deposits or investment capital;',
          'provide brokerage, remittance, or foreign-exchange payment services;',
          'manage investment portfolios or trading accounts;',
          'provide copy-trading or managed-account services;',
          'sell or facilitate the purchase of financial instruments;',
          'provide guaranteed returns or profit claims; or',
          'provide personalized financial, investment, or brokerage advice.',
        ],
      },
      {
        paragraphs: [
          'Users maintain their own brokerage relationships and remain solely responsible for their trading accounts and financial decisions.',
        ],
      },
      {
        heading: '2. Trade Data and MT5 Synchronization',
        paragraphs: [
          "Where MT5 synchronization is available, FXJournalPro may import or synchronize trading-history information belonging to the user's own trading account for journaling and analytical purposes.",
          "FXJournalPro does not execute trades, modify trading positions, or transfer funds through the user's brokerage account.",
          'Third-party platforms, brokers, APIs, Expert Advisors, or synchronization services may have their own terms, limitations, availability requirements, and technical restrictions.',
        ],
      },
      {
        heading: '3. AI and Educational Features',
        paragraphs: [
          'FXJournalPro may provide AI-powered features, including Heyza, to help users review and analyze their own trading journal information.',
          'AI-generated content is provided for general educational, organizational, and analytical purposes only.',
          'AI-generated information does not constitute financial, investment, legal, tax, or professional advice and should not be interpreted as a recommendation or instruction to buy, sell, hold, or trade any financial instrument.',
        ],
      },
      {
        heading: '4. User Account',
        paragraphs: [
          'Users are responsible for maintaining the confidentiality of their account credentials and for activities performed through their account.',
          'Users must provide accurate information and must not use the platform for unlawful activities.',
        ],
      },
      {
        heading: '5. Software Availability',
        paragraphs: [
          'FXJournalPro is provided on an "as is" and "as available" basis.',
          'We aim to maintain reliable service but do not guarantee uninterrupted availability. Third-party integrations, including MT5 synchronization and external data services, may occasionally experience delays, interruptions, inaccuracies, or technical failures.',
        ],
      },
      {
        heading: '6. User Data',
        paragraphs: [
          'Users retain ownership of the trading records, notes, and other information they submit to FXJournalPro, subject to our Privacy Policy.',
        ],
      },
      {
        heading: '7. Limitation of Liability',
        paragraphs: [
          'To the maximum extent permitted by applicable law, FXJournalPro and its operators shall not be responsible for indirect, incidental, consequential, or trading losses arising from the use of the platform or from trading decisions made by users through their independent brokerage accounts.',
        ],
      },
      {
        heading: '8. Risk',
        paragraphs: [
          'Trading financial instruments, including foreign exchange, commodities, indices, and CFDs, can involve substantial financial risk. Users are solely responsible for evaluating such risks and making their own trading decisions.',
        ],
      },
      {
        heading: '9. Intellectual Property',
        paragraphs: [
          'All software, branding, designs, text, graphics, and other materials provided by FXJournalPro remain the property of FXJournalPro or its licensors unless otherwise stated.',
        ],
      },
      {
        heading: '10. Modifications',
        paragraphs: [
          'We may update these Terms from time to time. Continued use of FXJournalPro after an update constitutes acceptance of the revised Terms.',
        ],
      },
      {
        heading: '11. Governing Law',
        paragraphs: [
          'These Terms shall be governed by the applicable laws of India. Subject to applicable law, disputes shall be subject to the jurisdiction of the competent courts in Kerala, India.',
        ],
      },
      {
        heading: '12. Contact',
        paragraphs: [
          'FXJournalPro',
          'Kasaragod, Kerala, India',
          'Email: contact@fxjournalpro.com',
          'Phone / WhatsApp: +91 81368 02573',
        ],
      },
    ],
    body: [
      'Welcome to FXJournalPro. By accessing or using the FXJournalPro website, web application, and related software services, you agree to these Terms & Conditions.',
      '1. Nature of the Service: FXJournalPro is a cloud-based Software-as-a-Service (SaaS) platform designed for personal trade journaling, record keeping, organization, and performance analytics.',
      'FXJournalPro is a software and analytics service only. We do not operate as a broker or trading platform, do not execute trades on behalf of users, do not hold, custody, or manage customer funds, do not accept trading deposits or investment capital, and do not provide financial, investment, or brokerage advice.',
      'Users maintain their own brokerage relationships and remain solely responsible for their trading accounts and financial decisions.',
      '2. Trade Data and MT5 Synchronization: Where MT5 synchronization is available, FXJournalPro may import or synchronize trading-history information belonging to the user\'s own trading account for journaling and analytical purposes. FXJournalPro does not execute trades, modify positions, or transfer funds.',
      '3. AI and Educational Features: AI-powered features, including Heyza, are provided for general educational, organizational, and analytical purposes only. They do not constitute financial, investment, legal, tax, or professional advice.',
      '4. User Account: Users are responsible for maintaining credential confidentiality and must provide accurate information.',
      '5. Software Availability: Provided on an "as is" and "as available" basis without guarantee of uninterrupted availability.',
      '6. User Data: Users retain ownership of their trading records and notes, subject to our Privacy Policy.',
      '7. Limitation of Liability: FXJournalPro and its operators shall not be responsible for indirect, incidental, consequential, or trading losses arising from the use of the platform or independent brokerage decisions.',
      '8. Risk: Trading financial instruments involves substantial financial risk. Users are solely responsible for evaluating risks.',
      '9. Intellectual Property: All software, branding, designs, text, graphics, and materials remain the property of FXJournalPro or its licensors.',
      '10. Modifications: Continued use of FXJournalPro after an update constitutes acceptance of the revised Terms.',
      '11. Governing Law: Governed by the laws of India. Disputes subject to jurisdiction of courts in Kerala, India.',
      '12. Contact: FXJournalPro, Kasaragod, Kerala, India. Email: contact@fxjournalpro.com | Phone/WhatsApp: +91 81368 02573',
    ],
  },

  privacy: {
    title: 'Privacy Policy',
    lastUpdated: 'October 2026',
    subtitle: 'How we collect, protect, and handle your information.',
    sections: [
      {
        paragraphs: [
          'FXJournalPro respects your privacy and is committed to protecting personal information submitted through our website and application.',
        ],
      },
      {
        heading: '1. Information We Collect',
        paragraphs: [
          'Depending on how you use FXJournalPro, we may collect:',
        ],
        bullets: [
          'Name',
          'Email address',
          'Account information',
          'Subscription information',
          'Trading records entered or imported by you',
          'Trading notes and journal information',
          'Account preferences',
          'Technical and device information necessary to operate and secure the service',
          'Payment and transaction references provided by our payment provider',
        ],
      },
      {
        paragraphs: [
          'We do not require users to provide their broker trading password to FXJournalPro for ordinary journaling functionality.',
        ],
      },
      {
        heading: '2. Trading Data',
        paragraphs: [
          'Trading information may include details such as:',
        ],
        bullets: [
          'Trading account information',
          'Symbol',
          'Entry and exit prices',
          'Lot size',
          'Trade dates and times',
          'Profit/loss',
          'Trading notes',
          'Other information voluntarily entered or synchronized by the user',
        ],
      },
      {
        paragraphs: [
          'This information is used to provide journaling, analytics, reporting, synchronization, and related features.',
        ],
      },
      {
        heading: '3. MT5 Synchronization',
        paragraphs: [
          'When users enable MT5 synchronization, relevant trading-history information may be transferred from the supported synchronization method to FXJournalPro.',
          'FXJournalPro does not use this information to execute trades or transfer funds.',
        ],
      },
      {
        heading: '4. Payment Information',
        paragraphs: [
          'Payments are processed by our third-party payment provider.',
          'FXJournalPro does not intentionally store complete debit-card or credit-card numbers or CVV information.',
          "Payment processing is subject to the payment provider's own terms and privacy policies.",
        ],
      },
      {
        heading: '5. AI Services',
        paragraphs: [
          'Certain FXJournalPro features may use third-party AI infrastructure to process information necessary to provide AI-generated journal analysis and related functionality.',
          'Where AI features are used, information is processed only to provide the requested functionality and in accordance with our agreements and applicable privacy requirements.',
        ],
      },
      {
        heading: '6. Service Providers',
        paragraphs: [
          'We may use third-party providers for services such as:',
        ],
        bullets: [
          'Cloud database and authentication infrastructure',
          'Payment processing',
          'Transactional email delivery',
          'AI processing',
          'MT5 synchronization or related infrastructure',
          'Hosting and security',
        ],
      },
      {
        paragraphs: [
          'These providers process information only as necessary to provide their respective services.',
        ],
      },
      {
        heading: '7. Data Security',
        paragraphs: [
          'We use reasonable technical and organizational security measures to protect user information, including encrypted communications and secure authentication mechanisms.',
          'Passwords are stored using secure password hashing mechanisms and are not stored in plain text.',
        ],
      },
      {
        heading: '8. No Sale of Personal Data',
        paragraphs: [
          "We do not sell or rent users' personal information, journal records, or trading statistics to third parties for advertising or unrelated commercial purposes.",
        ],
      },
      {
        heading: '9. Data Retention and Deletion',
        paragraphs: [
          'Users may request deletion of their account and associated personal information by contacting: contact@fxjournalpro.com',
          'Certain information may be retained where required by applicable law, accounting requirements, fraud prevention, dispute resolution, or legitimate business purposes.',
        ],
      },
      {
        heading: '10. User Rights',
        paragraphs: [
          'Subject to applicable law, users may request access to, correction of, export of, or deletion of their personal information.',
        ],
      },
      {
        heading: '11. Contact',
        paragraphs: [
          'FXJournalPro',
          'Kasaragod, Kerala, India',
          'Email: contact@fxjournalpro.com',
          'Phone / WhatsApp: +91 81368 02573',
        ],
      },
    ],
    body: [
      'FXJournalPro respects your privacy and is committed to protecting personal information submitted through our website and application.',
      '1. Information We Collect: Name, email address, account information, subscription info, trading records and notes, account preferences, technical information, and payment references. We do NOT require or store broker trading passwords.',
      '2. Trading Data: Symbol, entry/exit prices, lot size, timestamps, PnL, and notes entered or synced by the user to provide journaling and performance analytics.',
      '3. MT5 Synchronization: Syncs read-only trade history for journaling; does not execute trades or transfer funds.',
      '4. Payment Information: Processed securely by our third-party payment provider (Razorpay). We do not store card numbers or CVV codes.',
      '5. AI Services: Third-party AI infrastructure processes journal data solely to provide requested educational and analytical insights.',
      '6. Service Providers: Secure cloud database, payment processing, email delivery, AI processing, MT5 synchronization, and hosting providers.',
      '7. Data Security: Encrypted communications (SSL), secure authentication, and salted password hashing.',
      '8. No Sale of Personal Data: We never sell or rent your personal information, journal records, or trading statistics.',
      '9. Data Retention and Deletion: Request account deletion anytime at contact@fxjournalpro.com.',
      '10. User Rights: Access, correct, export, or delete your personal data upon request.',
      '11. Contact: FXJournalPro, Kasaragod, Kerala, India | contact@fxjournalpro.com | +91 81368 02573',
    ],
  },

  refunds: {
    title: 'Cancellation & Refund Policy',
    lastUpdated: 'October 2026',
    subtitle: 'Transparent terms for digital subscription access and refunds.',
    sections: [
      {
        paragraphs: [
          'FXJournalPro provides digital SaaS subscriptions. No physical goods are sold or shipped.',
        ],
      },
      {
        heading: 'Subscription',
        paragraphs: [
          'The core journaling functionality of FXJournalPro may be available under the Free plan. Certain advanced features are available under the Pro subscription.',
          'The applicable subscription price, billing period, and available features are displayed on the pricing/checkout page before payment.',
        ],
      },
      {
        heading: 'Cancellation',
        paragraphs: [
          'Users may cancel their subscription or disable renewal through their account settings where available or by contacting: contact@fxjournalpro.com',
          'Cancellation prevents future renewal charges but does not automatically constitute a refund for a previous billing period unless the user qualifies under this Refund Policy or applicable law.',
        ],
      },
      {
        heading: '7-Day Refund Policy',
        paragraphs: [
          'Users may request a refund within 7 calendar days of the initial Pro purchase if the paid features cannot reasonably be used because of a technical issue attributable to FXJournalPro and our support team is unable to resolve the issue.',
          'Refund requests should include:',
        ],
        bullets: [
          'Registered email address',
          'Payment/transaction reference',
          'Description of the issue',
        ],
      },
      {
        heading: 'Refund Processing',
        paragraphs: [
          'Approved refunds will be initiated through the original payment method or payment provider, subject to applicable payment-provider processing timelines.',
        ],
      },
      {
        heading: 'Non-Refundable Circumstances',
        paragraphs: [
          'Refunds are generally not provided for:',
        ],
        bullets: [
          'Trading losses',
          'Investment losses',
          'Poor trading performance',
          'Dissatisfaction with personal trading results',
          'Failure to achieve a particular trading outcome',
          'Decisions made using information generated by the platform',
        ],
      },
      {
        heading: 'Duplicate Payments',
        paragraphs: [
          'If a user is accidentally charged more than once for the same subscription, the duplicate transaction will be reviewed and, where confirmed, refunded.',
        ],
      },
      {
        heading: 'Contact',
        paragraphs: [
          'Refund requests: contact@fxjournalpro.com',
        ],
      },
    ],
    body: [
      'FXJournalPro provides digital SaaS subscriptions. No physical goods are sold or shipped.',
      'Subscription: Core trade logging is available on the Free plan; advanced analytics and MT5 sync require Pro. Pricing and billing terms are clearly displayed before payment.',
      'Cancellation: Cancel renewal anytime via account settings or by emailing contact@fxjournalpro.com.',
      '7-Day Refund Policy: Full refund within 7 calendar days of initial Pro purchase if technical issues attributable to FXJournalPro prevent usage and cannot be resolved by support. Provide registered email, transaction reference, and issue description.',
      'Refund Processing: Approved refunds are credited to the original payment method subject to payment provider timelines.',
      'Non-Refundable: Refunds are not provided for trading losses, market performance, personal dissatisfaction with trade results, or financial decisions.',
      'Duplicate Payments: Verified duplicate charges will be refunded promptly.',
      'Contact for refunds: contact@fxjournalpro.com',
    ],
  },

  shipping: {
    title: 'Shipping & Delivery Policy',
    lastUpdated: 'October 2026',
    subtitle: 'Instant digital provisioning for cloud SaaS services.',
    sections: [
      {
        paragraphs: [
          'FXJournalPro is a 100% digital cloud-based SaaS platform. No physical products are sold, packaged, or shipped.',
        ],
      },
      {
        heading: 'Digital Delivery',
        paragraphs: [
          "After successful payment authorization, eligible Pro features are activated electronically on the user's FXJournalPro account.",
          'Activation is normally automatic.',
        ],
      },
      {
        heading: 'Delivery Time',
        paragraphs: [
          'Pro access is normally provided immediately after successful payment confirmation, subject to payment-provider processing and technical availability.',
        ],
      },
      {
        heading: 'Confirmation',
        paragraphs: [
          'A payment confirmation or receipt may be sent to the registered email address.',
        ],
      },
      {
        heading: 'Failure to Receive Access',
        paragraphs: [
          'If a user has successfully completed payment but Pro access has not been activated, the user should contact: contact@fxjournalpro.com with the payment transaction/reference ID.',
        ],
      },
    ],
    body: [
      'FXJournalPro is a 100% digital cloud-based SaaS platform. No physical products are sold, packaged, or shipped.',
      'Digital Delivery: After successful payment authorization, eligible Pro features are activated electronically on your account. Activation is normally automatic.',
      'Delivery Time: Pro access is provided immediately upon successful payment confirmation.',
      'Confirmation: Digital payment confirmation and receipts are sent to the registered email address.',
      'Failure to Receive Access: Email contact@fxjournalpro.com with your payment transaction ID for immediate assistance.',
    ],
  },

  contact: {
    title: 'Contact Us',
    lastUpdated: 'October 2026',
    subtitle: 'We are here to help with support, inquiries, and feedback.',
    sections: [
      {
        paragraphs: [
          'We welcome questions, technical support requests, feedback, and other inquiries regarding FXJournalPro.',
        ],
      },
      {
        heading: 'Customer Support',
        paragraphs: [
          'Email: contact@fxjournalpro.com',
          'Phone / WhatsApp: +91 81368 02573',
        ],
      },
      {
        heading: 'Social Channels',
        paragraphs: [
          'Instagram: @fx_journalpro',
          'Telegram: @Contact_fxjournalpro',
        ],
      },
      {
        heading: 'Business Address',
        paragraphs: [
          'FXJournalPro',
          'Kasaragod, Kerala, India',
        ],
      },
      {
        heading: 'Support Hours',
        paragraphs: [
          'Monday–Saturday: 9:00 AM–6:00 PM IST',
          'Closed on applicable national holidays.',
        ],
      },
      {
        heading: 'Grievance & Compliance Contact',
        paragraphs: [
          'Name: Akshayraj',
          'Email: contact@fxjournalpro.com',
          'We aim to respond to customer inquiries within 24–48 business hours.',
        ],
      },
    ],
    body: [
      'Customer Support Email: contact@fxjournalpro.com',
      'Phone / WhatsApp: +91 81368 02573',
      'Instagram: @fx_journalpro | Telegram: @Contact_fxjournalpro',
      'Business Address: FXJournalPro, Kasaragod, Kerala, India',
      'Support Hours: Monday–Saturday, 9:00 AM–6:00 PM IST (Closed on National Holidays)',
      'Grievance & Compliance Officer: Akshayraj (contact@fxjournalpro.com)',
      'Response Time: We aim to respond to customer inquiries within 24–48 business hours.',
    ],
  },

  risk: {
    title: 'Risk Disclosure & Disclaimer',
    lastUpdated: 'October 2026',
    subtitle: 'Important notice regarding the risks of financial trading.',
    sections: [
      {
        heading: 'Trading Risk',
        paragraphs: [
          'Trading foreign exchange, commodities, indices, CFDs, and other leveraged financial instruments involves substantial financial risk and may result in the loss of capital.',
          'Leverage can significantly increase both potential gains and potential losses.',
        ],
      },
      {
        heading: 'FXJournalPro Is Not a Broker',
        paragraphs: [
          'FXJournalPro is a software and analytics platform.',
          'FXJournalPro does not:',
        ],
        bullets: [
          'execute trades;',
          'hold customer trading funds;',
          'manage investment capital;',
          'provide brokerage services;',
          'provide managed accounts;',
          'provide copy trading;',
          'provide guaranteed returns; or',
          'act as an investment adviser.',
        ],
      },
      {
        heading: 'No Financial Advice',
        paragraphs: [
          'Information, analytics, reports, educational content, and AI-generated insights available through FXJournalPro are provided for general informational and analytical purposes.',
          'They are not financial, investment, legal, tax, or professional advice.',
        ],
      },
      {
        heading: 'User Responsibility',
        paragraphs: [
          'Users are solely responsible for their trading decisions, brokerage accounts, investment choices, and financial outcomes.',
          'Past performance does not guarantee future results.',
        ],
      },
    ],
    body: [
      'Trading Risk: Trading foreign exchange, commodities, indices, CFDs, and other leveraged financial instruments involves substantial financial risk and may result in the loss of capital. Leverage can increase both gains and losses.',
      'FXJournalPro Is Not a Broker: FXJournalPro is solely a software and analytics platform. We do NOT execute trades, hold customer funds, manage capital, provide brokerage services, offer copy-trading, or guarantee returns.',
      'No Financial Advice: Information, analytics, reports, educational content, and AI insights (Heyza) are for general educational and analytical purposes only. They are not investment, legal, tax, or financial advice.',
      'User Responsibility: Users are solely responsible for their trading decisions and financial outcomes. Past performance does not guarantee future results.',
    ],
  },

  about: {
    title: 'About FXJournalPro',
    lastUpdated: 'October 2026',
    subtitle: 'Trade Better. Understand Your Performance.',
    sections: [
      {
        paragraphs: [
          'FXJournalPro is a cloud-based trading journal and performance analytics platform built for traders who want to track, review, and understand their trading performance.',
          'We bring journaling, analytics, reporting, charts, trading tools, MT5 trade-history synchronization, and AI-powered insights together in one platform.',
        ],
      },
      {
        heading: 'What We Do',
        paragraphs: [
          'FXJournalPro helps users:',
        ],
        bullets: [
          'Record and organize their trades',
          'Track profit, loss, win rate, risk-reward, and other performance metrics',
          'Analyze historical trading performance',
          'Review trading behavior and patterns',
          'Generate trading reports',
          'Synchronize their own MT5 trading history',
          'Use charts and trading tools',
          'Review their journal with Heyza, our AI-powered trading journal assistant',
        ],
      },
      {
        heading: 'Built for Personal Trading Analysis',
        paragraphs: [
          'FXJournalPro is designed to help traders understand their own trading activity and make better-informed decisions through organized data and performance analysis.',
          'Our goal is to make trading records easier to understand and help users develop greater awareness, consistency, and discipline.',
        ],
      },
      {
        heading: 'What FXJournalPro Is Not',
        paragraphs: [
          'FXJournalPro is a software and analytics platform.',
          'We do not:',
        ],
        bullets: [
          'Operate as a broker',
          'Execute trades on behalf of users',
          'Hold or manage customer investment funds',
          'Accept trading deposits or investment capital',
          'Provide managed trading accounts',
          'Provide copy-trading services',
          'Provide brokerage or remittance services',
          'Guarantee profits or investment returns',
          'Provide personalized financial or investment advice',
        ],
      },
      {
        paragraphs: [
          'When MT5 synchronization is used, it is intended to import or synchronize the user\'s own trading-history data for journaling and analysis. It does not give FXJournalPro control over the user\'s funds or trading decisions.',
        ],
      },
      {
        heading: 'Our AI Assistant — Heyza',
        paragraphs: [
          'Heyza helps users review and analyze their own journal data, trading behavior, and historical performance.',
          'Heyza provides software-generated educational and analytical insights. It does not provide personalized financial advice, trade execution, guaranteed results, or instructions to buy or sell financial instruments.',
        ],
      },
      {
        heading: 'Our Mission',
        paragraphs: [
          'Our mission is simple: Help traders turn their trading history into meaningful insights.',
          'By combining structured journaling, data-driven analytics, and intelligent tools, FXJournalPro aims to help traders become more aware, organized, and disciplined.',
        ],
      },
      {
        heading: 'Contact Us',
        paragraphs: [
          'FXJournalPro',
          'Kasaragod, Kerala, India',
          'Email: contact@fxjournalpro.com',
          'Phone / WhatsApp: +91 81368 02573',
          'Support Hours: Monday–Saturday, 9:00 AM–6:00 PM IST',
        ],
      },
    ],
    footerNote:
      'FXJournalPro is a software and analytics service and does not provide brokerage, investment management, trade execution, or financial advisory services. Trading financial instruments involves substantial risk. Users are solely responsible for their trading decisions and financial outcomes.',
    body: [
      'FXJournalPro is a cloud-based trading journal and performance analytics platform built for traders who want to track, review, and understand their trading performance.',
      'We bring journaling, analytics, reporting, charts, trading tools, MT5 trade-history synchronization, and AI-powered insights together in one platform.',
      'What We Do: Record trades, track metrics (win rate, PnL, risk-reward), analyze behavior patterns, generate reports, synchronize MT5 history, and review insights with Heyza AI.',
      'What FXJournalPro Is Not: We are NOT a broker, do NOT execute trades, do NOT manage customer funds, do NOT accept deposits, do NOT provide copy-trading, and do NOT offer financial advice.',
      'Our AI Assistant — Heyza: Provides software-generated educational and analytical insights based on your journal data. Does not provide trade signals or financial advice.',
      'Our Mission: Help traders turn their trading history into meaningful insights with discipline and organization.',
      'Contact: FXJournalPro, Kasaragod, Kerala, India | contact@fxjournalpro.com | +91 81368 02573',
    ],
  },
};

export type LegalDocKey = keyof typeof LEGAL_DOCS;

export function resolveDocKeyFromPath(path: string): LegalDocKey | null {
  const clean = path.toLowerCase().replace(/^\/+|\/+$/g, '');
  if (['terms', 'terms-and-conditions', 'terms-of-service', 'tos'].includes(clean)) return 'terms';
  if (['privacy', 'privacy-policy'].includes(clean)) return 'privacy';
  if (['refunds', 'refund', 'refund-policy', 'cancellation-refund', 'cancellation-and-refund-policy'].includes(clean)) return 'refunds';
  if (['shipping', 'shipping-delivery', 'shipping-and-delivery', 'shipping-policy'].includes(clean)) return 'shipping';
  if (['risk', 'risk-disclosure', 'disclaimer'].includes(clean)) return 'risk';
  if (['contact', 'contact-us', 'support'].includes(clean)) return 'contact';
  if (['about', 'about-us'].includes(clean)) return 'about';
  return null;
}
