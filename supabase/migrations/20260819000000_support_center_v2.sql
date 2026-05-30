-- Support Center v2 — self-service learning hub.
--
-- Adds help articles, interactive walkthroughs, and per-user onboarding
-- checklist progress, and widens bug reports / feature requests with
-- priority, page, and category fields. RLS keeps per-user data private
-- while content (articles, walkthroughs) is world-readable.

-- ---- Widen bug reports & feature requests --------------------------
alter table public.support_bug_reports
  add column if not exists priority text not null default 'medium',
  add column if not exists page     text;

alter table public.support_feature_requests
  add column if not exists category text not null default 'other';

-- ---- Help articles --------------------------------------------------
create table if not exists public.support_help_articles (
  slug         text primary key,
  title        text not null,
  category     text not null default 'general',
  body         text not null,
  keywords     text[] not null default '{}',
  sort_order   integer not null default 0,
  is_published boolean not null default true,
  updated_at   timestamptz not null default now()
);
alter table public.support_help_articles enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='support_help_articles' and policyname='help_articles_public_read') then
    create policy help_articles_public_read on public.support_help_articles
      for select to anon, authenticated using (is_published = true);
  end if;
end $$;

-- ---- Interactive walkthroughs --------------------------------------
-- `steps` is a jsonb array of { title, body } objects.
create table if not exists public.support_walkthroughs (
  slug             text primary key,
  title            text not null,
  est_minutes      integer not null default 2,
  steps            jsonb not null default '[]'::jsonb,
  success_message  text,
  sort_order       integer not null default 0,
  is_published     boolean not null default true,
  updated_at       timestamptz not null default now()
);
alter table public.support_walkthroughs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='support_walkthroughs' and policyname='walkthroughs_public_read') then
    create policy walkthroughs_public_read on public.support_walkthroughs
      for select to anon, authenticated using (is_published = true);
  end if;
end $$;

-- ---- Onboarding checklist progress ---------------------------------
create table if not exists public.support_onboarding_progress (
  user_id      uuid not null references auth.users(id) on delete cascade,
  step_id      text not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, step_id)
);
alter table public.support_onboarding_progress enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='support_onboarding_progress' and policyname='onboarding_owner_all') then
    create policy onboarding_owner_all on public.support_onboarding_progress
      for all to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end $$;

