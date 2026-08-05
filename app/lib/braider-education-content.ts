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
      {
        id: "set-up-live-carrier-shipping",
        title: "How to ship retail orders with live USPS / UPS rates",
        readMinutes: 4,
        body: [
          "If you sell hair, edge control, or any retail product through your storefront, you can stop guessing at shipping. Braid Boss Pro can pull live rates from your own Shippo account so a buyer in California and a buyer down the street each pay what their package actually costs — not a flat fee that's either eating your margin or scaring people off.",
          "First open a free account at goshippo.com and grab your live API token (API Configuration → Developer Keys). In Braid Boss Pro: Shop → Products → tap the Shipping card → switch Shipping mode to \"Live rates\" → paste the token. Set a default package size (e.g. 12×9×3 inches) and confirm your pickup address up top — Shippo needs both to quote.",
          "Tap \"Test connection.\" If your token is good, you'll see the carriers that will quote (USPS at minimum) and a second green line confirming the delivery webhook is registered. The webhook is what flips an order to \"Delivered\" automatically when the carrier scans it.",
          "Last piece: every product needs a Shipping weight (oz). Open a product → enter the weight. Without it, a quote can't be calculated. Once weights are set, the cart shows real-time rates the moment a buyer enters their ZIP.",
        ],
        tryThisWeek:
          "Paste your Shippo token, tap Test connection, and add weights to your three best-selling retail products. Then add one to your own cart and confirm USPS rates appear.",
        relatedTool: "Shop → Products → Shipping · Products → Shipping weight (oz)",
      },
      {
        id: "buy-and-print-shipping-label",
        title: "How to buy and print a shipping label for an order",
        readMinutes: 2,
        body: [
          "Once a buyer pays for an order that used live rates at checkout, you can print the prepaid label without ever leaving the app. Open the order from Shop → Orders, scroll to the Shipping card, and tap \"Buy & print label.\"",
          "Behind the scenes, Braid Boss Pro re-quotes using the actual address the buyer entered at Stripe (not just the ZIP they typed in the cart), so the carrier label always goes to the right doorstep. Your Shippo balance is billed for the label cost. The PDF opens in a new tab — print it on regular paper or a thermal label printer, tape it to the box, drop it off.",
          "The order flips to \"Shipped\" automatically, the buyer gets a tracking email, and you get a receipt email showing what you printed (carrier, service, tracking number, label PDF link). Tap the order again later and the same Open label PDF link is still there if you need to reprint.",
        ],
        tryThisWeek:
          "On your next live-rate order, buy the label from the order screen and confirm the PDF, the tracking email, and your receipt email all arrive within a minute.",
        relatedTool: "Shop → Orders → (open order) → Shipping → Buy & print label",
      },
      {
        id: "set-pickup-days",
        title: "How to set the days you're available for pickup orders",
        readMinutes: 3,
        body: [
          "If you offer Pickup as a fulfillment method, you probably don't want every day of the week — maybe Saturdays and Wednesdays work but not Mondays. Braid Boss Pro uses your existing booking schedule as the source of truth: any day you're open for appointments can also be marked open for pickups.",
          "Open Settings → Availability and tap a weekday. On open days, you'll see an \"Available for pickups\" toggle directly under the Open toggle. Flip it on for every day you want to receive pickup orders. The hours you already set for that day (e.g. 10am–6pm) become the pickup window the buyer sees.",
          "On the storefront, the cart's Pickup option now shows a date picker filtered to your enabled days — only the next 21 days, only the ones you've allowed, and only after your turnaround minimum (so a 1-3 day prep window won't offer tomorrow). The buyer picks a date and a time inside your window; you see it on the order detail labeled \"Pickup scheduled.\"",
          "Block one off without unwinding the toggle: add an all-day blocked event on that date in your calendar. The pickup picker treats it the same way it treats your appointment schedule and hides that date automatically.",
        ],
        tryThisWeek:
          "In Settings → Availability, turn \"Available for pickups\" on for Saturday. Then open your own cart, pick Pickup, and confirm only Saturdays show in the date dropdown.",
        relatedTool: "Settings → Availability → (open day) → Available for pickups",
      },
      {
        id: "generate-return-label",
        title: "How to send a buyer a prepaid return label",
        readMinutes: 2,
        body: [
          "When a buyer needs to return a product, you don't have to ask them to pay shipping out of pocket — you can generate a prepaid return label from the order itself. Open the order from Shop → Orders. Below the outbound Shipping card you'll see a Return label card with a \"Generate return label\" button.",
          "Behind the scenes, Braid Boss Pro reverses the shipment (their address becomes the from, your pickup address becomes the to) and buys a label through the same carrier and service the order shipped with. Your Shippo balance is billed for the return label cost. The PDF opens in a new tab so you can email or text it to them.",
          "Generating a return label and issuing a refund are separate actions on purpose — return the product first, refund when it arrives, or refund up front if that's how you want to handle it. Whichever order makes sense for the situation.",
        ],
        tryThisWeek:
          "On any shipped order, tap Generate return label and confirm the PDF opens. Send it to a friend's email or your own to see what the recipient sees.",
        relatedTool: "Shop → Orders → (open order) → Return label",
      },
      {
        id: "clean-up-abandoned-carts",
        title: "How to clean up abandoned carts in your Orders tab",
        readMinutes: 2,
        body: [
          "Every time a buyer opens checkout but closes the tab without paying, a pending order row is created so the webhook has something to match against if they come back. These pile up over time and clutter your Orders view — especially on a busy storefront.",
          "Open Shop → Orders → Abandoned tab. Each row is an unpaid cart session. Tap one and you'll see \"Archive abandoned cart\" (hides it but keeps the record) or \"Delete permanently\" (wipes it for good). For batch cleanup, tap the checkboxes in the list and use \"Archive selected\" or \"Delete selected\" in the toolbar.",
          "A nuclear option is also there: \"Delete all abandoned\" wipes every abandoned-cart row at once (including archived ones). It's safe — the server only deletes rows that are truly abandoned (pending, never paid, no Stripe payment intent). A real order can never get caught up in it even if you tap by accident.",
        ],
        tryThisWeek:
          "Open Shop → Orders → Abandoned and either archive or delete every row older than a week. Your Orders tab will feel a lot lighter.",
        relatedTool: "Shop → Orders → Abandoned tab",
      },
      {
        id: "publish-shop-policies",
        title: "How to publish shipping, return, and refund policies",
        readMinutes: 3,
        body: [
          "Posting visible shipping and return policies isn't just a nicety — they're your strongest defense in a chargeback dispute, they're required by Buy Now Pay Later providers like Affirm and Klarna, and several states (California is the loudest example) default to a full 30-day refund when no policy is posted. Three short paragraphs save you a lot later.",
          "Open Shop → Products → Shipping settings and scroll to the new \"Shop policies\" card. Fill in Shipping (how fast you ship, the carriers, what happens to lost packages), Returns (the window, condition, how to start one), and Refunds (when and how the money goes back). Plain language is fine — what matters is that a buyer can read it before they pay.",
          "Once you save, the text goes live at <strong>/@&lt;your-handle&gt;/policies</strong> and is linked from the cart checkout with the line \"By placing this order you agree to our shipping & return policies.\" That tap is the buyer's affirmative acknowledgment — the part Stripe, Affirm, and Klarna look for when reviewing a dispute.",
          "Keep it honest. \"No returns, all sales final\" is a policy too, and a clearly-stated strict policy is better than no policy at all. What you can't do is say nothing and refuse returns later — that's the case the buyer will win.",
        ],
        tryThisWeek:
          "Write 3-5 sentences for each of Shipping, Return, Refund and paste them into the Shop policies card. Then open your own cart and click the policies link below the Checkout button to confirm they show up.",
        relatedTool: "Shop → Products → Shipping → Shop policies",
      },
    ],
  },
  {
    id: "setup-page",
    name: "Setup & Your Booking Page",
    blurb: "Get your link, menu, and schedule ready for clients.",
    lessons: [
      {
        id: "connect-stripe",
        title: "How to connect Stripe so you can get paid",
        readMinutes: 3,
        body: [
          "Stripe is what actually moves money — it lets you collect deposits, take card payments, and get paid out to your bank. Until it's connected, the booking and shop tools work, but no card money can change hands.",
          "Open Settings → Stripe Connect and tap to start onboarding. Stripe walks you through your business details, your bank account, and a quick identity check. When it's done you're sent back into the app and the status flips to \"Active.\" If Stripe ever shows \"Action required,\" open it and finish what it's asking for — card charges pause until you do.",
          "Connecting Stripe once unlocks the rest of the money features: deposits at booking, Tap to Pay, Buy Now Pay Later, and instant cash-out. You only do this setup a single time.",
        ],
        tryThisWeek:
          "Open Settings → Stripe Connect and finish onboarding until the status reads \"Active,\" then take one small test payment so you've seen the whole flow.",
        relatedTool: "Settings → Stripe Connect",
      },
      {
        id: "customize-booking-page",
        title: "How to customize your booking page and claim your link",
        readMinutes: 3,
        body: [
          "Your booking page is the link you drop in your Instagram and TikTok bio — it's where clients see your styles, prices, and policies and request an appointment. The first time you turn it on you get a random link; you can swap it for a memorable one like /book/your-name.",
          "From your booking-link card, tap \"Customize booking page.\" There you set your studio name, a header style, your logo and banner, a short bio, your location, and your social links. Scroll to the branded-link section to type the custom ending you want (lowercase letters, numbers, and hyphens). Save, and everything publishes to your public page right away.",
          "This same screen is home base for a few other settings — your Google review link and your mobile-service travel area both live here too.",
        ],
        tryThisWeek:
          "Set your branded link to your name or business name, add your logo and a one-line bio, then paste the new /book link into your Instagram bio.",
        relatedTool: "Customize booking page",
      },
      {
        id: "build-services-menu",
        title: "How to build your services & styles menu",
        readMinutes: 4,
        body: [
          "Your services menu is what clients pick from when they book — and it's where you set the price, the time you need, and whether a deposit is required for each style. Open Settings → Services & styles and tap to add a service.",
          "For each style you set a name, how long it takes, the base price, and a deposit. Then you can add variations (like \"hair included\" or longer lengths) as price add-ons, optional paid add-ons (takedown, custom color), prep instructions the client sees before booking, and a cover photo. Group related styles under a category so your menu stays tidy.",
          "The duration you set is what blocks your calendar, so be realistic — it's what keeps clients from booking on top of each other. You can mark your best styles as featured so they show first.",
        ],
        tryThisWeek:
          "Add or clean up your most-booked style: set a realistic duration, a deposit, one variation, and a cover photo, then preview it on your booking link.",
        relatedTool: "Settings → Services & styles",
      },
      {
        id: "set-availability",
        title: "How to set your hours, days off, and time blocks",
        readMinutes: 3,
        body: [
          "Your availability decides which slots clients can grab. Open Settings → Availability and, for each weekday, mark whether you're open and set the hours you work. Closed days simply won't show any slots.",
          "For one-off changes you don't have to touch the weekly schedule — add an exception for a specific date: take the whole day off, set custom hours, or block a window (say 2–4pm for a school run) while leaving the rest of the day bookable.",
          "Building a little buffer into your day and protecting one weekly block for admin, content, and rest is a scheduling decision worth making on purpose — it keeps one long appointment from swallowing everything.",
        ],
        tryThisWeek:
          "Set your real weekly hours, then add one exception for an upcoming day off so you can see how blocking a date works.",
        relatedTool: "Settings → Availability",
      },
      {
        id: "offer-mobile-service",
        title: "How to offer mobile / travel service and set a travel fee",
        readMinutes: 3,
        body: [
          "If you travel to clients, you can charge for it automatically instead of guessing. First set your travel base and how far you'll go: open Customize booking page → Mobile services, set your address and a service radius (say 15 miles).",
          "Then turn mobile on for the specific services you'll do on the road, and pick how the fee is calculated — a flat fee, a per-mile rate, a hybrid (first few miles free, then per-mile), or tiered bands by distance. At booking, the app measures the distance from the client's address and adds the right travel fee to the ticket.",
          "Clients outside your radius simply won't see the mobile option, so you won't get booked for a drive you didn't want.",
        ],
        tryThisWeek:
          "Set your travel base and radius, turn mobile on for one service with a flat fee, then book a test from a nearby address to watch the fee appear.",
        relatedTool: "Customize booking page → Mobile services",
      },
      {
        id: "set-up-reminders",
        title: "How to set up automatic appointment reminders",
        readMinutes: 3,
        body: [
          "Reminders are what cut down no-shows without you texting everyone by hand. Open Settings → Reminder settings, turn reminders on, and choose how they go out — email, text, or both.",
          "Then pick which reminders send: the booking confirmation, a day-before nudge, a same-day \"starting soon,\" a deposit-due note, a balance-due note, and a late alert. Each one is its own switch, so you only send what fits your business. You can edit the wording with templates and set quiet hours so nothing goes out overnight.",
          "Text reminders run on prepaid SMS credits and need the client to opt in at booking — see the SMS lesson for the full setup. Email reminders work on their own.",
        ],
        tryThisWeek:
          "Turn on the confirmation and 24-hour reminders, set your quiet hours, and book a test appointment to see the confirmation arrive.",
        relatedTool: "Settings → Reminder settings",
      },
      {
        id: "set-up-contracts",
        title: "How to create and attach e-sign contracts",
        readMinutes: 3,
        body: [
          "A contract puts your policy, deposit terms, prep expectations, and aftercare in one place the client agrees to before the appointment. Open Settings → Contracts to write one in plain language — clear beats legal-sounding for both sides.",
          "You can attach a contract to specific services or to all of them. When it applies, the client signs on their phone as part of booking, and you get back a signed PDF with a timestamp for your records.",
          "Requirements vary by location and situation — check your local requirements and consider professional advice for anything you're unsure about.",
        ],
        tryThisWeek:
          "Draft a one-page agreement covering your policy, deposit, prep, and aftercare, then attach it to your longest service and sign a test booking yourself.",
        relatedTool: "Settings → Contracts",
      },
      {
        id: "set-booking-policies-in-app",
        title: "How to publish your booking policies in the app",
        readMinutes: 2,
        body: [
          "Writing a good policy is half the job; the other half is putting it where clients actually see it. Open Settings → Booking policies and enter your cancellation window, no-show rule, late grace period, and deposit terms.",
          "Once saved, your policies show on your booking page so every client agrees to them up front — which is exactly what makes a policy easy to hold later. The Policies & Protection lessons cover what to actually write.",
        ],
        tryThisWeek:
          "Enter your cancellation, no-show, and late rules in Settings → Booking policies, then open your booking link to confirm they show before checkout.",
        relatedTool: "Settings → Booking policies",
      },
    ],
  },
  {
    id: "money-tools",
    name: "Getting Paid & Money Tools",
    blurb: "Take payments, track money, and stay ready for tax time.",
    lessons: [
      {
        id: "take-tap-to-pay",
        title: "How to take card payments in person with Tap to Pay",
        readMinutes: 3,
        body: [
          "Tap to Pay lets you accept a tapped card, Apple Pay, or a watch right on a newer iPhone — no separate card reader. Turn it on in Settings → Tap to Pay once your Stripe account is active.",
          "When an appointment has a balance, open it and look for the in-person payment card; tap \"Tap to Pay,\" wait for it to say it's ready, then hold the client's card or phone near the top of your iPhone. You'll see the charge confirm and can send the client a digital receipt.",
          "It needs a supported iPhone and a connected, active Stripe account. The very first charge on a device shows Apple's terms once, and the reader may do a quick one-time update.",
        ],
        tryThisWeek:
          "If you're on a supported iPhone with Stripe active, enable Tap to Pay and run one small test charge so it's familiar before a real client is in the chair.",
        relatedTool: "Settings → Tap to Pay",
      },
      {
        id: "price-with-calculator",
        title: "How to price a style with the calculator and save the quote",
        readMinutes: 3,
        body: [
          "The Calculator tab turns pricing from a guess into a number. Enter your hair cost, overhead, the hourly rate you want to earn, and the hours a style takes, plus a base price and any add-ons.",
          "It shows you the parts that matter: your take-home after materials, your real take-home per hour, and your margin. If the per-hour number is below your target, that's your signal to adjust the price.",
          "Tap the save icon to store the quote — saved quotes live behind the document icon in the Calculator, and you can turn any one into an appointment later. It's one source of truth from estimate to booking.",
        ],
        tryThisWeek:
          "Run your most-booked style through the Calculator and check the take-home per hour. If it's under your target, note the gap and save the quote.",
        relatedTool: "Calculator → Saved quotes",
      },
      {
        id: "track-expenses",
        title: "How to track your business expenses",
        readMinutes: 2,
        body: [
          "Knowing what you spend is what makes your profit real instead of a guess. Open the Money tab and go to Expenses, then add each cost — hair, supplies, booth rent, travel, subscriptions — with an amount, a category, and the date.",
          "You can snap a receipt photo and mark recurring costs (like a monthly subscription) so they're counted every month. Expenses total up by week and month so you can see where the money actually goes.",
          "These entries also feed your tax pack, so logging them as you go saves a scramble at tax time.",
        ],
        tryThisWeek:
          "Add every business expense from the past week in one sitting, then check which category is your biggest spend.",
        relatedTool: "Money → Expenses",
      },
      {
        id: "read-reports",
        title: "How to read your sales reports",
        readMinutes: 3,
        body: [
          "Reports show what you actually made over a stretch of time. Open Settings → Reports (or the Money tab) and pick a range — a day, week, month, quarter, or year.",
          "You'll see gross and net sales, how many appointments, your average ticket, your top styles by revenue, and a breakdown by how clients paid (cash vs. card vs. other). Tap a number to drill into the exact appointments behind it.",
          "Your top styles by revenue are your real profit drivers — those are the ones worth protecting time for and promoting most.",
        ],
        tryThisWeek:
          "Pull last week's report and note the two or three styles that show up top by revenue.",
        relatedTool: "Settings → Reports",
      },
      {
        id: "generate-tax-pack",
        title: "How to generate your tax pack for tax season",
        readMinutes: 3,
        body: [
          "The tax pack pulls a year of money into one document you can hand to an accountant. Open Settings → Tax pack and pick the tax year.",
          "It gathers your collected appointment income and shop orders, lists your expenses, and groups them by standard expense categories so they line up with how a small business reports them. Export it as a PDF to file or share.",
          "It's a starting point, not tax advice — your accountant may reclassify things based on how your business is set up, so it's worth a quick review together. Keeping your expenses logged through the year is what makes this accurate.",
        ],
        tryThisWeek:
          "Generate last year's tax pack, skim the categories, and send the PDF to whoever helps you file.",
        relatedTool: "Settings → Tax pack",
      },
      {
        id: "sell-gift-cards",
        title: "How to sell and redeem gift cards",
        readMinutes: 2,
        body: [
          "Gift cards bring in money up front and send new faces your way. You sell them as a product in your Shop — when someone buys one, a redeemable code is created and added to your gift-card list.",
          "Open Settings → Gift cards to see every card you've issued, its balance, and who bought it. At checkout you enter the client's code and the balance comes off what they owe; whatever's left stays on the card for next time.",
          "Because a code carries its own balance, anyone holding it can redeem it — treat the code like cash.",
        ],
        tryThisWeek:
          "Add a gift-card product to your Shop, buy one as a test, and redeem the code on a practice checkout to see the balance apply.",
        relatedTool: "Settings → Gift cards",
      },
    ],
  },
  {
    id: "growth-tools",
    name: "Grow & Market Your Chair",
    blurb: "Fill your calendar and bring clients back.",
    lessons: [
      {
        id: "run-discounts",
        title: "How to create and run discounts",
        readMinutes: 2,
        body: [
          "Discounts let you run a deal without lowering your real prices. Open Settings → Discounts and create one as a flat dollar amount or a percentage off.",
          "You can switch a discount on or off, give it a start and end date, and cap how many times it's used. Active discounts can be applied when you book or check out an appointment.",
          "To protect how your core work is valued, lean on slow-day or off-peak discounts rather than discounting your headline styles — that fills gaps without training clients to wait for a sale.",
        ],
        tryThisWeek:
          "Create one slow-day discount (say $25 off Monday/Tuesday), turn it on, and apply it to a test booking.",
        relatedTool: "Settings → Discounts",
      },
      {
        id: "set-up-loyalty",
        title: "How to set up a loyalty points program",
        readMinutes: 2,
        body: [
          "A loyalty program quietly rewards the clients who keep coming back. Open Settings → Loyalty points, turn it on, and set three numbers: points earned per visit, points needed for a reward, and what the reward is worth.",
          "Clients rack up points automatically as they complete visits, and you redeem a reward from the client's profile when they've earned it.",
          "Keep the math simple and easy to explain at the chair — a clear \"come X times, get $Y\" is what makes clients actually chase it.",
        ],
        tryThisWeek:
          "Turn on loyalty with a simple reward (e.g. a reward every several visits) and mention it to a returning client at checkout.",
        relatedTool: "Settings → Loyalty points",
      },
      {
        id: "reward-referrals",
        title: "How to reward client referrals",
        readMinutes: 3,
        body: [
          "Word of mouth is your best marketing, and referrals reward it. Open Settings → Referrals, turn it on, and set the credit a client earns for sending you someone new.",
          "When you add the new client, mark who referred them. After that new client completes their first paid appointment, the referrer earns the credit, which you apply as a discount on their next visit.",
          "Your happiest, most-booked clients are the ones to tell first — they already recommend you, so give them a reason to do it on purpose.",
        ],
        tryThisWeek:
          "Turn on referrals with a set reward, then ask one VIP client if they know someone who needs braids.",
        relatedTool: "Settings → Referrals",
      },
      {
        id: "get-on-marketplace",
        title: "How to get found on the braider marketplace",
        readMinutes: 2,
        body: [
          "The marketplace is a public \"find a braider near you\" page where new clients can discover you by city. Open Settings → Marketplace listing, turn it on, and enter your city (and region if you'd like).",
          "Your listing shows your studio name, logo, price range, and star rating, and links straight to your booking page. You'll need an active booking link for the listing to go live.",
          "It works around the clock to send you new clients, so it's worth keeping on once your booking page looks the way you want.",
        ],
        tryThisWeek:
          "Turn on your marketplace listing, set your city, and view your card on the discover page to see what new clients see.",
        relatedTool: "Settings → Marketplace listing",
      },
      {
        id: "send-marketing",
        title: "How to send email campaigns and create social posts",
        readMinutes: 3,
        body: [
          "The Marketing screen has two tools. The first is email campaigns: write a message, choose who gets it (everyone, recent clients, or clients who've gone quiet), and send it now or schedule it for later.",
          "The second is social media templates — branded graphics for things like \"now booking,\" new style drops, and seasonal promos, already filled with your name, logo, and colors. You can pull a caption and post to Instagram or TikTok in a couple of taps.",
          "There are also optional automatic nudges — rebooking reminders, birthday greetings, and win-back messages — you can switch on so the routine outreach runs without you.",
        ],
        tryThisWeek:
          "Create one \"now booking\" social post and send a short win-back email to clients who haven't been in for a while.",
        relatedTool: "Settings → Marketing",
      },
      {
        id: "use-growth-guide",
        title: "How to use the Boss Growth Guide",
        readMinutes: 2,
        body: [
          "The Boss Growth Guide is your built-in coach for the current season. Open Settings → Boss Growth Guide and it shows what to promote right now: the styles in demand, post ideas and hooks, smart pricing moves, profit-safe deal ideas, and a short weekly action plan.",
          "It highlights styles you already offer and updates as the calendar moves through the year, so checking it weekly keeps you a step ahead of each season's rush.",
          "Everything in it is a suggestion — test the pricing and promo ideas against your own market and clientele.",
        ],
        tryThisWeek:
          "Read the current season's section and act on one item — a pricing move, a promo, or one of the weekly tasks.",
        relatedTool: "Settings → Boss Growth Guide",
      },
      {
        id: "read-booking-intelligence",
        title: "How to read your Booking Intelligence and Boss Insights",
        readMinutes: 3,
        body: [
          "Booking Intelligence shows the patterns behind your bookings. Open Settings → Booking intelligence and pick a window (7, 30, or 90 days) to see your booking funnel, top services by conversion, your busiest day and hour, and where clients are coming from.",
          "It also estimates revenue you're leaving on the table — unmet demand you could capture with more slots or a price tweak. Use it to decide what to protect and what to promote.",
          "On your home dashboard, Boss Insights does the day-to-day version: quick prompts like who to follow up with, which appointment is missing a deposit, and who's overdue to rebook. Tap a card to jump straight to the screen that fixes it.",
        ],
        tryThisWeek:
          "Open Booking intelligence, find your busiest hour, and protect that slot for your highest-ticket style.",
        relatedTool: "Settings → Booking intelligence",
      },
    ],
  },
  {
    id: "ops-tools",
    name: "Clients, Bookings & Shop Tools",
    blurb: "Run your queue, your clients, and your retail in one place.",
    lessons: [
      {
        id: "manage-waitlist",
        title: "How to manage your waitlist",
        readMinutes: 2,
        body: [
          "A waitlist turns a full calendar and last-minute cancellations into bookings instead of lost income. Clients join from your booking page with their preferred dates and how flexible they are; you manage the queue in Settings → Waitlist.",
          "You can mark someone as contacted, convert a waiting client straight into an appointment, or — when a slot opens up — broadcast the opening by email to everyone waiting, first to grab it gets it.",
          "Keeping the list warm (a quick check each week) is what makes it pay off the day a cancellation lands.",
        ],
        tryThisWeek:
          "Open Settings → Waitlist, mark one waiting client contacted, and try a broadcast so you know how to fill the next cancellation fast.",
        relatedTool: "Settings → Waitlist",
      },
      {
        id: "approve-requests",
        title: "How to approve booking requests",
        readMinutes: 3,
        body: [
          "When a client books on your page, the request lands in your approval queue so you can vet it before it's confirmed. Open Settings → Approvals to see everything pending in one place.",
          "Tap a request to review the client, style, and time. You can approve it — setting the deposit and a hold window for them to pay — decline it, or deny and refund if needed. Once the deposit is in, you approve and schedule, and the client gets a confirmation with their contract and balance details.",
          "A hold that isn't paid in time expires on its own, so a slot you offered doesn't stay locked up forever.",
        ],
        tryThisWeek:
          "Take one pending request all the way through approve-and-schedule and watch the confirmation reach the client.",
        relatedTool: "Settings → Approvals",
      },
      {
        id: "handle-style-requests",
        title: "How to handle custom style (quote) requests",
        readMinutes: 2,
        body: [
          "Sometimes a client wants a look that isn't on your menu. With style requests on, they can send an inspiration photo with details — size, length, hair — and ask for a price.",
          "The app suggests the closest service from your menu and a ballpark price range anchored to your real pricing (it never invents a number). You review the request in Settings → Style requests, adjust the service or price if needed, and send a formal quote with a link to book.",
          "It's a clean way to say yes to custom work without pricing on the fly in your DMs.",
        ],
        tryThisWeek:
          "Submit a style request from your own booking page to see how the suggested service and price range come back, then send yourself a quote.",
        relatedTool: "Settings → Style requests",
      },
      {
        id: "sell-packages",
        title: "How to sell visit packages and prepaid credit",
        readMinutes: 2,
        body: [
          "Packages let clients pay up front for a set of visits (like \"5 maintenance appointments\") or a prepaid credit balance — money in your pocket now and a client who's committed to coming back.",
          "Open Settings → Packages, create a template (visits or credit) with a price, then issue it to a client. At checkout the app deducts a visit or the right amount automatically, and you can see each client's remaining balance any time.",
          "It works best for styles with a natural rhythm — maintenance, takedowns, kids on a schedule — where a client is coming back anyway.",
        ],
        tryThisWeek:
          "Create one multi-visit package, issue it to a frequent client, and redeem a visit on their next checkout to see it draw down.",
        relatedTool: "Settings → Packages",
      },
      {
        id: "save-style-presets",
        title: "How to save style presets for faster quoting",
        readMinutes: 2,
        body: [
          "If you quote the same combos over and over, presets save the whole setup so you don't rebuild it each time. Build a service with its variations and add-ons in the Calculator, then save it as a preset (the layers icon).",
          "Next time, open Style Presets from the Calculator or your dashboard and tap one to fill the entire quote instantly. It's the fastest way to price your bread-and-butter styles consistently.",
          "Presets are saved on the device you make them on, so build them on the phone you actually quote from.",
        ],
        tryThisWeek:
          "Save your three most common style combos as presets, then use one to build your next quote in a single tap.",
        relatedTool: "Calculator → Style Presets",
      },
      {
        id: "time-your-styles",
        title: "How to time your styles with the built-in timer",
        readMinutes: 2,
        body: [
          "Knowing how long a style really takes is the foundation of pricing it right. Tap Start Timer on your dashboard at the start of an appointment; pause it for breaks and stop it when you're done, and the session saves with its duration.",
          "Over a few weeks you build a real picture — this style takes two hours, that one takes five — instead of guessing. Pair that with the Calculator to set prices that actually pay you per hour.",
          "Sessions are stored on the device you time on, so use your main phone.",
        ],
        tryThisWeek:
          "Time three different styles this week, then compare the real durations against the times set on your services menu.",
        relatedTool: "Dashboard → Start Timer",
      },
      {
        id: "set-up-shop",
        title: "How to set up your shop and add products",
        readMinutes: 3,
        body: [
          "Your shop is a retail storefront for hair, edge control, and anything else you sell — clients check out by card through Stripe. Open Settings → Shop and add a product with a title, price, description, photos, and stock count.",
          "If a product comes in options, add them as variants (like colors) on one listing instead of making a separate product for each. You can feature your best sellers, and choose whether each product ships, offers pickup, or both. Each product gets a shareable link you can send or post.",
          "For shipping with live carrier rates, return labels, and shop policies, see the dedicated shop lessons in App Features & How-Tos.",
        ],
        tryThisWeek:
          "Add your best-selling product with photos, stock, and variants, then open its link to see what buyers see.",
        relatedTool: "Settings → Shop",
      },
      {
        id: "track-inventory",
        title: "How to track inventory (and import it)",
        readMinutes: 3,
        body: [
          "Inventory keeps you from running out mid-week. Open Settings → Inventory and add items with a quantity on hand, your cost, the retail price, and a low-stock alert so you get a heads-up before you're out.",
          "Mark whether each item is for sale to clients, used on clients as a supply, or both — that controls where it shows up. Items that come in colors or sizes can hold a quantity per variation. If you already track stock elsewhere, you can import a CSV in one pass or seed it from the products in your shop.",
          "Setting a low-stock threshold on your top few hair colors is the single highest-value habit here.",
        ],
        tryThisWeek:
          "Add your top three hair colors with quantities and a low-stock alert, or import your existing stock list as a CSV.",
        relatedTool: "Settings → Inventory",
      },
      {
        id: "message-clients-inbox",
        title: "How to message clients in the Inbox",
        readMinutes: 2,
        body: [
          "The Inbox keeps client conversations tied to their booking instead of scattered across your texts and DMs. When a client messages from their appointment link, the thread shows up in your Inbox; you reply there and they see it on their appointment page.",
          "Open it from the bell on your dashboard or Settings → Inbox, tap a thread, and type. Unread threads are badged so you can see what's waiting.",
          "These are in-app messages, not texts — for automatic text reminders, use SMS reminders. Replying quickly is one of the easiest ways to feel premium to a client.",
        ],
        tryThisWeek:
          "Open the Inbox, reply to any waiting thread, and aim to answer new client messages within an hour this week.",
        relatedTool: "Inbox",
      },
      {
        id: "use-communication-log",
        title: "How to use your communication log",
        readMinutes: 2,
        body: [
          "The communication log is the receipt of everything the app has sent your clients — confirmations, reminders, balance and deposit notes, cancellations. Open Settings → Communication log to see it newest-first.",
          "Tap an entry to read the full message. It's a quick way to confirm a reminder actually went out, or to check that the cadence matches what you set in Reminder settings.",
          "If a reminder ever isn't going out when you expect, this is the first place to look before checking your reminder switches.",
        ],
        tryThisWeek:
          "Skim your communication log, then confirm the reminders you see line up with what you turned on in Reminder settings.",
        relatedTool: "Settings → Communication log",
      },
      {
        id: "use-client-profiles",
        title: "How to use client profiles, VIP signals, and rebooking",
        readMinutes: 3,
        body: [
          "Every client has a profile that pulls their history into one card — visits, lifetime spend, preferred styles, allergies and scalp notes, family members, and contact info. Open Clients and tap a name to see it.",
          "The app surfaces signals automatically: your VIPs (your repeat, high-spend clients), how long it's been since someone's last visit, and when they're due to rebook. From the rebooking section you can generate a personal nudge to send — it only mentions an offer if you add one.",
          "A light rebooking message timed to a style's lifespan reads as a service, not a sales pitch — and it's one of the highest-return things you can do each week.",
        ],
        tryThisWeek:
          "Open your clients list, find the ones overdue to rebook, and send a personal nudge to two of them.",
        relatedTool: "Clients",
      },
      {
        id: "collect-reviews",
        title: "How to collect and feature client reviews",
        readMinutes: 3,
        body: [
          "Reviews are what convince a new client to book before they've ever met you. After an appointment, the app can ask the client for a review by email; the ones that come in land in Settings → Client Love.",
          "From there you choose which reviews to feature on your booking page so visitors see your best social proof first. You can also add testimonials from happy past clients yourself to get started before the automatic ones build up.",
          "To send your happiest clients on to leave a public Google review too, set your Google review link — see \"How to set up Google reviews\" in Social Media & Growth.",
        ],
        tryThisWeek:
          "Feature your three strongest reviews on your booking page, and add one testimonial from a past client if you're just starting out.",
        relatedTool: "Settings → Client Love",
      },
      {
        id: "get-support",
        title: "How to get help from the Support Center",
        readMinutes: 1,
        body: [
          "When something's not working or you're stuck, the Support Center is the fastest way to reach help. Open Settings → Support Center to find answers and to send a message describing what's happening.",
          "Including what you were doing and what you expected makes it much quicker to sort out — a screenshot helps too.",
        ],
        tryThisWeek:
          "Open the Support Center once so you know where it is before a day you actually need it.",
        relatedTool: "Settings → Support Center",
      },
    ],
  },
  {
    id: "teach-earn",
    name: "Teach & Earn",
    blurb: "Turn your skills into income — host classes and sell video tutorials.",
    lessons: [
      {
        id: "host-paid-classes",
        title: "Hosting paid braiding classes",
        readMinutes: 3,
        body: [
          "A class is a workshop students sign up and pay for — in person at your space, or virtual over a video call. Braid Boss Pro handles the sign-up and the payment through your own Stripe account, and only shows the student the exact location (or the meeting link) after they've paid.",
          "Set a capacity so a class can't oversell, a clear date and time, and a price that reflects your time preparing and teaching — not just the hours in the room. Publishing a class adds it to your storefront so you can share one link.",
          "Once it's live, your roster shows who signed up and how many seats are left, and you can refund a seat if someone can't make it — their spot reopens automatically.",
        ],
        tryThisWeek:
          "Publish one small class — even 3–4 seats — for the style you're asked about most, and share the link on your booking page.",
        relatedTool: "Settings → Classes",
      },
      {
        id: "sell-video-tutorials",
        title: "Selling video tutorials",
        readMinutes: 4,
        body: [
          "A video tutorial is a recorded lesson people buy access to. When they pay, Braid Boss Pro sends them to a private watch page — the video link is never shown publicly, so it can't be found without paying.",
          "The easiest way to host is a free YouTube video set to 'Unlisted'. Unlisted means it won't show up in search or on your channel — only someone with the exact link can watch it. You keep that link private and paste it into your video lesson; buyers receive it only after checkout. (You can also upload the file straight into Braid Boss Pro for a shorter clip you want to keep tighter control over.)",
          "One honest thing to know: an unlisted link is a gate, not a lock — a buyer could reshare their link. To limit that, you can sell access as a 'Rent' that expires after a set number of days instead of a permanent buy.",
        ],
        tryThisWeek:
          "Record one short how-to, upload it to YouTube as Unlisted, and add it as a video lesson at a test price.",
        relatedTool: "Settings → Video Lessons",
      },
      {
        id: "price-teaching",
        title: "Pricing classes and tutorials",
        readMinutes: 3,
        body: [
          "Teaching is priced differently from a service. You're selling knowledge that took years to build, and — unlike a style — a class or a video can be sold to many people, so the price can reflect the value to the student, not just your time in the room.",
          "For a class, consider what a student gains by learning from you — a faster technique, or a new style they can start charging for — and price against that rather than your hourly braiding rate. Small, capped classes can often carry a higher per-seat price than a large one.",
          "For a video, a common approach is to start a little lower to build reviews and reputation, then raise the price as demand grows — the same way you'd raise a style that's always booked out.",
        ],
        tryThisWeek:
          "Set a price for one class and one video, then check back in a month — if they sell out or sell fast, that's your signal to raise it.",
        relatedTool: "Boss Growth Guide",
      },
      {
        id: "run-virtual-class-zoom",
        title: "Running a virtual class on Zoom",
        readMinutes: 4,
        body: [
          "A virtual class runs on your own video tool — Zoom, Google Meet, whatever you already use. Braid Boss Pro handles the sign-up, the payment, and delivering the private link; you just create the meeting and paste its link in.",
          "In Zoom, choose Schedule a Meeting, give it a topic, and set the date and time to match your class. Save it, then copy the full Invite Link — the one with the '?pwd=' on the end. That version lets students join in one tap without typing a passcode. (Heads-up: a free Zoom plan caps meetings at 40 minutes, so keep a test class short, or plan to restart the room.)",
          "In Braid Boss Pro, create a New class, set Format to Virtual, and paste that link into the Meeting link field. Add your price, date, and time, then Publish. The link stays hidden until a student pays — then it's revealed on their confirmation page and emailed to them. If you ever change the meeting, just edit the class and paste the new link.",
        ],
        tryThisWeek:
          "Schedule a short Zoom, paste its invite link into a virtual class at a test price, and buy your own seat to see exactly what a student receives after paying.",
        relatedTool: "Settings → Classes",
      },
      {
        id: "buyer-access-and-resend",
        title: "What buyers get — and resending access",
        readMinutes: 3,
        body: [
          "The moment someone pays, Braid Boss Pro emails them their access — a 'Watch now' link for a video, or the class details (the exact location, or the Zoom link) for a class — and shows the same thing on screen. You get a notification too, so you always know a sale came in.",
          "Buyers don't have a login, so that emailed link is their way back in. If someone says they can't find it, open the sign-up or sale in your dashboard and tap Resend — it sends their access to the same email again. That's your one-tap fix for a locked-out customer.",
          "A video sold as a Rent stops working after the number of days you set; a permanent Buy keeps working so students can rewatch. Refunding a sale from the same screen sends the money back, revokes access, and reopens a class seat automatically.",
        ],
        tryThisWeek:
          "After a test purchase, tap Resend on the sale and confirm the email arrives — so you already know how to help a real customer who's misplaced their link.",
        relatedTool: "Settings → Classes / Video Lessons",
      },
    ],
  },
];

export const EDUCATION_TOTAL_LESSONS = EDUCATION_CATEGORIES.reduce(
  (n, c) => n + c.lessons.length,
  0,
);
