# JanSetu — Production-ready civic reporting website

**Owner:** Abhrakantee Sarkar  
**Repository (keep this exact URL):** https://github.com/abhrakantee/JanSetu  
**Existing hosted domain:** https://jansetu-26.vercel.app/

This release upgrades the original JanSetu frontend instead of creating a second brand or requiring a changed repository URL. It is a responsive static frontend connected to a real managed backend (Supabase PostgreSQL, Authentication, object storage and Realtime). The SQL migration, authentication, app features and deployment assets are included. **It will NOT be a live multi-user application until you supply your own Supabase project credentials and run the SQL script.** This is intentional: we cannot create your external service, enable Google OAuth or send real SMS without your provider configuration.

## 1. Features implemented

- Registration-first flow: email/password sign-up, verification email, sign-in, Google OAuth, mobile-number SMS OTP, password reset and sign-out.
- Responsive glass/metallic interface with desktop navbar and mobile bottom navigation. No emojis.
- Real PostgreSQL issue feed, counts and statuses; no fake community reports, supporters or statistics.
- Issue report with category, title, problem description and nearby landmark.
- **Take photo** (opens camera on supporting HTTPS mobile browsers) and **Choose gallery**; previews, MIME/type and 8 MB limit, auto-JPEG compression and metadata removal, cloud image upload.
- User-controlled GPS permissions (HTTPS required), precise coordinate attachment, optional manual landmark, OpenStreetMap/Leaflet community map, map directions.
- Search, category/status filtering, sort, paged issue feed and support votes.
- Personal activity dashboard, profile editing, notifications, report status timeline, signed-in-only access.
- Moderator-only report status updates, author verification of a resolved report, status notifications and database RLS.
- Progressive Web App app icon/manifest, optional offline UI shell, responsive layouts, reduced-motion accessibility.
- Footer: **Made by Abhrakantee Sarkar**.

## 2. Supabase: mandatory backend setup (15 minutes of steps, provider approval times vary)

1. Create a project at https://supabase.com/dashboard. Wait for the project database to be ready.
2. Open **SQL Editor → New query**. Paste the contents of `supabase/schema.sql`, then choose **Run**. This creates six tables, the `report_feed` view, row-level security, server-side functions, notifications, and the `issue-photos` storage bucket.
3. Open **Project Settings → API / Data API**. Copy the **Project URL** and the public **publishable key** (`sb_publishable_…`) or legacy **anon** key (`eyJ…`). Paste into `config.js`:

   ```js
   window.JANSETU_CONFIG = {
     supabaseUrl: 'https://YOUR-PROJECT-ID.supabase.co',
     supabaseAnonKey: 'YOUR_PUBLIC_PUBLISHABLE_OR_ANON_KEY'
   };
   ```

   **Never add `service_role`, `sb_secret_…`, database passwords, OAuth client secrets or SMS provider tokens to config.js or GitHub.** Public project URL and publishable/anon key are specifically designed for browser use, guarded by RLS.
4. In Supabase **Authentication → Providers → Email**, enable email/password authentication. Keep *Confirm email* ON for production. Configure an SMTP provider for real-world deliverability (Supabase test SMTP has limits). Test a registration and verify the email.
5. In **Authentication → URL Configuration**, set the Site URL to your deployment, for example `https://jansetu-26.vercel.app`, and add the full redirect URLs including the trailing slash if applicable:
   - `https://jansetu-26.vercel.app/`
   - `https://abhrakantee.github.io/JanSetu/` (only if you use GitHub Pages)
   - `http://localhost:5500/` (optional local development; match actual port)
