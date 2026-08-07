// Live Map page — real-time collector positions, household pins and legend.
// Terminology follows the rest of the app: collector → কালেক্টর,
// coverage → আওতা, household → হাউসহোল্ডস.

export default {
  en: {
    'liveMap.title': 'Live Map',
    'liveMap.subtitle': 'Real-time collector positions & coverage · Khulna City · refreshes every {seconds}s',
    'liveMap.liveBadge': 'Live · {count} on route',

    'liveMap.section.positions': 'Field positions',
    'liveMap.section.collectors': 'Collectors on shift',

    'liveMap.fullscreen': 'Fullscreen',
    'liveMap.exitFullscreen': 'Exit fullscreen',

    'liveMap.legend.onRoute': 'On route / serviced',
    'liveMap.legend.offRoute': 'Off route',
    'liveMap.legend.dues': 'Household w/ dues',
    'liveMap.legend.stale': 'Last known position',

    // The socket is the normal path; polling is the fallback, and the operator is
    // told which one they are looking at so a frozen pin is never a mystery.
    'liveMap.realtime.live': 'Realtime',
    'liveMap.realtime.connecting': 'Connecting…',
    'liveMap.realtime.polling': 'Polling every {seconds}s',

    // A van with no GPS fix is listed without a pin — dropping it would hide a
    // vehicle that is out there working.
    'liveMap.van.untracked': 'No position reported',
    'liveMap.van.lastSeen': 'Last seen {when}',
    'liveMap.van.noDriver': 'No driver assigned',
    'liveMap.van.plate': 'Van {plate}',
    'liveMap.van.progress': '{done} of {total} stops',
    'liveMap.counts': '{tracked} of {vans} vans tracked · {households} pins',
    'liveMap.newComplaints': '{count} new since you opened this',

    'liveMap.popup.holding': 'Holding {holding} · {road}',
    'liveMap.popup.due': '{amount} due',
    'liveMap.popup.noDues': 'No dues',
    'liveMap.popup.status': 'Status: {status}',
    'liveMap.popup.coverage': 'Coverage: {value}',

    'liveMap.coverage': '{value} coverage',
  },
  bn: {
    'liveMap.title': 'লাইভ ম্যাপ',
    'liveMap.subtitle': 'কালেক্টরদের সরাসরি অবস্থান ও আওতা · খুলনা মহানগর · প্রতি {seconds} সেকেন্ড পরপর হালনাগাদ',
    'liveMap.liveBadge': 'সরাসরি · {count} জন রুটে',

    'liveMap.section.positions': 'মাঠপর্যায়ের অবস্থান',
    'liveMap.section.collectors': 'দায়িত্বরত কালেক্টর',

    'liveMap.fullscreen': 'পূর্ণপর্দা',
    'liveMap.exitFullscreen': 'পূর্ণপর্দা বন্ধ করুন',

    'liveMap.legend.onRoute': 'রুটে আছে / সেবা দেওয়া হয়েছে',
    'liveMap.legend.offRoute': 'রুটের বাইরে',
    'liveMap.legend.dues': 'বকেয়াসহ হাউসহোল্ডস',
    'liveMap.legend.stale': 'সর্বশেষ জানা অবস্থান',

    'liveMap.realtime.live': 'সরাসরি',
    'liveMap.realtime.connecting': 'সংযোগ হচ্ছে…',
    'liveMap.realtime.polling': 'প্রতি {seconds} সেকেন্ডে হালনাগাদ',

    'liveMap.van.untracked': 'কোনো অবস্থান পাওয়া যায়নি',
    'liveMap.van.lastSeen': 'সর্বশেষ দেখা {when}',
    'liveMap.van.noDriver': 'চালক বরাদ্দ নেই',
    'liveMap.van.plate': 'ভ্যান {plate}',
    'liveMap.van.progress': '{total}টি স্টপের মধ্যে {done}টি',
    'liveMap.counts': '{vans}টির মধ্যে {tracked}টি ভ্যান ট্র্যাক হচ্ছে · {households}টি পিন',
    'liveMap.newComplaints': 'আপনি পাতাটি খোলার পর নতুন {count}টি',

    'liveMap.popup.holding': 'হোল্ডিং {holding} · {road}',
    'liveMap.popup.due': '{amount} বকেয়া',
    'liveMap.popup.noDues': 'কোনো বকেয়া নেই',
    'liveMap.popup.status': 'অবস্থা: {status}',
    'liveMap.popup.coverage': 'আওতা: {value}',

    'liveMap.coverage': 'আওতা {value}',
  },
}
