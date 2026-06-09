// Braider Education Hub — static, rules-based lesson content (v1).
//
// No AI generation, no network, no business-logic coupling. This is
// pure reference content the Settings → Braider Education Hub screen
// renders. Adding a lesson = append an object to a category's
// `lessons` array; nothing else needs to change.
//
// Tone guidance baked into the copy: supportive, practical,
// braider-specific, business-minded but plain. Pricing / tax / legal
// points use soft, non-absolute wording ("Consider…", "A common
// approach is…", "Check your local requirements…").

export type EducationLesson = {
  id: string;
  title: string;
  // Minutes — shown as "{n} min read".
  readMinutes: number;
  // Short body. Each string renders as its own paragraph so lessons
  // stay skimmable on mobile.
  body: string[];
  // The single concrete thing to do this week.
  tryThisWeek: string;
  // Optional pointer to an in-app tool. Plain label only — no
  // deep-linking, so this can't break if screens move.
  relatedTool?: string;
};

export type EducationCategory = {
  id: string;
  name: string;
  blurb: string;
  lessons: EducationLesson[];
};

export const EDUCATION_CATEGORIES: EducationCategory[] = [
  {
    id: "pricing",
    name: "Pricing & Profit",
    blurb: "Charge what your time is worth and grow your ticket.",
    lessons: [
      {
        id: "price-braid-services",
        title: "How to price your braid services",
        readMinutes: 4,
        body: [
          "A common approach is to start from your time: estimate the hours a style takes, multiply by the hourly rate you want to earn, then add hair/product cost and a margin for overhead (booth rent, supplies, travel).",
          "Compare the number you land on to what experienced braiders in your area charge for the same style. If you're well under, that's usually a signal you're absorbing cost instead of being paid for skill.",
          "Price the style, not the client. A consistent menu protects you from negotiating every appointment and makes raising prices later much easier.",
        ],
        tryThisWeek:
          "Pick your most-booked style and calculate its true hourly rate (price minus hair cost, divided by hours). If it's below your target, note the gap.",
        relatedTool: "Settings → Default pricing",
      },
      {
        id: "when-to-raise",
        title: "How to know when it's time to raise your prices",
        readMinutes: 3,
        body: [
          "Consistently booked out, a waitlist forming, or turning people away are all signs demand is higher than your price.",
          "Raising prices in small steps ($10–$25 on one style) is far less risky than a big jump across the menu. Returning clients can be given a heads-up and a short grace window.",
          "You may want to raise the style that fills fastest first — demand there is least price-sensitive.",
        ],
        tryThisWeek:
          "Review your top 3 booked styles and increase one by $10–$25 if it consistently fills.",
        relatedTool: "Boss Growth Guide",
      },
      {
        id: "deposits-protect-time",
        title: "How deposits protect your time",
        readMinutes: 3,
        body: [
          "A deposit turns a casual inquiry into a committed booking. It filters out clients who aren't serious before they take a slot someone else wanted.",
          "Deposits also cover part of your loss when a last-minute cancellation leaves a gap you can't refill.",
          "A common approach is a non-refundable deposit that applies to the final balance, with the amount scaled to how long the appointment blocks your calendar.",
        ],
        tryThisWeek:
          "Confirm every long style on your menu requires a deposit, and that the amount reflects the time that slot costs you.",
        relatedTool: "Settings → Booking policies",
      },
      {
        id: "addons-ticket",
        title: "Add-ons that increase ticket size",
        readMinutes: 3,
        body: [
          "Add-ons let a client choose to spend more without you raising base prices: length, extra density, custom color blends, curl pattern, takedown, or a maintenance touch-up.",
          "Presenting 2–3 relevant add-ons at booking (not at the chair) tends to raise the average ticket while feeling like a service, not a sell.",
          "Reserve discounts for premium add-ons rather than the base style, so promotions don't lower how your core work is valued.",
        ],
        tryThisWeek:
          "Add or refine one paid add-on on your highest-demand style and surface it at booking.",
        relatedTool: "Settings → Services & styles",
      },
      {
        id: "avoid-undercharging",
        title: "Avoiding undercharging",
        readMinutes: 3,
        body: [
          "Undercharging usually hides in unpaid time: consultations, prep, takedowns, and re-dos. Each is real labor and can be priced or bounded.",
          "If a style leaves you exhausted and barely ahead after hair cost, that's a pricing problem, not a hustle problem.",
          "A common approach is to track a few full appointments end-to-end — total time and total take-home — and adjust the styles that score worst.",
        ],
        tryThisWeek:
          "Time one full appointment door-to-door and calculate real take-home per hour for that style.",
        relatedTool: "Money",
      },
    ],
  },
  {
    id: "client-experience",
    name: "Client Experience",
    blurb: "Set expectations early and make every visit feel premium.",
    lessons: [
      {
        id: "set-expectations",
        title: "How to set expectations before appointments",
        readMinutes: 3,
        body: [
          "Most appointment friction comes from unspoken expectations: arrival time, hair state, length of session, payment method, and guests.",
          "Sending a short, consistent confirmation that states these up front prevents the awkward in-chair conversation later.",
          "Clear expectations protect the client experience as much as yours — people relax when they know exactly what's expected.",
        ],
        tryThisWeek:
          "Write a 4–5 line standard pre-appointment message and use it for every booking this week.",
        relatedTool: "Settings → Reminder settings",
      },
      {
        id: "prep-instructions",
        title: "Prep instructions that reduce confusion",
        readMinutes: 2,
        body: [
          "Specific prep beats vague prep. \"Washed, blow-dried, fully detangled, no added product\" leaves little room for misunderstanding.",
          "Stating what happens if hair arrives unprepped (added time or fee) sets the boundary before it's tested.",
          "Keep it short enough to read on a phone in ten seconds.",
        ],
        tryThisWeek:
          "Finalize one reusable prep checklist and attach it to your confirmation message.",
        relatedTool: "Settings → Reminder settings",
      },
      {
        id: "late-clients",
        title: "Handling late clients",
        readMinutes: 3,
        body: [
          "A stated grace period (e.g. 15 minutes) plus what happens after it removes the need to decide case-by-case while stressed.",
          "Options after the grace period commonly include a late fee, a shortened service, or rescheduling with the deposit forfeited — pick what's sustainable for you and apply it consistently.",
          "Consistency is what makes a policy respected; exceptions made quietly become the new expectation.",
        ],
        tryThisWeek:
          "Decide your grace period and the exact consequence after it, then add both to your policy text.",
        relatedTool: "Settings → Booking policies",
      },
      {
        id: "cancel-reschedule-boundaries",
        title: "Cancellation and reschedule boundaries",
        readMinutes: 3,
        body: [
          "Boundaries are kindest when they're known in advance. A notice window (e.g. 48 hours) and a limit on reschedules per booking are common and fair.",
          "Tie the boundary to the deposit: inside the window the deposit carries to a reschedule; outside it, it's forfeited.",
          "You may want to allow one good-faith reschedule and make the policy firmer after that.",
        ],
        tryThisWeek:
          "Write your cancellation/reschedule rule in one short paragraph a client could repeat back to you.",
        relatedTool: "Settings → Booking policies",
      },
      {
        id: "premium-experience",
        title: "Creating a premium appointment experience",
        readMinutes: 3,
        body: [
          "Premium is mostly consistency and communication, not luxury extras: confirmed time, calm start, clear pricing, no surprises.",
          "Small repeatable touches — a tidy setup, water offered, a clear aftercare note — compound into a reputation.",
          "Ending with what to expect next (longevity, maintenance, rebooking window) makes clients feel cared for after they leave the chair.",
        ],
        tryThisWeek:
          "Add one consistent closing step to every appointment (e.g. a standard aftercare + rebooking note).",
        relatedTool: "Boss Growth Guide",
      },
    ],
  },
  {
    id: "booking-ops",
    name: "Booking & Operations",
    blurb: "Run a calendar that protects your time and income.",
    lessons: [
      {
        id: "use-deposits",
        title: "How to use deposits effectively",
        readMinutes: 3,
        body: [
          "Deposits work best when they're required at booking, clearly non-refundable within your window, and applied to the final balance.",
          "Match the deposit to the risk: longer, harder-to-refill slots warrant a larger deposit.",
          "State the deposit rule the same way every time so it never feels personal.",
        ],
        tryThisWeek:
          "Audit your menu and make sure every long style has a deposit that reflects its slot length.",
        relatedTool: "Settings → Booking policies",
      },
      {
        id: "organize-availability",
        title: "How to organize your availability",
        readMinutes: 3,
        body: [
          "Batching similar styles or grouping long appointments on set days reduces context-switching and fatigue.",
          "Building in buffer time between bookings absorbs overruns without collapsing the whole day.",
          "Protecting at least one non-bookable block per week for admin, content, and rest is an operations decision, not a luxury.",
        ],
        tryThisWeek:
          "Add buffer time between two back-to-back slots and block one weekly admin window.",
        relatedTool: "Settings → Availability",
      },
      {
        id: "reduce-no-shows",
        title: "How to reduce no-shows",
        readMinutes: 3,
        body: [
          "The biggest no-show levers are a real deposit, a clear reminder before the appointment, and a stated consequence.",
          "Reminders closer to the appointment (and one the day before) give clients a chance to reschedule properly instead of ghosting.",
          "Tracking who repeatedly no-shows lets you require a larger deposit from them specifically rather than punishing everyone.",
        ],
        tryThisWeek:
          "Turn on a 24-hour reminder and confirm your no-show consequence is written down.",
        relatedTool: "Settings → Reminder settings",
      },
      {
        id: "manage-balances",
        title: "How to manage balances",
        readMinutes: 2,
        body: [
          "Stating the remaining balance and accepted payment methods in the confirmation removes the end-of-appointment scramble.",
          "Collecting balance at or before the start (where appropriate for your market) protects you from end-of-service disputes.",
          "Keeping a simple record of who still owes what prevents small leaks from adding up.",
        ],
        tryThisWeek:
          "Add the balance amount and accepted payment methods to your confirmation message.",
        relatedTool: "Money",
      },
      {
        id: "follow-up",
        title: "How to follow up after appointments",
        readMinutes: 2,
        body: [
          "A short post-appointment message (aftercare + an invitation to rebook) keeps you top-of-mind and increases repeat bookings.",
          "Asking happy clients for a review while the experience is fresh is one of the highest-return follow-ups.",
          "A light rebooking nudge a few weeks out is a service, not a sales pitch, when the timing matches the style's lifespan.",
        ],
        tryThisWeek:
          "Send one aftercare + rebooking message to every client you see this week.",
        relatedTool: "Settings → Reviews",
      },
    ],
  },
  {
    id: "policies",
    name: "Policies & Protection",
    blurb: "Clear, fair rules that protect your time and energy.",
    lessons: [
      {
        id: "cancellation-policy",
        title: "Writing a cancellation policy",
        readMinutes: 3,
        body: [
          "A workable cancellation policy names the notice window, what happens to the deposit inside vs. outside it, and how to cancel.",
          "Short and specific beats long and vague — a client should be able to summarize it in one sentence.",
          "Apply it consistently; a policy that's only sometimes enforced stops being a policy.",
        ],
        tryThisWeek:
          "Tighten your cancellation policy to three sentences and publish it where clients book.",
        relatedTool: "Settings → Booking policies",
      },
      {
        id: "no-show-policy",
        title: "Setting a no-show policy",
        readMinutes: 2,
        body: [
          "A no-show policy usually pairs a forfeited deposit with a rule for re-booking (e.g. larger deposit or prepayment next time).",
          "Defining \"no-show\" precisely (past the grace period with no contact) avoids arguments about gray areas.",
          "Repeat no-shows can be handled individually without softening the policy for everyone.",
        ],
        tryThisWeek:
          "Define exactly when a booking becomes a no-show and the consequence, in writing.",
        relatedTool: "Settings → Booking policies",
      },
      {
        id: "reschedule-limits",
        title: "Reschedule limits",
        readMinutes: 2,
        body: [
          "Allowing one reschedule with notice is generous and clear; unlimited reschedules quietly drain your calendar.",
          "Tying reschedules to the notice window keeps the deposit logic consistent with cancellations.",
          "After the limit, requiring a fresh deposit is a common and reasonable boundary.",
        ],
        tryThisWeek:
          "Decide your reschedule limit per booking and add it next to your cancellation rule.",
        relatedTool: "Settings → Booking policies",
      },
      {
        id: "contract-basics",
        title: "Contract basics",
        readMinutes: 3,
        body: [
          "A simple service agreement can capture the policy, deposit terms, prep expectations, and aftercare so everyone has the same reference.",
          "Plain language is fine and usually clearer than legal phrasing for both sides.",
          "Requirements vary by location and situation — check your local requirements and consider professional advice for anything you're unsure about.",
        ],
        tryThisWeek:
          "Draft a one-page plain-language agreement covering policy, deposit, prep, and aftercare.",
        relatedTool: "Settings → Contracts",
      },
      {
        id: "refund-boundaries",
        title: "Refund boundaries",
        readMinutes: 3,
        body: [
          "Deciding in advance what is and isn't refundable (deposits vs. completed services vs. issues you'll correct) prevents emotional decisions later.",
          "Offering a correction window for genuine workmanship issues protects your reputation without inviting refund abuse.",
          "Refund expectations differ by region and payment processor — check your local requirements and your processor's rules.",
        ],
        tryThisWeek:
          "Write one sentence each for: deposit refunds, completed-service refunds, and your correction window.",
        relatedTool: "Settings → Booking policies",
      },
    ],
  },
  {
    id: "social-growth",
    name: "Social Media & Growth",
    blurb: "Post with intent and turn attention into bookings.",
    lessons: [
      {
        id: "post-busy-seasons",
        title: "What to post during busy seasons",
        readMinutes: 3,
        body: [
          "In peak season, content that drives action (limited slots, booking windows, prep reminders) tends to outperform pure inspiration.",
          "Showing the styles you actually want to book more of trains your audience to request them.",
          "A simple rhythm — one promote, one educate, one social-proof post per week — is easier to sustain than chasing trends.",
        ],
        tryThisWeek:
          "Plan three posts for this week: one promo, one tip, one client result.",
        relatedTool: "Boss Growth Guide",
      },
      {
        id: "promote-high-ticket",
        title: "How to promote high-ticket services",
        readMinutes: 3,
        body: [
          "High-ticket work sells on transformation and durability, not price. Show the result and what it's like to wear it.",
          "Naming who it's for (\"perfect for vacation\", \"lasts through the season\") helps the right client self-select.",
          "Scarcity that's true — limited premium slots per week — supports the price instead of discounting it.",
        ],
        tryThisWeek:
          "Create one post that sells the outcome of your highest-ticket style, not the price.",
        relatedTool: "Boss Growth Guide",
      },
      {
        id: "content-ideas",
        title: "Content ideas for braiders",
        readMinutes: 2,
        body: [
          "Reliable formats: before/after, prep do's and don'ts, style longevity, day-in-the-life, and answering the question you're asked most.",
          "Educational posts build trust faster than promotional ones and still lead to bookings.",
          "Save a running list of client questions — each one is a post.",
        ],
        tryThisWeek:
          "Write down the five questions clients ask most and turn one into a post.",
        relatedTool: "Boss Growth Guide",
      },
      {
        id: "seasonal-style-promo",
        title: "Seasonal style promotion",
        readMinutes: 2,
        body: [
          "Promoting styles a few weeks ahead of the season (prom, vacation, back-to-school, holidays) captures planners before the rush.",
          "Lead with the styles you most want booked during that window.",
          "A consistent seasonal cadence beats reacting late every year.",
        ],
        tryThisWeek:
          "Pick the next season and schedule one promo post for its top style now.",
        relatedTool: "Boss Growth Guide",
      },
      {
        id: "reviews-to-trust",
        title: "Turning reviews into trust",
        readMinutes: 2,
        body: [
          "Asking for a review while the client is happiest (right after the reveal or via a quick follow-up) gets the most responses.",
          "Sharing real reviews as content turns satisfied clients into your most persuasive marketing.",
          "Responding graciously to every review — including critical ones — signals professionalism to future clients.",
        ],
        tryThisWeek:
          "Ask your next three happy clients for a review and reshare one you already have.",
        relatedTool: "Settings → Reviews",
      },
      {
        id: "set-up-google-reviews",
        title: "How to set up Google reviews",
        readMinutes: 4,
        body: [
          "Google reviews are how new clients find and trust you before they ever message. A strong rating on your Google profile shows up in Search and Maps, so it works for you around the clock — unlike a post that scrolls away.",
          "First, you need a free Google Business Profile. Go to business.google.com, add your business, and verify it (Google confirms you're real before reviews can show). Once verified, your business appears on Search and Maps with a star rating.",
          "Next, grab your direct review link. The quickest way: open the Google Maps app, tap your business, tap Reviews, then \"Write a review\" or the share icon, and Copy link. You'll get a short link (g.page or maps.app.goo.gl) that opens the star box for the client instantly.",
          "Braid Boss Pro can then funnel happy clients straight to that link. Open Customize booking page and paste your link into the \"Google review link\" field, then save. After a client leaves you a review and rates you 4–5 stars, they're shown a \"Review us on Google\" button on the thank-you screen.",
          "Clients who rate lower aren't sent to Google — that feedback stays private with you. So only your happiest clients are guided to your public profile, which protects your rating while it grows.",
          "Make it a habit to ask while the client is happiest — right after the reveal. The in-app review request already goes out after appointments, so once your link is saved the rest runs on its own.",
        ],
        tryThisWeek:
          "Create or verify your Google Business Profile, copy your review link, and paste it into Customize booking page → Google review link.",
        relatedTool: "Settings → Customize booking page",
      },
    ],
  },
  {
    id: "money-basics",
    name: "Money & Business Basics",
    blurb: "Simple habits that keep your business financially healthy.",
    lessons: [
      {
        id: "track-income",
        title: "Tracking your income",
        readMinutes: 2,
        body: [
          "You can't price or plan well without knowing what you actually earn. Recording every appointment's total is the foundation.",
          "Even a basic weekly total reveals trends — which styles and days carry the business.",
          "Consistency matters more than the tool; pick one place and use it every week.",
        ],
        tryThisWeek:
          "Record every appointment total this week in one place and total it Sunday.",
        relatedTool: "Money",
      },
      {
        id: "save-for-taxes",
        title: "Saving for taxes",
        readMinutes: 3,
        body: [
          "A common approach is to set aside a fixed percentage of each payment into a separate place so tax time isn't a shock.",
          "The right percentage varies a lot by location and situation — check your local requirements and consider a professional for specifics.",
          "Automating the set-aside (every deposit day) makes the habit stick.",
        ],
        tryThisWeek:
          "Open or designate a separate account and move a set percentage of this week's income into it.",
        relatedTool: "Money",
      },
      {
        id: "separate-business-money",
        title: "Separating business money",
        readMinutes: 2,
        body: [
          "Mixing personal and business money makes it nearly impossible to see if the business is actually profitable.",
          "A separate account for business income and expenses makes pricing, taxes, and reinvestment decisions clearer.",
          "Paying yourself a deliberate amount (rather than spending whatever's there) is a business habit worth building.",
        ],
        tryThisWeek:
          "Route this week's payments into a dedicated business account.",
        relatedTool: "Money",
      },
      {
        id: "understand-expenses",
        title: "Understanding your expenses",
        readMinutes: 3,
        body: [
          "Hair, products, booth rent, travel, tools, and platform costs all reduce what a booking really earns you.",
          "Knowing cost-per-style turns pricing from a guess into a decision.",
          "Reviewing expenses monthly catches creep before it quietly eats your margin.",
        ],
        tryThisWeek:
          "List every recurring business expense and estimate the product cost of your top style.",
        relatedTool: "Money",
      },
      {
        id: "weekly-money-review",
        title: "Weekly money review checklist",
        readMinutes: 2,
        body: [
          "A 10-minute weekly review keeps you in control: income recorded, expenses noted, tax set-aside moved, balances owed followed up, next week's deposits confirmed.",
          "The point isn't perfection — it's catching problems while they're small.",
          "Same day, same checklist, every week.",
        ],
        tryThisWeek:
          "Run this 5-point review once this week and put it on a recurring reminder.",
        relatedTool: "Money",
      },
    ],
  },
  {
    id: "seasonal",
    name: "Seasonal Playbooks",
    blurb: "What to push, post, and prepare each season.",
    lessons: [
      {
        id: "spring-prom",
        title: "Spring / prom season playbook",
        readMinutes: 3,
        body: [
          "Spring is event-driven — prom and graduation create date-locked demand and willingness to pay for a standout look.",
          "Open and promote event slots early; planners book ahead, and event weekends fill first.",
          "Protect those high-demand dates with deposits and consider a small event-season premium on the most-requested styles.",
        ],
        tryThisWeek:
          "Open your event-weekend slots and post one promo for a soft-glam or color-blend style.",
        relatedTool: "Boss Growth Guide",
      },
      {
        id: "summer-vacation",
        title: "Summer vacation braids playbook",
        readMinutes: 3,
        body: [
          "Summer demand centers on durable, low-maintenance, vacation-ready styles. Sell longevity and ease.",
          "Weekends before travel fill fast — promote booking ahead of trips and protect weekend capacity with deposits.",
          "Boho and human-hair work commands a premium here; lead with it.",
        ],
        tryThisWeek:
          "Post a \"book before you fly\" reminder and feature your top vacation style.",
        relatedTool: "Boss Growth Guide",
      },
      {
        id: "back-to-school",
        title: "Back-to-school playbook",
        readMinutes: 2,
        body: [
          "Demand shifts to neat, durable, low-maintenance protective styles and kids' bookings on a tight calendar.",
          "Back-to-school week fills early — open it ahead of time and steer parents to book in advance.",
          "Scalp-care and longevity messaging resonates strongly this season.",
        ],
        tryThisWeek:
          "Open back-to-school week early and post one protective-style + scalp-care tip.",
        relatedTool: "Boss Growth Guide",
      },
      {
        id: "holiday-glam",
        title: "Holiday glam playbook",
        readMinutes: 3,
        body: [
          "Parties, travel, and New-Year resets drive demand for glam, long-lasting, photo-ready styles tied to specific dates.",
          "Peak dates book out before the first party — open them early and protect them with deposits.",
          "A holiday premium on glam and long-length installs is common while demand peaks.",
        ],
        tryThisWeek:
          "Open holiday and NYE dates now and post one festive-style promo.",
        relatedTool: "Boss Growth Guide",
      },
      {
        id: "slow-season",
        title: "Slow-season strategies",
        readMinutes: 3,
        body: [
          "Slow weeks are for the work that pays off later: refining your menu and prices, batching content, and reactivating past clients.",
          "Profit-safe offers (off-peak day incentives, premium add-on bundles) fill gaps without training clients to wait for discounts.",
          "Reaching out to good past clients with a personal rebooking note often beats any public sale.",
        ],
        tryThisWeek:
          "Message five past clients with a personal rebooking note and refine one underpriced style.",
        relatedTool: "Boss Growth Guide",
      },
    ],
  },
  {
    id: "feature-guides",
    name: "App Features & How-Tos",
    blurb: "Step-by-step guides for getting the most out of Braid Boss Pro.",
    lessons: [
      {
        id: "edit-appointment-addons",
        title: "How to add or change add-ons on a booked appointment",
        readMinutes: 2,
        body: [
          "Plans change after booking — a client decides she wants the hair included, or an extra bundle. Open the appointment from your calendar and find the Add-ons card: toggle on any extra your service offers, or tap \"Add custom add-on\" for a one-off (name, price, extra time).",
          "Adding or removing an add-on updates the appointment's total price and duration automatically. You can still type over either field. The deposit already paid stays put, so the difference just becomes the balance due.",
          "Your client is emailed one tidy \"appointment updated\" note showing exactly what changed, and their appointment-details page updates to match — so nobody's guessing.",
        ],
        tryThisWeek:
          "Open an upcoming appointment and practice adding, then removing, one add-on — watch the total and balance update live.",
        relatedTool: "Calendar → Edit Appointment → Add-ons",
      },
      {
        id: "switch-service-option",
        title: "How to switch a client's service option without rebooking",
        readMinutes: 2,
        body: [
          "If a client booked the wrong option — say Standard when she meant Boho Hair Included — you don't have to cancel and start over. Open the appointment and use the Option picker to switch.",
          "Switching re-prices the ticket: the total and duration update to the new option (plus any add-ons), and the service name updates too. The deposit she already paid carries over, and the higher amount becomes balance due — exactly what she now owes.",
          "She gets one consolidated update email with the new option and total, and her appointment-details page reflects the change.",
        ],
        tryThisWeek:
          "Open a test appointment for a service that has options and switch between them to see the price and balance update.",
        relatedTool: "Calendar → Edit Appointment → Option",
      },
      {
        id: "edit-style-customization",
        title: "How to fix the hair color or curl pattern on an appointment",
        readMinutes: 2,
        body: [
          "The style details a client picked at booking — braiding-hair color (like 1B) and the boho/curl pattern — are editable from the appointment's Style customization card. Tap a quick-pick chip or type a custom value.",
          "Your edits sync to the client's \"View appointment details\" page and are included in the update email, so you and the client are always working from the same picture before she sits in your chair.",
        ],
        tryThisWeek:
          "Open an appointment, correct the hair color, then open the client's appointment link to confirm it shows there too.",
        relatedTool: "Calendar → Edit Appointment → Style customization",
      },
      {
        id: "offer-buy-now-pay-later",
        title: "How to offer Buy Now, Pay Later — shop and services",
        readMinutes: 3,
        body: [
          "Bigger purchases convert better when clients can split the cost. Your shop checkout can show Affirm, Klarna, and Afterpay right next to card — the client chooses how to pay.",
          "Turn the methods on once in your Stripe dashboard: Settings → Payment methods → your connected-accounts configuration → the \"Buy now, pay later\" section. Flip Affirm, Klarna, and Afterpay to on and save. (Leave \"Allow connected accounts to customize\" off so it applies everywhere.)",
          "After that they appear automatically at checkout for carts that qualify (Affirm starts around $50), and card is always shown too. The provider pays you up front and the client repays them — there's nothing extra to manage per sale.",
          "Want it on your services too? In Settings → Payments, turn on \"Let clients pay in full with Buy Now, Pay Later.\" When a client books — whether or not the service takes a deposit — they can choose to pay the full price, financed through Affirm/Klarna/Afterpay, and you're paid in full up front with no balance left to collect. Services with no deposit keep their usual \"just request, pay later\" option too.",
        ],
        tryThisWeek:
          "Enable Affirm/Klarna/Afterpay in Stripe, flip on pay-in-full in Settings → Payments, then start a booking and confirm the \"Pay in full\" option appears.",
        relatedTool: "Shop checkout & Settings → Payments · Stripe → Payment methods",
      },
      {
        id: "instant-cash-out",
        title: "How to cash out your Stripe balance instantly",
        readMinutes: 3,
        body: [
          "Normally the deposits and payments you collect through Stripe pay out on a rolling schedule — they land in your bank a couple of business days after they settle. Instant cash-out is a Braid Boss Pro member perk that lets you skip the wait and send your available balance to your debit card in minutes, any day of the week.",
          "You'll find it in Settings → Payments once three things are true: you're on the paid plan, your Stripe account has finished onboarding, and Stripe has enabled payouts on it. When you're eligible, a \"Cash out instantly\" card shows how much is ready to go.",
          "Tap \"Cash out $X now\" and Braid Boss Pro sends your available balance straight to the debit card linked to your Stripe account. Only money that has settled shows as available — a deposit paid an hour ago may still be clearing, so it appears once it's ready. The card updates with the amount on its way and the expected arrival.",
          "A few things to know: instant payouts go to a debit card (not a bank account number), so make sure a supported card is on file in Stripe — if it isn't, you'll see a note explaining why. Stripe charges a small instant-payout fee (a percentage of the amount), which is the cost of getting paid early; your regular automatic payouts stay free if you'd rather wait. Every cash-out is also a single, protected action, so a double-tap can't send your money twice.",
        ],
        tryThisWeek:
          "Open Settings → Payments, check your \"Ready to cash out\" balance, and do one small instant cash-out so you know exactly how it feels before a day you need the money fast.",
        relatedTool: "Settings → Payments → Cash out instantly",
      },
      {
        id: "book-kids-and-family",
        title: "How to book kids and family under one client",
        readMinutes: 2,
        body: [
          "Parents often book more than one child. On a client's profile, add Family members — a name, plus an optional note like age or hair texture.",
          "When you create or edit an appointment for that client, a \"Booking for\" picker lets you choose the client herself or one of her family members. The parent stays the contact, payer, and reminder recipient — only who the style is for changes.",
          "On your public booking link, a client can pick \"Someone else\" and enter who it's for. When you approve it, that person is saved as a family member under the client automatically, so it's there next time.",
        ],
        tryThisWeek:
          "Add a family member to one client, then book an appointment \"for\" them and confirm it shows on the calendar entry.",
        relatedTool: "Clients → (open a client) → Family members",
      },
      {
        id: "build-intake-form",
        title: "How to build your consultation (intake) form",
        readMinutes: 3,
        body: [
          "Intake questions appear on your booking page after the client picks a style and date. Answers save to her record and ride into the confirmation email once you approve the booking — so you're prepped before she arrives.",
          "Each question can be Short text, Paragraph, Yes / No, Multiple choice (pick one), or \"Choose all that apply\" (the client ticks every option that fits — great for things like scalp concerns where more than one applies). For the choice types, list the options comma-separated.",
          "Keep it short and high-signal — scalp sensitivities, last protective style, allergies, medications. A handful of the right questions tailors the appointment without slowing the booking down.",
        ],
        tryThisWeek:
          "Add one \"Choose all that apply\" question (e.g. \"Any of these concerns?\") with 3–4 options, then preview it on your booking link.",
        relatedTool: "Settings → Intake form",
      },
      {
        id: "use-sms-text-reminders",
        title: "How to use SMS text reminders",
        readMinutes: 3,
        body: [
          "Text messages get opened far more than email, so turning on SMS means more clients actually see their confirmations and show up on time. Braid Boss Pro can text clients automatically: booking confirmations, a reminder the day before, a \"starting soon\" nudge about two hours out, balance reminders, and a post-visit review request. These are transactional — never spam.",
          "Turn it on in Account → Notifications → Text messages (SMS). It's off by default, so flip the switch on when you're ready. This is your master switch for every client text.",
          "Texts run on prepaid credits — 1 credit = 1 text. Buy a pack in Settings → SMS credits (Starter, Standard, or Pro). Your balance shows there, and you'll get a heads-up when it runs low. Credits don't expire, and if a text ever fails to deliver, that credit is refunded automatically.",
          "Clients opt in themselves: on your public booking link there's a consent checkbox (unchecked by default) where they agree to receive appointment texts. Only clients who tick it — and who gave a phone number — get texted. Anyone can reply STOP at any time to opt out, or HELP for help; the app honors that automatically on every future send.",
          "Nothing sends until three things are true: your SMS switch is on, the client opted in, and you have credits. If any one is off, the appointment still works exactly as before — SMS is purely an add-on layer.",
        ],
        tryThisWeek:
          "Turn on Account → Notifications → Text messages (SMS), buy a Starter credit pack, then open your own booking link and confirm the SMS opt-in checkbox shows when you enter a phone number.",
        relatedTool: "Account → Notifications · Settings → SMS credits",
      },
    ],
  },
];

export const EDUCATION_TOTAL_LESSONS = EDUCATION_CATEGORIES.reduce(
  (n, c) => n + c.lessons.length,
  0,
);