6. In **Authentication → Providers → Google**, enable Google and enter a valid OAuth Client ID and **secret** in Supabase. Configure the Google Cloud OAuth consent screen and the redirect URI **shown by Supabase** (normally `https://YOUR-PROJECT-ID.supabase.co/auth/v1/callback`) in Google Cloud. Add the JanSetu domain as authorised origin where appropriate. Google sign-in won't work until this is done.
7. For mobile OTP, enable **Authentication → Providers → Phone** and configure a supported SMS provider (e.g. Twilio, MessageBird, Vonage) within Supabase. In India, commercial SMS delivery often requires **TRAI DLT registration/template approval**. SMS has provider charges, rate limits and abuse controls. Until enabled, email and Google login still work.
8. In Supabase **Storage**, verify that `issue-photos` is **Public** and its upload policies exist; this release deliberately displays report photographs to the community. Users should not upload faces, house numbers, identities, licence plates or other personal details that should not be shared. Read security information below.

## 3. Local development

There is no npm install or separate Express server needed; Supabase hosts the database/API/Auth/Storage.

From VS Code Terminal, inside this `JanSetu` folder:

```bash
python -m http.server 5500
```

Then open **http://localhost:5500/**. Use the *same local URL* as an allowed Supabase Auth redirect, especially for email confirmation / Google OAuth.

**Do not open `index.html` using `file://`**; ES modules, mobile camera/GPS and login redirects need an HTTP(S) origin. Mobile device access should use your HTTPS deployed domain (a computer's `localhost` is not the phone's localhost). On a phone, accept browser camera/location permission when prompted by the relevant JanSetu buttons.

## 4. Keep the existing GitHub repository AND existing Vercel domain

You must deploy these new files to **the same repository**, not make another repository. Put `index.html`, `app.js`, `style.css`, `config.js`, `assets/`, `supabase/`, etc. at the **root** of `https://github.com/abhrakantee/JanSetu` (replacing old root `index.html`, `script.js`, `style.css`).

Option A — VS Code Terminal, clone to a *fresh location* so the commit stays on the same repository:

```bash
git clone https://github.com/abhrakantee/JanSetu.git
cd JanSetu
# Copy the CONTENTS of this ZIP's JanSetu folder here, replacing older frontend files.
# Check that config.js contains the PUBLIC project URL/anon key (not a secret key).
git add -A
git commit -m "JanSetu mobile-first app with Supabase backend"
git push origin main
```

If Vercel is still connected to the repository and configured with **Framework Preset: Other**, **Root Directory: .** and no custom build command, pushing `main` normally redeploys **https://jansetu-26.vercel.app/**. Existing Vercel project/domain links are managed in your Vercel account; this ZIP cannot change them. Verify the deployment settings after uploading.

**Important:** GitHub Pages and Vercel host your static interface; they do not run a PostgreSQL database. Supabase is the persistent hosted backend. The website domain stays the same; it talks securely to Supabase using HTTPS.

## 5. Optional: grant a trusted moderator

After the moderator has completed registration, execute **in the Supabase SQL Editor**, not in the browser:

```sql
insert into public.admins (id)
select id from auth.users where email = 'moderator@example.com'
on conflict do nothing;
```

Only these trusted users see the moderator interface and can move statuses from Reported → In Review → In Progress → Resolved. The original report author can then press **Verify resolution**. Ordinary users cannot change official statuses, which prevents manufactured resolution counts.

## 6. Checklist: end-to-end live testing

- [ ] Open the deployment in a private mobile browser: only **Register / Sign in / Mobile OTP** is visible, not the main app.
- [ ] Register using email; receive verification email; click link; sign in.
- [ ] Check real Google sign-in only after OAuth is enabled; verify SMS OTP only after SMS provider is enabled.
- [ ] Tap Report → Take photo → allow camera, then try Choose gallery and preview; take an ordinary photo only from a safe location.
- [ ] Tap Use current location → allow GPS. Verify the displayed coordinates correspond to the issue location, add a landmark; GPS accuracy varies by device and signal.
- [ ] Submit. Confirm the image appears under **Storage → issue-photos** and a row under **Table Editor → reports**. Check the report on another signed-in browser/device.
- [ ] Support/un-support a report; filter categories and statuses; use the map; check the status timeline and notifications.
- [ ] As a moderator update its status; signed-in reporter should see a notification and be able to verify it after resolution.
- [ ] Test at widths 320, 375, 430, 768 and desktop, and use a real Android/iPhone browser for the camera/gallery prompt.

