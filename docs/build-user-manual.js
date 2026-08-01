/* Smart Sweep SWMS — end-user manual, as a Word document. */

const fs = require('fs')
const {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, LevelFormat,
  PageBreak, PageNumber, Packer, Paragraph, ShadingType, Table, TableCell, TableRow,
  TableOfContents, TextRun, VerticalAlign, WidthType,
} = require('docx')

// --------------------------------------------------------------------------- //
// Palette — the app's deep forest green, light and dark surfaces
// --------------------------------------------------------------------------- //

const GREEN_DARK = '1F3D2B'
const GREEN = '2E5339'
const GREEN_MID = '5A7A4A'
const FILL_GREEN = 'E8F0E4'
const FILL_GREY = 'F2F4F1'
const FILL_WARN = 'F7F0DC'
const RULE_WARN = '8A7530'
const FILL_STOP = 'F5E0DC'
const RULE_STOP = 'A4553F'
const TEXT = '1A1A1A'
const MUTED = '5A5A5A'
const BORDER = 'D4DCCF'

const FONT = 'Calibri'

// A4 (11906 DXA) less 1" margins each side.
const CONTENT_W = 9026

// --------------------------------------------------------------------------- //
// Building blocks
// --------------------------------------------------------------------------- //

/** Inline markup: **bold**, *italic*, `code`. */
function runs(text, base = {}) {
  const out = []
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }))
    const token = m[0]
    if (token.startsWith('**')) {
      out.push(new TextRun({ text: token.slice(2, -2), bold: true, ...base }))
    } else if (token.startsWith('`')) {
      out.push(new TextRun({
        text: token.slice(1, -1), font: 'Consolas', size: 19,
        color: GREEN_DARK, shading: { type: ShadingType.CLEAR, fill: FILL_GREY },
        ...base,
      }))
    } else {
      out.push(new TextRun({ text: token.slice(1, -1), italics: true, ...base }))
    }
    last = m.index + token.length
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }))
  return out
}

const p = (text, opts = {}) => new Paragraph({
  children: runs(text),
  spacing: { after: 140, line: 276 },
  ...opts,
})

const lead = (text) => new Paragraph({
  children: runs(text, { size: 23, color: MUTED }),
  spacing: { after: 200, line: 288 },
})

const h1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  children: [new TextRun({ text, bold: true, size: 34, color: GREEN_DARK, font: FONT })],
  spacing: { before: 360, after: 160 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: GREEN_MID, space: 6 } },
})

const h2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  children: [new TextRun({ text, bold: true, size: 27, color: GREEN, font: FONT })],
  spacing: { before: 300, after: 120 },
})

const h3 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_3,
  children: [new TextRun({ text, bold: true, size: 23, color: GREEN_DARK, font: FONT })],
  spacing: { before: 220, after: 100 },
})

const bullets = (items) => items.map((t) => new Paragraph({
  children: runs(t),
  numbering: { reference: 'bullets', level: 0 },
  spacing: { after: 80, line: 276 },
}))

// Each numbered list needs its own numbering instance, or Word continues the
// count from the previous one — the Billing steps come out as 7, 8, 9, 10.
const stepRefs = []
const steps = (items) => {
  const reference = `steps-${stepRefs.length}`
  stepRefs.push(reference)
  return items.map((t) => new Paragraph({
    children: runs(t),
    numbering: { reference, level: 0 },
    spacing: { after: 80, line: 276 },
  }))
}

/** A shaded callout box with a coloured left rule. */
function callout(label, lines, { fill = FILL_GREEN, rule = GREEN_MID } = {}) {
  const body = []
  if (label) {
    body.push(new Paragraph({
      children: [new TextRun({ text: label.toUpperCase(), bold: true, size: 17, color: rule, font: FONT })],
      spacing: { after: 60 },
    }))
  }
  lines.forEach((line, i) => body.push(new Paragraph({
    children: runs(line),
    spacing: { after: i === lines.length - 1 ? 0 : 100, line: 276 },
  })))

  return new Table({
    columnWidths: [CONTENT_W],
    width: { size: CONTENT_W, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.NIL }, bottom: { style: BorderStyle.NIL },
      right: { style: BorderStyle.NIL }, insideHorizontal: { style: BorderStyle.NIL },
      insideVertical: { style: BorderStyle.NIL },
      left: { style: BorderStyle.SINGLE, size: 18, color: rule },
    },
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: CONTENT_W, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill },
        margins: { top: 160, bottom: 160, left: 220, right: 220 },
        children: body,
      })],
    })],
  })
}

const note = (lines) => callout('Note', lines)
const warn = (lines) => callout('Important', lines, { fill: FILL_WARN, rule: RULE_WARN })
const stop = (lines) => callout('Take care', lines, { fill: FILL_STOP, rule: RULE_STOP })

