// Shared legal copy compliant with Razorpay merchant onboarding guidelines.
// Rendered by the in-app LegalFooter and by the public landing page modals.

export const LEGAL_DOCS: Record<string, { title: string; body: string[] }> = {
  terms: {
    title: 'Terms & Conditions',
    body: [
      'Welcome to FX Journal Pro. By accessing or using our website, web application, and related software services, you agree to comply with and be bound by these Terms and Conditions.',
      'Nature of Service: FX Journal Pro is strictly an analytical, trade tracking, and personal journaling software platform designed for retail traders. We do NOT operate as a financial broker, do NOT accept trading deposits or handle investor capital, and do NOT provide investment advice, trading tips, or financial recommendations.',
      'Account Responsibilities: You are responsible for maintaining the confidentiality of your login credentials and for all activities conducted under your registered account. You agree to notify us immediately of any unauthorized access.',
      'Software Availability: The service is provided on an "as is" and "as available" basis. While we endeavor to maintain uninterrupted uptime, we do not warrant that trade syncing or third-party data feeds will be completely error-free or uninterrupted at all times.',
      'Limitation of Liability: To the maximum extent permitted by applicable law, FX Journal Pro and its operators shall not be liable for any indirect, incidental, or trading losses resulting from your use of the platform or your execution of trades with your respective brokers.',
      'Governing Law & Jurisdiction: These Terms shall be governed by and construed in accordance with the laws of India. Any legal dispute or claim arising out of or in connection with these terms shall be subject to the exclusive jurisdiction of the competent courts in Kerala, India.',
      'Modifications: We reserve the right to amend these terms at any time. Continued usage of the platform following any modifications constitutes your formal acceptance of the updated terms.',
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    body: [
      'At FX Journal Pro, we respect your privacy and are committed to protecting your personal data. This Privacy Policy explains how we collect, store, and process your information.',
      'Information We Collect: We collect your name, email address, account preferences, and the trading records or notes that you explicitly import, sync, or enter into your journal.',
      'Data Security: All user passwords are encrypted using industry-standard bcrypt hashing. Communications with our servers are secured via 256-bit SSL encryption. We never request or store your live broker trading passwords; MT5 syncing relies exclusively on read-only investor tokens or local Expert Advisor endpoints.',
      'No Sale of Personal Data: We do not sell, rent, monetize, or disclose your personal records, trading statistics, or journal history to third parties or advertising brokers.',
      'Third-Party Service Providers: We partner with trusted, secure infrastructure providers including Supabase (cloud database hosting), Razorpay (encrypted payment gateway), Resend/SendGrid (transactional verification emails), and Google Gemini (private AI analytics). Payment transactions are processed directly by Razorpay; we never handle or store your debit/credit card numbers or CVV codes.',
      'User Rights & Data Deletion: You retain full ownership of your data. You may export your journal data or request permanent deletion of your account and associated records at any time by contacting us at contact@fxjournalpro.com.',
    ],
  },
  refunds: {
    title: 'Cancellation & Refund Policy',
    body: [
      'We believe in fair and transparent pricing. Core trade logging features of FX Journal Pro are permanently free. Pro is a premium upgrade billed securely in Indian Rupees (INR) through Razorpay.',
      'Cancellation Policy: You may discontinue your subscription or cancel renewal at any time directly through your account dashboard or by writing to our support desk.',
      '7-Day Money-Back Guarantee: If our Pro features or automated MT5 syncing fail to function as advertised, or if you encounter technical difficulties that our team cannot resolve, you are entitled to a 100% full refund upon request within 7 calendar days of your initial purchase.',
      'Refund Processing Timeline: To request a refund, please email contact@fxjournalpro.com with your registered email and Razorpay payment transaction reference. Approved refunds are initiated immediately and credited back to the original payment source (Credit/Debit Card, Netbanking, or UPI) within 5 to 7 business days, depending on your card issuer or bank settlement timeline.',
      'Non-Refundable Circumstances: Refunds will not be issued based on market losses or personal trading performance, as FX Journal Pro is solely a trade tracking and analytical journaling utility.',
      'Duplicate Transactions: In the unlikely event of an accidental duplicate charge or technical payment discrepancy, notify us immediately and the duplicate amount will be reversed in full without hesitation.',
    ],
  },
  shipping: {
    title: 'Shipping & Delivery Policy',
    body: [
      'FX Journal Pro is a 100% digital cloud-based Software-as-a-Service (SaaS) application. No physical goods, packages, or tangible parcels are shipped or delivered.',
      'Delivery Method: All product deliverables, features, and dashboard tools are provided digitally via internet access upon user authentication.',
      'Delivery Timeframe: Upon successful authorization of your payment via Razorpay, your Pro license and upgraded account capabilities are activated immediately and automatically.',
      'Confirmation & Invoicing: An automated transaction confirmation and official digital receipt/invoice containing your payment details will be dispatched to your registered email address within 5 to 15 minutes of payment confirmation.',
      'Support & Non-Delivery Escalation: If you do not experience immediate access to your upgraded features within 24 hours of a confirmed transaction, please contact our support team at contact@fxjournalpro.com or call +91 81368 02573 with your payment ID for instantaneous manual provisioning.',
    ],
  },
  contact: {
    title: 'Contact Us',
    body: [
      'We welcome your inquiries, feedback, and support requests. Please feel free to get in touch with our team through any of the following channels:',
      'Support Email: contact@fxjournalpro.com',
      'Official Instagram: @fx_journalpro (https://www.instagram.com/fx_journalpro/)',
      'Official Telegram: @Contact_fxjournalpro (https://t.me/Contact_fxjournalpro)',
      'Customer Support Phone & WhatsApp: +91 81368 02573 (https://wa.me/918136802573)',
      'Operating & Registered Address: FX Journal Pro, Kasaragod, Kerala, India',
      'Customer Support Hours: Monday to Saturday: 9:00 AM – 6:00 PM IST (Closed on National Holidays)',
      'Grievance & Compliance Officer: Akshayraj (Email: contact@fxjournalpro.com)',
      'Response Time: We aim to acknowledge and resolve all general customer inquiries within 24 to 48 business hours.',
    ],
  },
  risk: {
    title: 'Risk Disclosure & Disclaimer',
    body: [
      'Risk Warning: Trading foreign exchange (Forex), commodities, indices, and Contracts for Difference (CFDs) involves substantial financial risk and may not be suitable for all investors. High leverage can work against you as well as for you.',
      'Non-Advisory Tool: FX Journal Pro is exclusively a record-keeping, tracking, and educational software utility. We do NOT provide financial advice, managed accounts, or trade signals. No content or AI feedback produced within the platform should be construed as an invitation, solicitation, or recommendation to buy or sell financial instruments.',
      'Sole Responsibility: Past performance is not indicative of future results. You remain entirely responsible for all trading decisions and financial outcomes executed on your personal brokerage accounts.',
    ],
  },
};

export type LegalDocKey = keyof typeof LEGAL_DOCS;