## 7. Privacy, security and launch notes

The user explicitly starts GPS capture. Browsers require permission and a secure origin (HTTPS); GPS and camera access may be denied or unsupported. The site still allows a written address when GPS permission is unavailable. **Do not promise automatic tracking without consent.** All users must sign in before seeing the community feed. Photo URLs from the public storage bucket can be accessed by anyone who has the URL. For private moderation evidence, adapt the schema to a private bucket with signed URLs before launch.

This app does **not** automatically contact municipal authorities, guarantee repairs, conduct photo moderation, or validate that images are authentic. For a large public launch add abuse reporting/moderation, CAPTCHA, email/SMS abuse protection, spam throttling, image moderation, privacy policy, terms, accessibility review, logging, backups and continuous deployment testing. Do not encourage photographing hazardous sites or people without consent.

**Security cleanup:** The original uploaded frontend exposed a Google Maps browser key inside `index.html`. The new frontend has **no Google Maps key** and uses OpenStreetMap tiles. If the old key is still active, rotate/restrict it in its Google Cloud project and remove it from published commits/history where possible. Never publish a service role key.

## 8. Folder structure

```text
JanSetu/
  index.html             Registration screen + full responsive app
  app.js                 Auth, submissions, image handling, reports, map, profile
  style.css              Responsive liquid-glass / metallic interface
  config.js              Public Supabase project configuration (fill this in)
  assets/                Reused original images, logo and PWA icons
  supabase/schema.sql    PostgreSQL schema, RLS, functions, Storage policies
  manifest.webmanifest   Installable mobile web app metadata
  sw.js                  Offline shell only, never caches private API responses
  vercel.json            Deployment headers
  README.md              Setup and deployment instructions
```


## 8. Upgrade v6: author deletion + private thumbs-up support

This project update keeps the existing JanSetu UI and Supabase project. A **database migration is mandatory** before either of the new features is secure and fully functional.

1. Back up the existing database if reports are important. Run `supabase/upgrade_private_supports_delete.sql` in your **existing project's Supabase SQL Editor**. Do **NOT** run the whole baseline `schema.sql` again on an existing project. The migration is transactional and preserves existing reports and votes.
2. Deploy the changed `index.html`, `app.js`, `style.css`, `sw.js` and `supabase/` directory to a **preview branch**, then verify it on desktop and mobile before merging to production.
3. Test with two different accounts. A user should see **Delete** only on their own report card and details page; another user must not see it. The database also blocks cross-account deletion with row-level security.
4. To delete, press the trash icon on an owned card or **Delete my report** in details, then accept the browser confirmation. The report, its support votes, status events, and related notifications are removed. Its uploaded photo is removed afterward by the author where storage policy permits. Photo cleanup failures are explicitly reported.
5. Every signed-in user can tap the vector **thumbs-up** to support/un-support a report. The count is public; supporter names, emails, profile pictures, and **other people's user IDs** are not exposed by the support table or feed. Each account can support once (database primary key). Members can read only **their own** support rows.
6. Counts are updated in the browser after each vote and when report data is refreshed; they are not guaranteed to appear instantly on other devices without a refresh. The website continues using the existing public evidence-photo storage bucket, so previously shared photo URLs may remain cached temporarily after deletion.

**Security check in Supabase:** Signed in as Account A, try a select on `report_supports`; you should get only Account A's rows. Account B must not be able to delete Account A's report, including through direct API calls. The public `report_feed` view must display only `support_count` and `supported_by_me`, not the list of supporters.

**GitHub/Vercel:** This ZIP intentionally excludes `.git/` because copying another `.git` folder over your working project would damage your Git configuration. Copy the updated **contents** into your existing repository, then create a new branch, commit and push. The current production site remains unchanged until merging the verified preview branch.