-- ---- Seed help articles --------------------------------------------
insert into public.support_help_articles (slug, title, category, body, keywords, sort_order) values
  ('booking-approval', 'Booking Approval', 'bookings',
   'When a client books from your link, the request lands in Approvals instead of going straight to your calendar. Open it, review the details, then Approve, Request Deposit, or Decline. Approved requests automatically create the appointment and notify the client.',
   array['approve','approval','request','accept','decline','pending'], 10),
  ('deposits', 'Deposits', 'money',
   'Deposits hold the slot. Open Settings → Services, pick a service, scroll to Deposit Settings, enter a dollar amount or percentage, and save. Clients pay the deposit during booking (or after approval) and the remaining balance is owed at the appointment.',
   array['deposit','retainer','prepay','hold','payment'], 20),
  ('contracts', 'Contracts', 'bookings',
   'Create a contract template under Settings → Contracts, then attach it to one or more services. When a booking is approved the client is asked to e-sign before the appointment. You and the client get an emailed copy and a record stays in the app.',
   array['contract','agreement','sign','signature','liability'], 30),
  ('scheduling', 'Scheduling', 'calendar',
   'The Schedule tab shows your day, week, and month. Tap any open slot to add an appointment, block off time, or paste a saved quote as a booking. Drag-and-rebook coming soon.',
   array['schedule','schedule','book','calendar','time'], 40),
  ('calendar', 'Calendar', 'calendar',
   'Switch between Day, Week, and Month from the toggle at the top. Tap any appointment to view details, edit, message the client, or open the contract.',
   array['calendar','month','week','day'], 50),
  ('pricing-calculator', 'Pricing Calculator', 'money',
   'Open the Calculator tab to build a quote — base price, add-ons, discounts, tip. Save it for later or convert it directly into a booking. Saved quotes now live inside the calculator.',
   array['pricing','quote','calculator','estimate','add-on'], 60),
  ('style-presets', 'Style Presets', 'services',
   'Style Presets are reusable templates with pricing, duration, and add-ons baked in. Save your most-requested looks once and drop them into a quote or appointment in one tap.',
   array['preset','template','style','reuse'], 70),
  ('clients', 'Clients', 'clients',
   'The Clients tab is your CRM. Clients are auto-created from bookings or added manually. Each card shows contact info, history, notes, photos, and lifetime value.',
   array['client','crm','contact'], 80),
  ('client-notes', 'Client Notes', 'clients',
   'Tap a client and open Notes to track allergies, preferences, hair history, anything that should travel between appointments. Notes are private to you.',
   array['notes','memory','allergy','preference'], 90),
  ('client-photos', 'Client Photos', 'clients',
   'Upload before/after photos to a client''s record. Photos sync across every signed-in device and live in a private storage bucket only your account can read.',
   array['photo','before','after','gallery'], 100),
  ('client-love', 'Client Love Reviews', 'marketing',
   'After an appointment we email the client a one-tap review link. Approved reviews show up under Reviews and can be shared to your booking page.',
   array['review','testimonial','rating','feedback'], 110),
  ('money-dashboard', 'Money Dashboard', 'money',
   'The Money tab summarizes earnings, deposits collected, balances owed, and your tax pack. Filter by date range to see today, this week, this month, or custom.',
   array['money','earnings','revenue','dashboard','income'], 120),
  ('cloud-backup', 'Cloud Backup', 'account',
   'Sign in to enable Cloud Backup. Everything — clients, services, bookings, photos — syncs across every device you sign in on. Guest mode keeps data local only.',
   array['backup','sync','cloud','restore'], 130),
  ('waitlist', 'Waitlist', 'bookings',
   'When a client requests a time you can''t take, add them to the Waitlist. If a slot opens, the app surfaces matching waitlist clients so you can offer the spot.',
   array['waitlist','wait','queue','cancel'], 140),
  ('availability', 'Availability', 'calendar',
   'Set your working hours under Settings → Availability. Add buffers between appointments and block recurring days off. Clients only see slots that fit your real availability.',
   array['hours','availability','open','closed','buffer'], 150),
  ('booking-policies', 'Booking Policies', 'bookings',
   'Settings → Booking Policies controls cancellation windows, no-show fees, reschedule rules, and the fine print clients see at checkout.',
   array['policy','cancel','reschedule','no-show','rules'], 160),
  ('email-notifications', 'Email Notifications', 'account',
   'Booking confirmations, reminders, contract signatures, and reviews are all sent by email automatically. You can preview every template under Settings → Reminders.',
   array['email','notification','reminder','confirmation'], 170),
  ('rescheduling', 'Rescheduling', 'bookings',
   'Open an appointment, tap Reschedule, pick a new time. The client gets an email with the new details and the contract carries over.',
   array['reschedule','move','change time'], 180),
  ('cancellations', 'Cancellations', 'bookings',
   'Open an appointment and tap Cancel. Your booking policy determines whether the deposit is refundable. The slot opens back up immediately.',
   array['cancel','refund','deposit'], 190)
on conflict (slug) do update set
  title = excluded.title,
  category = excluded.category,
  body = excluded.body,
  keywords = excluded.keywords,
  sort_order = excluded.sort_order,
  updated_at = now();