/** Table with a green header row. `widths` must sum to CONTENT_W. */
function table(headers, rows, widths, { align = [] } = {}) {
  const cell = (text, w, { head = false, i = 0, zebra = false } = {}) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: head ? GREEN : (zebra ? FILL_GREY : 'FFFFFF') },
    margins: { top: 90, bottom: 90, left: 130, right: 130 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      children: head
        ? [new TextRun({ text, bold: true, color: 'FFFFFF', size: 20, font: FONT })]
        : runs(String(text), { size: 20 }),
      alignment: align[i] === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { after: 0, line: 260 },
    })],
  })

  return new Table({
    columnWidths: widths,
    width: { size: CONTENT_W, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
      left: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
      right: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((t, i) => cell(t, widths[i], { head: true, i })),
      }),
      ...rows.map((r, ri) => new TableRow({
        children: r.map((t, i) => cell(t, widths[i], { i, zebra: ri % 2 === 1 })),
      })),
    ],
  })
}

const spacer = (after = 200) => new Paragraph({ text: '', spacing: { after } })
const pageBreak = () => new Paragraph({ children: [new PageBreak()] })

// --------------------------------------------------------------------------- //
// Title page
// --------------------------------------------------------------------------- //

const titlePage = [
  spacer(1400),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
    children: [new TextRun({ text: 'SMART SWEEP', bold: true, size: 72, color: GREEN_DARK, font: FONT })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 420 },
    children: [new TextRun({
      text: 'Solid Waste Management System', size: 30, color: GREEN_MID, font: FONT,
    })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 200 },
    border: {
      top: { style: BorderStyle.SINGLE, size: 12, color: GREEN_MID, space: 14 },
      bottom: { style: BorderStyle.SINGLE, size: 12, color: GREEN_MID, space: 14 },
    },
    children: [new TextRun({ text: 'User Manual', bold: true, size: 52, color: TEXT, font: FONT })],
  }),
  spacer(600),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
    children: [new TextRun({
      text: 'Khulna City Corporation pilot', size: 26, color: TEXT, font: FONT,
    })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
    children: [new TextRun({
      text: 'For collectors, supervisors, agency administrators and KCC staff',
      size: 21, color: MUTED, italics: true, font: FONT,
    })],
  }),
  spacer(1800),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Version 1.0', size: 20, color: MUTED, font: FONT })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'July 2026', size: 20, color: MUTED, font: FONT })],
  }),
  pageBreak(),
]

// --------------------------------------------------------------------------- //
// Contents
// --------------------------------------------------------------------------- //

const contents = [
  // Deliberately not a Heading style — a heading here would list itself in the
  // table of contents it introduces.
  new Paragraph({
    spacing: { before: 360, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: GREEN_MID, space: 6 } },
    children: [new TextRun({ text: 'Contents', bold: true, size: 34, color: GREEN_DARK, font: FONT })],
  }),
  new Paragraph({
    spacing: { after: 240 },
    children: runs('*Ctrl-click an entry to jump to it. If you edit this document, right-click the list and choose “Update Field” to refresh the page numbers.*',
      { size: 19, color: MUTED }),
  }),
  new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),
  pageBreak(),
]

// --------------------------------------------------------------------------- //
// Body
// --------------------------------------------------------------------------- //

const body = []
const S = (...items) => body.push(...items)

// ---- Welcome -------------------------------------------------------------- //

S(
  h1('Welcome to Smart Sweep'),
  lead('Smart Sweep is the system Khulna City Corporation and its service partners use to run household waste collection: who is served, who walked which round, what was collected, what is owed, and what citizens are complaining about.'),
  p('This manual covers every screen in the app. You do not need to read it end to end — find your role in **What your role can do**, then read the sections for the screens you actually use.'),
  h3('How to read this manual'),
  table(
    ['If you are a…', 'Read'],
    [
      ['Collector', 'Signing in · Daily Collection · Households · Complaints'],
      ['Supervisor', 'Everything except the agency-admin-only parts of Billing'],
      ['Agency Admin', 'All of it — you are the only role that can run billing and change staff, fleet and tiers'],
      ['KCC Viewer', 'Signing in · Dashboard · Reports · Customer Reports'],
    ],
    [2400, 6626],
  ),
  spacer(),
  note([
    'Screens you cannot use are not shown in your menu at all. If something described here is missing for you, that is your role — not a fault.',
  ]),
  pageBreak(),
)

// ---- Signing in ----------------------------------------------------------- //

