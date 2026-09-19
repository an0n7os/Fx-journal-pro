// Shared legal copy. Rendered by the in-app footer and by the public landing
// page, so both always show the same text.
//
// NOTE: this copy is plain-language boilerplate written to cover the gaps a
// trading product normally has to cover (risk, refunds, data). It has NOT been
// reviewed by a lawyer. Have counsel check it before launch, particularly the
// refund terms now that Pro is a paid monthly plan.
export const LEGAL_DOCS: Record<string, { title: string; body: string[] }> = {
  risk: {
    title: 'Risk Disclosure',
    body: [
      'Trading foreign exchange, commodities, and contracts for difference carries a high level of risk and is not suitable for every investor. You can lose more than your initial deposit. Before trading, consider your objectives, experience, and risk appetite, and seek independent advice if you are unsure.',
      'FX Journal Pro is a journaling and analysis tool. It does not execute trades, hold funds, or provide investment advice. Nothing in the product — including AI-generated feedback, metrics, scores, or suggestions — is a recommendation to buy or sell any instrument.',
      'Past performance shown in your journal, in sample data, or anywhere on this site is not a reliable indicator of future results. Any figures presented as examples are illustrative and do not represent the results of any specific user.',
      'You remain solely responsible for every order placed with your broker, for the accuracy of data imported into your journal, and for meeting the rules of any prop firm or funded account programme you participate in.',
    ],
  },
  terms: {
    title: 'Terms & Conditions',
    body: [
      'By creating an account you agree to use FX Journal Pro lawfully and to keep your login credentials secure. You are responsible for all activity under your account.',
      'The service is provided on an "as is" basis. We do not warrant that trade syncing, analytics, or third-party data feeds will be uninterrupted, timely, or error-free. Market data and economic calendar entries are sourced from third parties and may be delayed or inaccurate.',
      'We may suspend or terminate accounts that abuse the service, attempt to compromise it, or breach these terms.',
      'To the extent permitted by law, our liability is limited to the amount you have paid us in the twelve months before the claim. We are not liable for trading losses.',
      'We may update these terms. Material changes will be notified in-app before they take effect.',
    ],
  },
  refunds: {
    title: 'Billing & Refunds',
    body: [
      'Core journaling features are free. Pro is a one-time upgrade billed in INR through Razorpay; we never see or store your card details.',
      'If Pro does not work as described, contact contact@fxjournalpro.com within 7 days of payment and we will refund you in full. Refunds are returned to the original payment method and typically settle within 5–10 business days depending on your bank.',
      'We do not refund on the basis of trading losses, since the product does not place trades.',
      'If a payment is taken in error or charged twice, write to us and we will return it without question.',
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    body: [
      'We store the account details you give us (name, email), the trading data you log or sync, and your app preferences. Passwords are stored only as bcrypt hashes and are never readable by us.',
      'Your trading logs, notes, emotional tags, and balances are private to your account. We do not sell user data, trading history, or metrics to anyone.',
      'We use third-party processors to run the service: Supabase (database), Razorpay (payments), an email provider for verification codes, Cloudflare Turnstile (bot protection), and Google Gemini for AI mentor responses. AI prompts include a summary of your recent trades so the coaching is relevant; they are not used to train external models.',
      'MT5 connections use a read-only token or an encrypted investor password. Your broker trading password is never requested or stored.',
      'You can request deletion of your account and all associated data at any time by writing to contact@fxjournalpro.com.',
    ],
  },
};

export type LegalDocKey = keyof typeof LEGAL_DOCS;
