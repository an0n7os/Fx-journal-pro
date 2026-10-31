import dotenv from 'dotenv';
dotenv.config();

const resendKey = process.env.RESEND_API_KEY?.trim();
const to = process.argv[2] || 'aswinasher@gmail.com';
const from = process.argv[3] || process.env.RESEND_PRO_FROM?.trim() || 'FX Journal Pro <Info@fxjournalpro.com>';
const name = 'Aswin';
const expiryFormatted = new Date(Date.now() + 30 * 86400000).toLocaleDateString('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric'
});
const subject = 'Welcome to FX Journal Pro — Your Pro Membership is Active! ⭐';

const emailHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#070a13;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#e2e8f0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#070a13;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:600px;background:linear-gradient(180deg,#0f172a 0%,#0b0f19 100%);border-radius:18px;border:1px solid rgba(139,92,246,0.25);overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);">
        
        <!-- Top Branded Banner -->
        <tr><td style="padding:36px 40px 24px;text-align:center;background:linear-gradient(135deg,rgba(139,92,246,0.15) 0%,rgba(99,102,241,0.05) 100%);border-bottom:1px solid rgba(139,92,246,0.18);">
          <div style="display:inline-block;padding:5px 16px;background:rgba(139,92,246,0.18);border:1px solid rgba(139,92,246,0.35);border-radius:999px;margin-bottom:14px;">
            <span style="font-size:11px;font-weight:800;letter-spacing:1.5px;color:#c084fc;text-transform:uppercase;">★ PRO MEMBERSHIP ACTIVATED ★</span>
          </div>
          <div>
            <h1 style="margin:0;font-size:26px;font-weight:800;background:linear-gradient(135deg,#ffffff 0%,#cbd5e1 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;color:#ffffff;letter-spacing:-0.5px;">
              FX Journal Pro
            </h1>
          </div>
        </td></tr>

        <!-- Main Body -->
        <tr><td style="padding:36px 40px;">
          <p style="margin:0 0 16px;font-size:17px;font-weight:700;color:#f8fafc;">
            Hello ${name},
          </p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#94a3b8;">
            Thank you for upgrading to <strong>FX Journal Pro</strong>! We are thrilled to welcome you to our community of disciplined, data-driven traders. Your Pro membership is now fully active on your account.
          </p>

          <!-- Plan Receipt Box -->
          <div style="background:rgba(139,92,246,0.06);border:1px solid rgba(139,92,246,0.25);border-radius:14px;padding:22px 24px;margin-bottom:28px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
              <tr>
                <td style="color:#64748b;padding-bottom:10px;font-weight:500;">Plan Tier</td>
                <td align="right" style="color:#a855f7;font-weight:700;padding-bottom:10px;">FX Journal Pro Pass</td>
              </tr>
              <tr>
                <td style="color:#64748b;padding-bottom:10px;font-weight:500;">Status</td>
                <td align="right" style="color:#10b981;font-weight:700;padding-bottom:10px;">● Active</td>
              </tr>
              <tr>
                <td style="color:#64748b;font-weight:500;">Valid Until</td>
                <td align="right" style="color:#f1f5f9;font-weight:600;">${expiryFormatted}</td>
              </tr>
            </table>
          </div>

          <!-- Unlocked Features Section -->
          <h2 style="margin:0 0 16px;font-size:13px;font-weight:700;color:#cbd5e1;text-transform:uppercase;letter-spacing:1px;">
            Your Unlocked Pro Superpowers:
          </h2>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:30px;">
            <tr>
              <td style="padding-bottom:14px;vertical-align:top;width:28px;">
                <span style="display:inline-block;width:20px;height:20px;line-height:20px;border-radius:50%;background:#8b5cf6;color:#ffffff;text-align:center;font-size:12px;font-weight:bold;">✓</span>
              </td>
              <td style="padding-bottom:14px;padding-left:10px;vertical-align:top;">
                <strong style="color:#f1f5f9;font-size:14px;">MT5 Real-Time Auto Sync:</strong>
                <p style="margin:2px 0 0;color:#94a3b8;font-size:13px;line-height:1.5;">Connect your MetaTrader 5 terminal once and your trades, executions, and balances sync automatically in real-time.</p>
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:14px;vertical-align:top;width:28px;">
                <span style="display:inline-block;width:20px;height:20px;line-height:20px;border-radius:50%;background:#8b5cf6;color:#ffffff;text-align:center;font-size:12px;font-weight:bold;">✓</span>
              </td>
              <td style="padding-bottom:14px;padding-left:10px;vertical-align:top;">
                <strong style="color:#f1f5f9;font-size:14px;">Advanced Analytics &amp; Expectancy Edge:</strong>
                <p style="margin:2px 0 0;color:#94a3b8;font-size:13px;line-height:1.5;">Gain deep statistical clarity with equity drawdown curves, day-of-week win rates, and expectancy edge metrics.</p>
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:14px;vertical-align:top;width:28px;">
                <span style="display:inline-block;width:20px;height:20px;line-height:20px;border-radius:50%;background:#8b5cf6;color:#ffffff;text-align:center;font-size:12px;font-weight:bold;">✓</span>
              </td>
              <td style="padding-bottom:14px;padding-left:10px;vertical-align:top;">
                <strong style="color:#f1f5f9;font-size:14px;">Verified Journal Sharing:</strong>
                <p style="margin:2px 0 0;color:#94a3b8;font-size:13px;line-height:1.5;">Create private, verified read-only links with portfolio-level isolation to showcase your track record to mentors or prop firms.</p>
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:14px;vertical-align:top;width:28px;">
                <span style="display:inline-block;width:20px;height:20px;line-height:20px;border-radius:50%;background:#8b5cf6;color:#ffffff;text-align:center;font-size:12px;font-weight:bold;">✓</span>
              </td>
              <td style="padding-bottom:14px;padding-left:10px;vertical-align:top;">
                <strong style="color:#f1f5f9;font-size:14px;">Unlimited Portfolios &amp; Trade Logs:</strong>
                <p style="margin:2px 0 0;color:#94a3b8;font-size:13px;line-height:1.5;">No limits on your accounts, trade history, chart screenshots, or professional spreadsheet exports.</p>
              </td>
            </tr>
          </table>

          <!-- CTA Button -->
          <div style="text-align:center;margin:32px 0;">
            <a href="https://fxjournalpro.com" style="display:inline-block;padding:14px 34px;background:linear-gradient(135deg,#7c3aed 0%,#4f46e5 100%);color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;box-shadow:0 10px 20px -5px rgba(124,58,237,0.4);letter-spacing:0.3px;">
              Open Your Pro Dashboard →
            </a>
          </div>

          <p style="margin:28px 0 8px;font-size:13px;line-height:1.6;color:#94a3b8;">
            If you ever need any assistance setting up your MT5 EA sync or have any questions, our dedicated team is always here for you. Simply reply to this email or write to us at <a href="mailto:Info@fxjournalpro.com" style="color:#a78bfa;text-decoration:none;">Info@fxjournalpro.com</a>.
          </p>

          <p style="margin:16px 0 0;font-size:13px;color:#64748b;line-height:1.6;">
            Wishing you great discipline and consistent execution in your trades,<br>
            <strong style="color:#cbd5e1;">The FX Journal Pro Team</strong>
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:22px 40px;background:rgba(0,0,0,0.25);border-top:1px solid rgba(139,92,246,0.15);text-align:center;">
          <p style="margin:0 0 6px;font-size:12px;color:#475569;">
            © ${new Date().getFullYear()} FX Journal Pro · <a href="https://fxjournalpro.com" style="color:#7c3aed;text-decoration:none;">fxjournalpro.com</a>
          </p>
          <p style="margin:0;font-size:11px;color:#334155;">
            Sent from Info@fxjournalpro.com · Dedicated Trader Support
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

async function run() {
  console.log(`Connecting to Resend...`);
  console.log(`From: ${from}`);
  console.log(`To: ${to}`);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + resendKey
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html: emailHtml
    })
  });

  const data = await response.json();
  console.log('HTTP Status:', response.status);
  console.log('Response:', JSON.stringify(data, null, 2));
}

run().catch(console.error);