S(
  h1('Signing in'),
  p('Smart Sweep signs you in by **mobile number**. There is no username.'),

  h2('First time — by SMS code'),
  ...steps([
    'Enter your mobile number.',
    'Tap **Send code**. A 4-digit code arrives by SMS.',
    'Enter the code.',
  ]),
  spacer(120),
  note([
    'On the demo system there is no SMS gateway, so the login screen shows the code on screen. That only happens in demo mode — on a live system the code arrives by SMS and never appears on screen.',
  ]),
  spacer(),
  p('If your number is not yet registered, signing in creates a Collector account called *Field Operator*. An agency admin then sets your real role and area. This is how field staff are added without a separate registration form.'),

  h2('After that — by PIN'),
  p('Once signed in, set a **4-digit PIN** from *My Profile*. Then you can sign in with your number and PIN alone, without waiting for an SMS. This is the normal way collectors sign in, because mobile coverage in the field is unreliable.'),
  p('If you forget your PIN or lock yourself out, **sign in by SMS code instead**. A successful code sign-in clears the lockout and lets you set a new PIN.'),
  spacer(60),
  warn([
    'After **five wrong PINs** the account locks for **15 minutes**. The count is kept on the server, so closing the app or clearing your browser does not reset it.',
  ]),

  h2('Demo accounts'),
  p('Tap a **demo account** chip on the sign-in screen, or type the number. Every demo account uses PIN **1470**.'),
  table(
    ['Mobile', 'Role', 'Area', 'Sees'],
    [
      ['01711000042', 'Collector', 'Ward 14', 'Their own round, their ward’s customers and complaints'],
      ['01700112233', 'Supervisor', 'Zone 03', 'Full operational control of that zone’s wards'],
      ['01900445566', 'Agency Admin', 'All zones', 'Everything, including staff, fleet and billing runs'],
      ['01800778899', 'KCC Viewer', 'City-wide', 'Read-only oversight and reports'],
    ],
    [1700, 1500, 1300, 4526],
  ),
  spacer(),
  p('Signing in as each of these in turn is the quickest way to understand what the roles actually differ on.'),
  pageBreak(),
)

// ---- Getting around ------------------------------------------------------- //

S(
  h1('Finding your way around'),
  p('The sidebar is grouped:'),
  table(
    ['Group', 'Screens'],
    [
      ['Overview', 'Dashboard · Live Map'],
      ['Operations', 'Households · Daily Collection · Routes · Route Plan · Complaints · Billing'],
      ['Fleet & People', 'Fleet & Vans · Collectors'],
      ['Insight', 'Reports · Customer Reports'],
      ['System', 'My Profile'],
    ],
    [2200, 6826],
  ),
  spacer(),
  warn([
    'The sidebar only lists screens your role can open. A collector does not see Billing at all; a KCC viewer does not see Route Plan.',
  ]),
  spacer(),
  p('After signing in you land on the screen that matters most for your role:'),
  table(
    ['Role', 'Lands on'],
    [
      ['Collector', 'Daily Collection'],
      ['Supervisor', 'Dashboard'],
      ['Agency Admin', 'Dashboard'],
      ['KCC Viewer', 'Reports'],
    ],
    [3000, 6026],
  ),
  spacer(),
  p('The top bar carries global **search** (households, vans, complaints), notifications, the theme toggle, the language switch, and your account menu.'),

  h2('Language, theme and Bangla numerals'),
  p('**Language.** Bangla is the default. Switch from the top bar — the whole interface changes, including form labels, dropdown options and status badges. Your choice is remembered.'),
  p('In Bangla, **numbers are shown in Bangla numerals** (১, ২, ৩) throughout — counts, money, dates and percentages alike.'),
  p('**Dark mode.** Toggle from the top bar. Remembered between sessions.'),
  pageBreak(),
)

// ---- Roles ---------------------------------------------------------------- //

S(
  h1('What your role can do'),
  table(
    ['Screen', 'Collector', 'Supervisor', 'Agency Admin', 'KCC Viewer'],
    [
      ['Dashboard', '●', '●', '●', '●'],
      ['Live Map', '●', '●', '●', '●'],
      ['Households', '●', '●', '●', '—'],
      ['Daily Collection', '●', '●', '●', '—'],
      ['Routes', '●', '●', '●', '—'],
      ['Route Plan', '—', '●', '●', '—'],
      ['Complaints', '●', '●', '●', '—'],
      ['Billing', '—', '●', '●', '—'],
      ['Fleet & Vans', '—', '●', '●', '—'],
      ['Collectors', '—', '●', '●', '—'],
      ['Reports', '—', '●', '●', '●'],
      ['Customer Reports', '—', '●', '●', '●'],
    ],
    [2626, 1600, 1600, 1600, 1600],
    { align: ['left', 'center', 'center', 'center', 'center'] },
  ),
  spacer(),
  h2('Area scope'),
  p('Your **area** limits what you see even on screens you can open:'),
  ...bullets([
    'A **collector** sees their own ward.',
    'A **supervisor** sees their zone’s wards.',
    'An **agency admin** and a **KCC viewer** see the whole city.',
  ]),
  spacer(120),
  warn([
    'Area scope is applied by the system, not by the screen. A supervisor cannot widen it by changing a filter — the ward dropdown does not offer wards outside their zone, and asking for one anyway returns their own.',
  ]),
  pageBreak(),
)

