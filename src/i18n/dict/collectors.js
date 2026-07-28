// Collectors page — the DSP staff register.
// "Collector" here is a waste collector (সংগ্রাহক) attached to a ward who may also
// drive the van, so the Bangla side says সংগ্রাহক rather than a literal সংগ্রাহক.
// Status / attendance words are NOT redefined here — they come from
// common.js ('status.*') so a filter, a dropdown and a badge never disagree.

export default {
  en: {
    'collectors.title': 'Collectors',
    'collectors.subtitle': 'DSP database — profiles, licensing, van assignment & performance',
    'collectors.export': 'Export',
    'collectors.addCollector': 'Add collector',
    'collectors.saving': 'Saving…',
    'collectors.saveFailed': 'The change could not be saved.',
    // Coverage / on-time are recomputed from the visit log by the server.
    'collectors.refreshMetrics': 'Refresh metrics',
    'collectors.metricsRefreshed': 'Recalculated coverage and on-time for {count} collectors over the last {days} days.',
    'collectors.metricsReadOnly': 'Coverage, on-time and the complaint count are calculated by the server from the visit and complaint logs.',

    'collectors.stat.totalDsps': 'Total DSPs',
    'collectors.stat.totalDspsSub': 'Registered service providers',
    'collectors.stat.checkedIn': 'Checked in today',
    'collectors.stat.checkedInSub': 'of {count} · attendance',
    'collectors.stat.licenceDue': 'Licence renewals due',
    'collectors.stat.licenceDueSub': 'Within {days} days',
    'collectors.stat.avgCoverage': 'Avg coverage',
    'collectors.stat.avgCoverageSub': 'Across all DSPs',

    'collectors.th.collector': 'Collector',
    'collectors.th.dspId': 'DSP ID',
    'collectors.th.zone': 'Zone',
    'collectors.th.van': 'Van',
    'collectors.th.licenceExp': 'Licence exp.',
    'collectors.th.coverage': 'Coverage',
    'collectors.th.onTime': 'On-time',
    'collectors.th.attendance': 'Attendance',

    'collectors.remove': 'Remove',
    'collectors.removeConfirm': 'Remove {name}?',

    'collectors.editTitle': 'Edit collector',
    'collectors.addTitle': 'Add collector',
    'collectors.newProfile': 'New DSP profile',
    'collectors.nameRequired': 'Name required.',

    'collectors.field.name': 'Name',
    'collectors.field.fullName': 'Full name',
    'collectors.field.contact': 'Contact',
    'collectors.field.zone': 'Assigned zone',
    'collectors.field.van': 'Assigned van',
    'collectors.field.unassigned': 'Unassigned',
    'collectors.field.licenceNo': 'Licence no.',
    'collectors.field.licenceExpiry': 'Licence expiry',
    'collectors.field.status': 'Status',
    'collectors.field.attendance': 'Attendance',
    'collectors.field.joined': 'Joined',

    // Format hints — the operator types Latin digits into these boxes, so the
    // sample text stays identical in both languages.
    'collectors.placeholder.phone': '+8801…',
    'collectors.placeholder.licence': 'DK-…',

    'collectors.performance': 'Performance',
    'collectors.perf.coverage': 'Coverage',
    'collectors.perf.onTime': 'On-time',
    'collectors.perf.complaints': 'Complaints',
    'collectors.editReassign': 'Edit / reassign',

    'collectors.csv.licence': 'Licence',
    'collectors.csv.coveragePct': 'Coverage %',
    'collectors.csv.onTimePct': 'On-time %',

    'collectors.vanType.compactor': 'compactor',
    'collectors.vanType.pickup': 'pickup',
    'collectors.vanType.rickshaw-van': 'rickshaw van',
    'collectors.vanType.tricycle': 'tricycle',
  },
  bn: {
    'collectors.title': 'সংগ্রাহক',
    'collectors.subtitle': 'ডিএসপি তালিকা — প্রোফাইল, লাইসেন্স, ভ্যান বরাদ্দ ও কর্মদক্ষতা',
    'collectors.export': 'রপ্তানি',
    'collectors.addCollector': 'সংগ্রাহক যোগ করুন',
    'collectors.saving': 'সংরক্ষণ হচ্ছে…',
    'collectors.saveFailed': 'পরিবর্তনটি সংরক্ষণ করা যায়নি।',
    'collectors.refreshMetrics': 'হিসাব হালনাগাদ',
    'collectors.metricsRefreshed': 'শেষ {days} দিনের তথ্য থেকে {count} জন সংগ্রাহকের কভারেজ ও সময়মতো হিসাব নতুন করে করা হয়েছে।',
    'collectors.metricsReadOnly': 'কভারেজ, সময়মতো ও অভিযোগের সংখ্যা সার্ভার সংগ্রহ ও অভিযোগের রেকর্ড থেকে হিসাব করে।',

    'collectors.stat.totalDsps': 'মোট ডিএসপি',
    'collectors.stat.totalDspsSub': 'নিবন্ধিত সেবা প্রদানকারী',
    'collectors.stat.checkedIn': 'আজ হাজির',
    'collectors.stat.checkedInSub': '{count} জনের মধ্যে · হাজিরা',
    'collectors.stat.licenceDue': 'লাইসেন্স নবায়ন বাকি',
    'collectors.stat.licenceDueSub': '{days} দিনের মধ্যে',
    'collectors.stat.avgCoverage': 'গড় কভারেজ',
    'collectors.stat.avgCoverageSub': 'সব ডিএসপি মিলিয়ে',

    'collectors.th.collector': 'সংগ্রাহক',
    'collectors.th.dspId': 'ডিএসপি আইডি',
    'collectors.th.zone': 'এলাকা',
    'collectors.th.van': 'ভ্যান',
    'collectors.th.licenceExp': 'লাইসেন্সের মেয়াদ',
    'collectors.th.coverage': 'কভারেজ',
    'collectors.th.onTime': 'সময়মতো',
    'collectors.th.attendance': 'হাজিরা',

    'collectors.remove': 'সরান',
    'collectors.removeConfirm': '{name}-কে তালিকা থেকে সরাবেন?',

    'collectors.editTitle': 'সংগ্রাহকের তথ্য সম্পাদনা',
    'collectors.addTitle': 'নতুন সংগ্রাহক যোগ',
    'collectors.newProfile': 'নতুন ডিএসপি প্রোফাইল',
    'collectors.nameRequired': 'নাম লেখা আবশ্যক।',

    'collectors.field.name': 'নাম',
    'collectors.field.fullName': 'পূর্ণ নাম',
    'collectors.field.contact': 'যোগাযোগ নম্বর',
    'collectors.field.zone': 'নির্ধারিত এলাকা',
    'collectors.field.van': 'নির্ধারিত ভ্যান',
    'collectors.field.unassigned': 'বরাদ্দ নেই',
    'collectors.field.licenceNo': 'লাইসেন্স নম্বর',
    'collectors.field.licenceExpiry': 'লাইসেন্সের মেয়াদ শেষ',
    'collectors.field.status': 'অবস্থা',
    'collectors.field.attendance': 'হাজিরা',
    'collectors.field.joined': 'যোগদান',

    'collectors.placeholder.phone': '+8801…',
    'collectors.placeholder.licence': 'DK-…',

    'collectors.performance': 'কর্মদক্ষতা',
    'collectors.perf.coverage': 'কভারেজ',
    'collectors.perf.onTime': 'সময়মতো',
    'collectors.perf.complaints': 'অভিযোগ',
    'collectors.editReassign': 'সম্পাদনা / পুনঃবরাদ্দ',

    'collectors.csv.licence': 'লাইসেন্স',
    'collectors.csv.coveragePct': 'কভারেজ %',
    'collectors.csv.onTimePct': 'সময়মতো %',

    'collectors.vanType.compactor': 'কম্প্যাক্টর',
    'collectors.vanType.pickup': 'পিকআপ',
    'collectors.vanType.rickshaw-van': 'রিকশা ভ্যান',
    'collectors.vanType.tricycle': 'ট্রাইসাইকেল',
  },
}
