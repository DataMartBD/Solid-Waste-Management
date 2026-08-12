// Dropdown option labels from src/data/mockData.js.
// Keys are namespaced by list because ids repeat across lists (storage "none"
// means no bin; practice "none" means no fixed habit).

export default {
  en: {
    'opt.tier.residential_standard': 'Residential — standard',
    'opt.tier.residential_premium': 'Residential — premium',
    'opt.tier.commercial_small': 'Commercial — small',
    'opt.tier.commercial_large': 'Commercial — large',

    'opt.customerType.residential': 'Residential',
    'opt.customerType.commercial': 'Commercial',
    'opt.customerType.institutional': 'Institutional',
    'opt.customerType.industrial': 'Industrial',

    'opt.holdingType.single_storey': 'Single-storey house',
    'opt.holdingType.multi_storey': 'Multi-storey building',
    'opt.holdingType.apartment': 'Apartment / flat',
    'opt.holdingType.tin_shed': 'Tin-shed / semi-pucca',
    'opt.holdingType.shop': 'Shop / market stall',
    'opt.holdingType.office': 'Office / institution',

    'opt.storage.covered_bin': 'Covered bin',
    'opt.storage.open_bin': 'Open bin',
    'opt.storage.segregated': 'Segregated (wet / dry)',
    'opt.storage.sack': 'Sack or bag',
    'opt.storage.none': 'No storage',

    'opt.suitableTime.morning': 'Morning (6–9 am)',
    'opt.suitableTime.midday': 'Midday (9 am–12 pm)',
    'opt.suitableTime.afternoon': 'Afternoon (12–4 pm)',
    'opt.suitableTime.evening': 'Evening (4–8 pm)',
    'opt.suitableTime.any': 'Any time',

    'opt.paymentMode.cash': 'Cash',
    'opt.paymentMode.bkash': 'bKash',
    'opt.paymentMode.nagad': 'Nagad',
    'opt.paymentMode.rocket': 'Rocket',
    'opt.paymentMode.bank': 'Bank transfer',

    'opt.reason.never_approached': 'Never approached',
    'opt.reason.refused_charge': 'Unwilling to pay the charge',
    'opt.reason.own_arrangement': 'Has a private arrangement',
    'opt.reason.vacant': 'Vacant / under construction',
    'opt.reason.past_dispute': 'Past service dispute',
    'opt.reason.other': 'Other',

    'opt.timeGap.never': 'Never served',
    'opt.timeGap.lt_3m': 'Under 3 months',
    'opt.timeGap.3_6m': '3–6 months',
    'opt.timeGap.6_12m': '6–12 months',
    'opt.timeGap.gt_1y': 'Over a year',

    'opt.practice.private_collector': 'Private collector',
    'opt.practice.roadside_dump': 'Dumps at roadside / drain',
    'opt.practice.community_bin': 'Carries to community bin',
    'opt.practice.burns': 'Burns the waste',
    'opt.practice.composts': 'Buries / composts on site',
    'opt.practice.none': 'No fixed practice',

    'opt.agencyType.private': 'Private company',
    'opt.agencyType.ngo': 'NGO',
    'opt.agencyType.cbo': 'Community organisation',
    'opt.agencyType.cooperative': 'Cooperative',
    'opt.agencyStatus.active': 'Active',
    'opt.agencyStatus.suspended': 'Suspended',
    'opt.agencyStatus.expired': 'Expired',
    'opt.agencyStatus.terminated': 'Terminated',
    'opt.role.Collector': 'Collector',
    'opt.role.Supervisor': 'Supervisor',
    'opt.role.Agency Admin': 'Agency Admin',
    'opt.role.KCC Viewer': 'KCC Viewer',

    // ward display names. The place names are transliterated, not translated —
    // Sonadanga is Sonadanga; only the word "Ward" and the numeral change.
    'opt.ward.W-14': 'Ward 14 — Sonadanga',
    'opt.ward.W-15': 'Ward 15 — Nirala',
    'opt.ward.W-21': 'Ward 21 — Khalishpur',
    'opt.ward.W-09': 'Ward 09 — Daulatpur',

    // operator access scopes (src/data/mockData.js → operators)
    'opt.scope.Ward 14': 'Ward 14',
    'opt.scope.Zone 03': 'Zone 03',
    'opt.scope.All zones': 'All zones',
    'opt.scope.City-wide': 'City-wide',
    'opt.scope.Assigned zone': 'Assigned zone',
  },
  bn: {
    'opt.tier.residential_standard': 'আবাসিক — সাধারণ',
    'opt.tier.residential_premium': 'আবাসিক — প্রিমিয়াম',
    'opt.tier.commercial_small': 'বাণিজ্যিক — ছোট',
    'opt.tier.commercial_large': 'বাণিজ্যিক — বড়',

    'opt.customerType.residential': 'আবাসিক',
    'opt.customerType.commercial': 'বাণিজ্যিক',
    'opt.customerType.institutional': 'প্রাতিষ্ঠানিক',
    'opt.customerType.industrial': 'শিল্প',

    'opt.holdingType.single_storey': 'একতলা বাড়ি',
    'opt.holdingType.multi_storey': 'বহুতল ভবন',
    'opt.holdingType.apartment': 'অ্যাপার্টমেন্ট / ফ্ল্যাট',
    'opt.holdingType.tin_shed': 'টিনশেড / আধাপাকা',
    'opt.holdingType.shop': 'দোকান / বাজারের স্টল',
    'opt.holdingType.office': 'অফিস / প্রতিষ্ঠান',

    'opt.storage.covered_bin': 'ঢাকনাযুক্ত বিন',
    'opt.storage.open_bin': 'খোলা বিন',
    'opt.storage.segregated': 'পৃথককৃত (ভেজা / শুকনো)',
    'opt.storage.sack': 'বস্তা বা ব্যাগ',
    'opt.storage.none': 'কোনো সংরক্ষণ নেই',

    'opt.suitableTime.morning': 'সকাল (৬–৯টা)',
    'opt.suitableTime.midday': 'দুপুরের আগে (৯–১২টা)',
    'opt.suitableTime.afternoon': 'দুপুর (১২–৪টা)',
    'opt.suitableTime.evening': 'বিকেল (৪–৮টা)',
    'opt.suitableTime.any': 'যেকোনো সময়',

    'opt.paymentMode.cash': 'নগদ টাকা',
    'opt.paymentMode.bkash': 'বিকাশ',
    'opt.paymentMode.nagad': 'নগদ',
    'opt.paymentMode.rocket': 'রকেট',
    'opt.paymentMode.bank': 'ব্যাংক ট্রান্সফার',

    'opt.reason.never_approached': 'কখনও যোগাযোগ করা হয়নি',
    'opt.reason.refused_charge': 'চার্জ দিতে অনিচ্ছুক',
    'opt.reason.own_arrangement': 'নিজস্ব ব্যবস্থা আছে',
    'opt.reason.vacant': 'খালি / নির্মাণাধীন',
    'opt.reason.past_dispute': 'আগের সেবা নিয়ে বিরোধ',
    'opt.reason.other': 'অন্যান্য',

    'opt.timeGap.never': 'কখনও সেবা পায়নি',
    'opt.timeGap.lt_3m': '৩ মাসের কম',
    'opt.timeGap.3_6m': '৩–৬ মাস',
    'opt.timeGap.6_12m': '৬–১২ মাস',
    'opt.timeGap.gt_1y': 'এক বছরের বেশি',

    'opt.practice.private_collector': 'ব্যক্তিগত কালেক্টর',
    'opt.practice.roadside_dump': 'রাস্তা বা ড্রেনে ফেলে',
    'opt.practice.community_bin': 'সমষ্টিগত বিনে নিয়ে যায়',
    'opt.practice.burns': 'বর্জ্য পুড়িয়ে ফেলে',
    'opt.practice.composts': 'মাটিতে পুঁতে / কম্পোস্ট করে',
    'opt.practice.none': 'নির্দিষ্ট কোনো অভ্যাস নেই',

    'opt.agencyType.private': 'বেসরকারি কোম্পানি',
    'opt.agencyType.ngo': 'এনজিও',
    'opt.agencyType.cbo': 'কমিউনিটি সংগঠন',
    'opt.agencyType.cooperative': 'সমবায় সমিতি',
    'opt.agencyStatus.active': 'একটিভ',
    'opt.agencyStatus.suspended': 'স্থগিত',
    'opt.agencyStatus.expired': 'মেয়াদোত্তীর্ণ',
    'opt.agencyStatus.terminated': 'বাতিল',
    'opt.role.Collector': 'কালেক্টর',
    'opt.role.Supervisor': 'সুপারভাইজার',
    'opt.role.Agency Admin': 'সংস্থা প্রশাসক',
    'opt.role.KCC Viewer': 'কেসিসি পর্যবেক্ষক',

    // ward display names — place names transliterated, not translated
    'opt.ward.W-14': 'ওয়ার্ড ১৪ — সোনাডাঙ্গা',
    'opt.ward.W-15': 'ওয়ার্ড ১৫ — নিরালা',
    'opt.ward.W-21': 'ওয়ার্ড ২১ — খালিশপুর',
    'opt.ward.W-09': 'ওয়ার্ড ০৯ — দৌলতপুর',

    // operator access scopes (src/data/mockData.js → operators)
    'opt.scope.Ward 14': 'ওয়ার্ড ১৪',
    'opt.scope.Zone 03': 'জোন ০৩',
    'opt.scope.All zones': 'সব জোন',
    'opt.scope.City-wide': 'নগরব্যাপী',
    'opt.scope.Assigned zone': 'নির্ধারিত এলাকা',
  },
}