// ---- Daily Collection ----------------------------------------------------- //

S(
  h1('Daily Collection'),
  lead('Collector · Supervisor · Agency Admin'),
  p('Your round for the day: every stop in walking order.'),

  h2('The screen'),
  ...bullets([
    '**Stat cards** — stops today, collected, pending, and *queued to sync* if you have recorded anything offline.',
    '**Tabs** — All · Collected · Pending.',
    '**Search** by name, holding, road or tag.',
    '**Scan QR code** — the main action.',
  ]),
  spacer(120),
  note([
    '“Pending” includes stops you skipped. A skip is not a completed stop — it still needs a return visit, so it stays in Pending on purpose.',
  ]),

  h2('Recording a collection'),
  ...steps([
    'Tap **Scan QR code** and hold the tag on the bin or gate inside the frame.',
    'The app looks the tag up and shows the household.',
    'Confirm to record the collection.',
  ]),
  spacer(120),
  p('You can also find the stop in the list and record it by hand — useful when a tag is missing or the camera will not focus.'),

  h2('What a scan can tell you'),
  table(
    ['Result', 'Meaning', 'What to do'],
    [
      ['The household appears', 'It is a stop on your round', 'Collect and confirm'],
      ['Already collected', 'Recorded earlier today', 'Nothing — this prevents a double entry'],
      ['Not on your round', 'It belongs to another collector', 'Do not collect it; tell your supervisor'],
      ['Unknown tag', 'Not registered, or the sticker is damaged', 'Report it to the office'],
      ['Could not read', 'The camera got nothing', 'Clean the tag and scan again'],
    ],
    [2300, 3300, 3426],
  ),
  spacer(),
  p('None of these is an error you need to dismiss and retry — they are answers.'),

  h2('Recording a skip'),
  p('If you cannot serve a stop, record a **skip** and choose a reason:'),
  ...bullets([
    'No one home',
    'No waste to collect',
    'Premises locked',
    'Could not access',
    'Householder refused',
  ]),
  spacer(120),
  p('Add a note if the reason needs explaining. The stop stays in **Pending**.'),
  note([
    '**Correcting a skip.** If you come back later and collect it, just record the collection normally. It replaces the skip — you will not end up with two entries for the same day.',
  ]),

  h2('Working without a signal'),
  p('**Keep working.** Everything you record without a connection is saved on your device and shown under **Queued to sync**.'),
  p('When the signal returns, the app uploads the queue automatically. Rows the server accepts disappear from the queue; anything it could not accept stays and is retried, so nothing is silently lost.'),
  spacer(60),
  note(['One bad record never blocks the rest of your round from uploading.']),

  h2('Looking at someone else’s round'),
  p('A **supervisor or agency admin** can pick any collector from the dropdown and review their round from the desk.'),
  p('A **collector cannot** — you always see your own round, whatever is selected. A round lists householders’ names and phone numbers, which is not shared between collectors.'),
  pageBreak(),
)

// ---- Households ----------------------------------------------------------- //