-- ---- Seed walkthroughs ---------------------------------------------
insert into public.support_walkthroughs (slug, title, est_minutes, steps, success_message, sort_order) values
  ('booking-approval', 'How Booking Approval Works', 2,
   jsonb_build_array(
     jsonb_build_object('title','Open Approvals','body','From the Settings menu, tap Approvals to see incoming booking requests.'),
     jsonb_build_object('title','Review the request','body','Check the service, date, time, and client notes.'),
     jsonb_build_object('title','Approve, Request Deposit, or Decline','body','Pick the action that fits — Approve schedules it, Request Deposit holds the slot, Decline frees it.'),
     jsonb_build_object('title','Client gets emailed','body','We send the confirmation automatically.')
   ),
   'You''re ready to manage incoming bookings.', 10),
  ('deposits', 'How Deposits Work', 2,
   jsonb_build_array(
     jsonb_build_object('title','Open Services','body','Settings → Services.'),
     jsonb_build_object('title','Select a service','body','Tap the service you want to require a deposit for.'),
     jsonb_build_object('title','Find Deposit Settings','body','Scroll to the Deposit section.'),
     jsonb_build_object('title','Enter the deposit amount','body','Set a flat dollar amount or a percentage of the service.'),
     jsonb_build_object('title','Save service','body','Tap Save. Future bookings will collect this deposit.')
   ),
   'You''re ready to collect deposits.', 20),
  ('contracts', 'How Contracts Work', 3,
   jsonb_build_array(
     jsonb_build_object('title','Open Contracts','body','Settings → Contracts.'),
     jsonb_build_object('title','Create a template','body','Tap New Template, pick a type, paste your terms.'),
     jsonb_build_object('title','Attach it to services','body','From the template, choose which services it applies to.'),
     jsonb_build_object('title','Client signs at booking','body','Approved bookings prompt the client to e-sign before the appointment.'),
     jsonb_build_object('title','Records are saved','body','You and the client get an emailed copy; the original lives in the app.')
   ),
   'You''re ready to use contracts.', 30),
  ('pricing-calculator', 'Pricing Calculator', 2,
   jsonb_build_array(
     jsonb_build_object('title','Open the Calculator tab','body','From the bottom nav.'),
     jsonb_build_object('title','Pick a base price or preset','body','Start with a service preset or type a base price.'),
     jsonb_build_object('title','Add add-ons and discounts','body','Tap + on the add-ons or discounts row.'),
     jsonb_build_object('title','Save or book','body','Tap Save Quote to keep it, or Book to turn it into an appointment.')
   ),
   'Your quote is ready.', 40),
  ('managing-clients', 'Managing Clients', 2,
   jsonb_build_array(
     jsonb_build_object('title','Open the Clients tab','body','From the bottom nav.'),
     jsonb_build_object('title','Add or tap a client','body','New clients are created automatically from bookings, or tap + to add manually.'),
     jsonb_build_object('title','Update notes, photos, contact','body','Tap a client to update notes, attach photos, or copy their phone/email.'),
     jsonb_build_object('title','See history at a glance','body','Lifetime value, last visit, and upcoming appointments all live on the card.')
   ),
   'You''re running a real CRM now.', 50),
  ('style-presets', 'Style Presets', 2,
   jsonb_build_array(
     jsonb_build_object('title','Open Style Presets','body','From Settings, tap Style Presets.'),
     jsonb_build_object('title','Create a preset','body','Add a name, base price, default duration, and any add-ons.'),
     jsonb_build_object('title','Drop into a quote or booking','body','From the calculator or a new appointment, pick the preset to pre-fill everything.')
   ),
   'Your favorite looks are one tap away.', 60),
  ('cloud-backup', 'Cloud Backup', 1,
   jsonb_build_array(
     jsonb_build_object('title','Sign in','body','Settings → Account & Sync → Sign in.'),
     jsonb_build_object('title','Verify backup is on','body','You''ll see Cloud Backup: Active under Support → About.'),
     jsonb_build_object('title','Sign in on another device','body','Your data appears automatically.')
   ),
   'Your business is safely backed up.', 70),
  ('availability-setup', 'Availability Setup', 2,
   jsonb_build_array(
     jsonb_build_object('title','Open Availability','body','Settings → Availability.'),
     jsonb_build_object('title','Set working hours','body','Per weekday, set your open and close times.'),
     jsonb_build_object('title','Add buffers','body','Optional gap between appointments for clean-up or travel.'),
     jsonb_build_object('title','Save','body','Clients will only see slots that fit your real hours.')
   ),
   'Your calendar reflects your real schedule.', 80)
on conflict (slug) do update set
  title = excluded.title,
  est_minutes = excluded.est_minutes,
  steps = excluded.steps,
  success_message = excluded.success_message,
  sort_order = excluded.sort_order,
  updated_at = now();

-- ---- Seed an updated release note ----------------------------------
insert into public.support_release_notes (version, title, items, sort_order, published_at)
select '2.4.0', 'Support Center 2.0',
  jsonb_build_array(
    'Self-service learning hub with searchable help articles',
    'Interactive walkthroughs for the most-used flows',
    'Getting Started checklist with progress tracking',
    'Expanded bug reports with priority and page context',
    'Feature requests now categorized for faster triage'
  ),
  240, now()
where not exists (select 1 from public.support_release_notes where version = '2.4.0');

notify pgrst, 'reload schema';
