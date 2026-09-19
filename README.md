

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set your Supabase values in [.env.local](.env.local):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_KEY`
   - `VITE_SITE_URL` for your production frontend, for example `https://www.fxjournalpro.com`
3. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Google Sign-In

To enable Google sign-in with Supabase:

1. In Supabase Dashboard, enable the Google provider under Authentication.
2. Add your Google OAuth client ID and secret in Supabase.
3. Set the Supabase Site URL to your production frontend, for example `https://www.fxjournalpro.com`.
4. Add redirect URLs for local and production use, such as:
   - `http://localhost:3000/**`
   - `https://www.fxjournalpro.com/**`
   - your Vercel preview URL pattern if you use previews
# Fx-journal-pro