S(
  h1('Households'),
  lead('Collector · Supervisor · Agency Admin'),
  p('The customer register. Two kinds of record sit here, on separate tabs:'),
  ...bullets([
    '**Under service** — paying customers, QR-tagged, billed monthly.',
    '**Potential** — surveyed holdings that are *not* yet paying. The “ghost homes”.',
  ]),
  spacer(120),
  p('Tabs: All · Under service · Potential · Verified · Unverified. Filter by ward, customer type, tier and status; search by ID, name, QR tag, holding or road.'),

  h2('Registering a household'),
  p('**Register household** opens the full form. Required:'),
  ...bullets([
    'Ward, road, holding number, head of household',
    'Service tier — this sets the monthly charge',
    'Payment mode and payment day',
    'Customer type, holding type, storage type, suitable collection time',
  ]),
  spacer(120),
  p('Optional but useful: phone, alternate phone, contact person, profession, address, floor, household size (total, under-5, female), blood group.'),
  p('The ID (`HH-KCC-…`) is assigned automatically.'),

  h2('Confirming the location — this one matters'),
  stop([
    'A holding without a confirmed GPS pin **cannot be put on a route**. Not “should not” — the system refuses.',
  ]),
  spacer(),
  p('**In the field**, open the holding and tap to verify while standing at the door. The app records the coordinates and their accuracy in metres.'),
  p('**From the office**, you can drop the pin on the map instead. The system records that it was placed by hand, because a desk pin and a doorstep GPS fix are not equally reliable.'),
  p('The **Unverified** tab is your work list. The header also shows how many holdings are not on any route and how many of those are blocked by verification.'),

  h2('Find by tag'),
  p('**Find by tag** scans a QR sticker — or lets you key the code in — and opens the holding it belongs to. Useful when someone reports a problem and the only thing you have is the number on the bin.'),

  h2('Surveys and conversion'),
  p('Record a survey on a holding that is not under service. Alongside the usual details you capture:'),
  ...bullets([
    '**Estimated tier** — what they would pay',
    '**Reason** they are not served (never approached, refused the charge, …)',
    '**Time gap** — how long since any service',
    '**Current practice** — what they do with their waste now',
  ]),
  spacer(120),
  p('To sign one up, open it and **bring it under service**. Confirm the tier, charge, payment mode and payment day — leave any of them and the survey’s estimates are used.'),
  note([
    'The survey is **kept**, not deleted. That is what lets the Customer Funnel report show how many holdings were approached, how many converted, and how much monthly revenue is still on the table.',
    'You cannot convert the same survey twice.',
  ]),
  pageBreak(),
)

// ---- Complaints ----------------------------------------------------------- //

S(
  h1('Complaints'),
  lead('Collector · Supervisor · Agency Admin'),
  p('Citizen tickets with a deadline clock and a full audit trail.'),

  h2('Raising one'),
  p('Choose the household, the **type** (missed collection, overflow, billing dispute, staff behaviour, other) and the **channel** it arrived by (SMS, app, phone, counter). Set a priority and describe the problem. Anything you write in the note becomes the first entry in the ticket’s history.'),

  h2('The deadline clock'),
  p('The priority sets the time budget:'),
  table(
    ['Priority', 'Must be resolved within'],
    [
      ['Urgent', '4 hours'],
      ['High', '12 hours'],
      ['Medium', '24 hours'],
      ['Low', '48 hours'],
    ],
    [3000, 6026],
  ),
  spacer(),
  p('Each ticket shows how it is doing against its budget, and **breached** tickets are called out on the list, the Dashboard and the Reports screen.'),
  warn([
    '**Changing the priority changes the clock.** Re-grading a medium ticket to urgent gives it a 4-hour budget measured from when it was opened — which may put it straight into breach. That is intended: it was always urgent, you just found out late.',
  ]),

  h2('Moving a ticket along'),
  p('Open → Assigned → In progress → Resolved → Closed.'),
  table(
    ['Action', 'Effect'],
    [
      ['Assign', 'Hand to a collector, or back to the pool'],
      ['Advance', 'Move one step'],
      ['Change priority', 'Re-grades and resets the budget'],
      ['Resolve', 'Records how it was fixed; stops the clock'],
      ['Reopen', 'The citizen says it is not fixed; restarts the clock'],
      ['Add note', 'Adds to the history; changes nothing else'],
      ['Attach photos', 'Evidence from the camera roll'],
    ],
    [2600, 6426],
  ),
  spacer(),
  p('**Collectors can do all of these**, not just add notes — they progress the jobs on their own round. Area scope is what keeps them to their own ward’s tickets. A **KCC viewer** cannot do any of them.'),
  warn([
    'Every one of these actions is recorded with your name against it. You cannot edit a ticket’s status directly, and you cannot remove an entry from its history. A ticket cannot change hands without a trace.',
  ]),
  spacer(),
  p('Photos can be attached several at a time. If any one file is rejected, none of them is saved — so you never end up with half a batch.'),
  pageBreak(),
)

// ---- Live Map ------------------------------------------------------------- //

S(
  h1('Live Map'),
  lead('All roles'),
  p('A map of Khulna showing where the vans are right now, drawn from real GPS telemetry.'),
  p('Positions arrive continuously — you do not need to refresh. Where a live connection is not possible, the map falls back to refreshing on a timer, and carries on working.'),
  p('Alongside vehicles, the map shows household pins and today’s progress. It also reacts live to collections recorded in the field and complaints raised anywhere in your area.'),
)

// ---- Route Plan ----------------------------------------------------------- //

S(
  h1('Route Plan'),
  lead('Supervisor · Agency Admin'),
  p('Where routes are built and handed out.'),

  h2('Building a route'),
  p('Give it a name, a ward and a **service window** (start and end time). Then add stops.'),
  p('The planner shows holdings **not yet on any route**, split into two piles:'),
  ...bullets([
    '**Ready to route** — location confirmed.',
    '**Blocked** — no confirmed location. Send someone to verify before you can use them.',
  ]),

  h2('Ordering the walk'),
  p('Drag stops into the order a collector would actually walk them. The order is saved as one change, so a collector opening their round mid-edit never sees a half-sorted route.'),
  p('**Moving a holding between routes** is allowed — drag it and it moves. It is never on two routes at once.'),

  h2('Assigning collectors'),
  p('Create an assignment for a collector and give it routes.'),
  note([
    'Taking a route from another collector is allowed — the planner reassigns it and removes the old link. It does not stop and ask, because reassigning is a normal part of covering for absence.',
  ]),

  h1('Routes'),
  lead('Collector · Supervisor · Agency Admin'),
  p('A read-only, stop-by-stop view of a route as it is walked: a timeline of what has been served and what is left, with a live map of the walk.'),
  p('Collectors use this to see the shape of their day; supervisors use it to see how a round is progressing without interrupting anyone.'),
  pageBreak(),
)

// ---- Billing -------------------------------------------------------------- //

S(
  h1('Billing'),
  lead('Supervisor · Agency Admin'),

  h2('Running a month’s billing'),
  p('*Agency Admin only.*'),
  ...steps([
    'Choose the **period** (month), the issue date and the number of days until bills fall due (10 by default).',
    '**Preview first.** The preview shows exactly how many bills would be created and for how much, and changes nothing.',
    'Check the count and total against what you expect.',
    'Run it for real.',
  ]),
  spacer(120),
  stop([
    'Always preview. A billing run has **no bulk undo**.',
  ]),
  spacer(),
  p('Re-running the same month is safe — households already billed are skipped, not charged twice. Every run is recorded, so you can always see who billed which month and when.'),

  h2('Recording payments'),
  p('*Collectors, supervisors and admins can all record a payment* — the collector at the door is the person the money is handed to.'),
  p('Open the bill, record the amount, choose the method (cash, bKash, Nagad, Rocket, bank) and add a reference if there is one.'),
  p('**Partial payments are normal.** Record what was actually handed over. The bill moves from unpaid to **partial**, and to **paid** once the total is covered.'),
  warn([
    'A bill’s state is not something you set. There is no “mark as paid” button. Paid, partial, unpaid and overdue are all worked out from the payments on record.',
    'This is deliberate: it is why the Billing screen’s totals and the Reports screen’s totals cannot disagree.',
  ]),
  spacer(),
  p('**Who the payment is credited to matters.** A payment recorded by a collector is money that collector must later hand in. A payment taken at the office counter has no collector against it and no hand-in is expected. Getting this wrong is the usual cause of a cash position that looks wrong at month end.'),

  h2('Fixing a mistake'),
  p('Payments cannot be edited. To correct one, an **agency admin** voids it and it is recorded again correctly. The bill is immediately restated from the payments that remain.'),
  p('Voiding is admin-only because it is the only action that can make money on record disappear — so it does not sit with the person who keyed it in.'),

  h2('Cash hand-ins'),
  p('At the end of the month a collector records what they have handed in: the amount, the method and a reference such as a depot slip number.'),
  p('Recording it again for the same month **updates** the entry rather than adding a second one, so a correction is just a re-entry.'),
  p('The **cash position** view shows, per collector: collected, deposited, and the variance between them. That variance is what a supervisor works through at month end.'),
  pageBreak(),
)

// ---- Collectors & Fleet --------------------------------------------------- //

S(
  h1('Collectors'),
  lead('Supervisor · Agency Admin'),
  p('The staff register: name, staff ID, ward, phone, licence and its expiry, joining date, and the van they drive.'),
  ...bullets([
    '**Attendance** — mark a collector checked in or absent for the day.',
    '**Performance** — coverage and on-time figures, calculated from the visit log.',
    '**Complaints** — how many open tickets are on each collector right now.',
  ]),
  spacer(120),
  note([
    'Refreshing performance figures is **agency-admin only**. They feed staff reviews, so a supervisor cannot recalculate their own team’s numbers on demand.',
  ]),

  h1('Fleet & Vans'),
  lead('Supervisor · Agency Admin'),
  p('The vehicle register: plate, type (compactor, pickup, rickshaw van, tricycle), capacity, fuel type, ownership, GPS unit, odometer and driver.'),

  h2('Documents'),
  p('Fitness, tax, insurance and permit expiry dates are tracked, and the **alerts** panel lists what is expiring — measured against today, so it stays current without anyone maintaining it.'),

  h2('Maintenance'),
  p('Open a job with the reason, odometer reading and vendor.'),
  warn([
    'Opening a job may take the van off the road. It moves to *in maintenance* and stops being available to assign.',
  ]),
  spacer(),
  p('Close the job when it comes back, with the final cost. Downtime is worked out from when it went in and came out, so you do not need to calculate it.'),

  h2('Fuel'),
  p('Log refuelling with litres, cost and odometer. Efficiency (km/l) is calculated from the distance since the last fill.'),
  p('The **KPI cards** show availability, downtime, average efficiency by fuel type, and fuel and maintenance spend.'),
  pageBreak(),
)

// ---- Dashboard & Reports -------------------------------------------------- //

S(
  h1('Dashboard'),
  lead('All roles'),
  p('The headline view, all of it calculated live for **your area**:'),
  ...bullets([
    '**KPI scorecard** — collection efficiency, charge rate, coverage, median complaint resolution time, on-time completion, fleet availability.',
    '**Collection trend** — the last 7 days.',
    '**Waste by zone** — estimated tonnage.',
    '**Ward collection** — service and revenue per ward.',
    '**Complaints** — open, breached, urgent.',
    '**Customer funnel** — surveys, conversions, revenue at stake.',
  ]),
  spacer(120),
  p('Every panel is calculated at the same moment from the same area scope, so they always agree with each other.'),
  warn([
    'Tonnage is an **estimate** and is labelled `est.` Nothing weighs the waste. The figure comes from the number of stops collected multiplied by typical amounts per customer type. Treat it as an indicator of trend, not a measurement.',
  ]),

  h1('Reports'),
  lead('Supervisor · Agency Admin · KCC Viewer'),
  table(
    ['Report', 'Answers'],
    [
      ['Waste collection', 'Rounds walked, per period and collector, with cover work called out'],
      ['Service series', 'Day by day: scheduled, served, skipped, billed, collected'],
      ['Ward collection', 'Service and revenue per ward for a month'],
      ['Bill collection', 'Billed against received, per period and collector'],
      ['Bill status', 'Paid, partial, unpaid and overdue counts per collector'],
      ['Reconciliation', 'Service against revenue, and cash taken against cash handed in'],
    ],
    [2600, 6426],
  ),
  spacer(),
  p('Most reports take a **period** and a **grouping** (daily, weekly, monthly, yearly), and several offer an **overall** view that collapses to one row per period.'),

  h2('Exporting'),
  p('Every report exports to **CSV, Excel or PDF** from the same screen. The export is generated from the same figures you are looking at, so a sheet you send to someone can never disagree with the screen it came from. The export notes your area scope and the time it was generated.'),
  p('The **reconciliation** export is worth knowing about: alongside the cash summary it carries the **exception list** — the cases that do not balance. Those are the point of the report.'),
  p('Reports always cover **your** area. A ward supervisor’s city-wide-looking report is their wards.'),

  h1('Customer Reports'),
  lead('Supervisor · Agency Admin · KCC Viewer'),
  p('Per-household billing:'),
  ...bullets([
    '**Customer collection** — billed and received per household. This is the *“who has not paid”* list.',
    '**Customer bill status** — one row per bill, with what was paid, by which methods, and in how many instalments.',
  ]),
  spacer(120),
  p('Both export to CSV, Excel and PDF.'),
  pageBreak(),
)

// ---- Sweep AI & Profile --------------------------------------------------- //

S(
  h1('Sweep AI'),
  p('The floating assistant, available on every screen.'),
  p('Ask an operational question in plain language — *“how many complaints are past their deadline?”*, *“which households in my ward have not been collected this week?”* — and it answers from live data, **limited to your area**.'),
  p('Answers often come with a **suggested screen** to open. Opening it is your choice: the assistant never navigates on its own, and the panel stays open while you read.'),
  p('You can see the exact figures the assistant is working from, so its answers can always be checked.'),

  h1('My Profile'),
  lead('All roles'),
  p('Your own details: name, email, alternate phone, NID, blood group and emergency contact. Upload a photo if you like.'),
  p('**Set or change your PIN** here, or remove it to go back to SMS-only sign-in.'),
  p('You cannot change your own role or area — an agency admin does that.'),
  pageBreak(),
)

// ---- Surprises ------------------------------------------------------------ //

S(
  h1('Rules that will surprise you'),
  lead('Ten things the system does deliberately. None of these is a fault.'),
  ...steps([
    'An **unconfirmed location cannot be routed**. Verify the pin first; the system will not let you around it.',
    'There is **no “mark as paid”**. A bill’s state follows the payments recorded against it, and nothing else.',
    'A **bill can only come from a billing run**. There is no way to add one by hand.',
    'A **skipped stop stays in Pending**. It still needs a return visit.',
    'Recording the **same household twice in one day corrects the entry** rather than adding a second one.',
    'A **collector always sees their own round**, whichever collector is selected.',
    'A **complaint’s status can only move through an action**, and each move is recorded with your name against it.',
    'Changing a **complaint’s priority moves its deadline**, possibly into breach.',
    '**Tonnage is estimated**, and labelled as such everywhere it appears.',
    'Your **reports are your area**, whatever the filters appear to offer.',
  ]),
  pageBreak(),
)

// ---- Troubleshooting ------------------------------------------------------ //

S(
  h1('When something goes wrong'),
  table(
    ['What you see', 'What it means', 'What to do'],
    [
      ['Sign-in says the PIN is wrong and you are sure it is not', 'Five wrong attempts locks the account for 15 minutes', 'Sign in by SMS code instead — that clears the lockout'],
      ['You are signed out unexpectedly', 'Your session expired', 'Sign in again; anything queued on your device is still there'],
      ['A screen is missing from the menu', 'Your role cannot open it', 'Not a fault. Ask an agency admin if you need access'],
      ['“Could not load this data”', 'The screen could not reach the server', 'Tap Retry. The screen shows the failure rather than an empty chart, because zeros would read as real figures'],
      ['A stop will not go on a route', 'Its location is not confirmed', 'Verify it from Households, then add it'],
      ['A bill will not save', 'Bills come only from a billing run', 'Ask an agency admin to run the month'],
      ['Your queue is not uploading', 'No connection yet, or a row the server rejected', 'Keep working. Accepted rows clear on their own; a row that keeps failing needs the office'],
      ['A figure looks wrong on a report', 'Reports cover your area only', 'Check the period and remember the scope; if it still looks wrong, raise it with an agency admin'],
      ['Cash position shows a variance', 'Collected and deposited do not match', 'Check for payments recorded against the wrong collector, and for a hand-in not yet entered'],
      ['“Request was throttled”', 'Too many sign-in attempts in an hour', 'Wait, or sign in with your PIN instead of a code'],
    ],
    [2500, 2900, 3626],
  ),

  h2('Getting help'),
  ...bullets([
    'The **Sweep AI** panel answers most “how many” and “which” questions directly.',
    'Your **supervisor** handles routes, assignments and complaint escalation.',
    'An **agency admin** handles accounts, roles, staff, fleet, service tiers, billing runs and voided payments.',
  ]),
)

// --------------------------------------------------------------------------- //
// Document
// --------------------------------------------------------------------------- //

const doc = new Document({
  creator: 'Khulna City Corporation · Smart Sweep',
  title: 'Smart Sweep SWMS — User Manual',
  description: 'End-user manual for the Smart Sweep Solid Waste Management System.',
  styles: {
    default: {
      document: { run: { font: FONT, size: 21, color: TEXT } },
    },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', quickFormat: true, run: { font: FONT } },
      { id: 'Heading2', name: 'Heading 2', quickFormat: true, run: { font: FONT } },
      { id: 'Heading3', name: 'Heading 3', quickFormat: true, run: { font: FONT } },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 460, hanging: 260 } } },
        }],
      },
      // One instance per list, so every list restarts at 1. The hanging indent
      // leaves room for a two-digit number ("10.") without the text jumping.
      ...stepRefs.map((reference) => ({
        reference,
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: {
            paragraph: { indent: { left: 560, hanging: 360 } },
            run: { bold: true, color: GREEN },
          },
        }],
      })),
    ],
  },
  sections: [
    // Title page + contents, no header
    {
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: 'Smart Sweep · SWMS', size: 17, color: MUTED, font: FONT })],
          })],
        }),
      },
      children: [...titlePage, ...contents],
    },
    // Body, with running header and page numbers
    {
      properties: {
        page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            spacing: { after: 120 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER, space: 6 } },
            children: [
              new TextRun({ text: 'Smart Sweep', bold: true, size: 17, color: GREEN, font: FONT }),
              new TextRun({ text: '   ·   User Manual', size: 17, color: MUTED, font: FONT }),
            ],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'Page ', size: 17, color: MUTED, font: FONT }),
              new TextRun({ children: [PageNumber.CURRENT], size: 17, color: MUTED, font: FONT }),
              new TextRun({ text: ' of ', size: 17, color: MUTED, font: FONT }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 17, color: MUTED, font: FONT }),
            ],
          })],
        }),
      },
      children: body,
    },
  ],
})

const out = process.argv[2]
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(out, buf)
  console.log(`wrote ${out} (${(buf.length / 1024).toFixed(0)} KB)`)
})
