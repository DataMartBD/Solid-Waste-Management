// Routes page — collection round timeline, progress stats and the live route map.
// Keys must stay identical between `en` and `bn` (the i18n test asserts it).

export default {
  en: {
    'routes.title': 'Routes',
    'routes.subtitle': 'Progressive collection — visited vs pending households, live from scan events',

    'routes.stat.activeRoutes': 'Active routes',
    'routes.stat.acrossWards': 'Across wards',
    'routes.stat.stopsVisited': 'Stops visited',
    'routes.stat.ofTodaysPlan': "{pct} of today's plan",
    'routes.stat.pendingStops': 'Pending stops',
    'routes.stat.notYetVisited': 'Not yet visited',
    'routes.stat.sensitiveAvoided': 'Sensitive zones avoided',
    'routes.stat.schoolsHospitals': 'Schools & hospitals',

    'routes.unassigned': 'unassigned',
    'routes.noCollector': 'no collector assigned',

    'routes.nextStop': 'Next stop',
    'routes.routeComplete': 'Route complete',
    'routes.allVisited': '✓ all visited',
    'routes.visitedCount': '{done}/{total} visited',

    'routes.view.timeline': 'Timeline',
    'routes.view.liveMap': 'Live map',

    'routes.legend.collected': 'Collected',
    'routes.legend.skipped': 'Skipped',
    'routes.legend.next': 'Next',
    'routes.legend.pending': 'Pending',

    'routes.badge.skipped': 'skipped',
    'routes.badge.skippedAt': 'skipped {time}',
    'routes.badge.nextStop': 'next stop',
    'routes.badge.pending': 'pending',

    'routes.holding': 'Holding {holding}',
    'routes.due': '{amount} due',

    'routes.fullscreen': 'Fullscreen',
    'routes.exitFullscreen': 'Exit fullscreen',
    'routes.mapCaption': "{name}'s collection path · solid = collected, dashed = still to collect",
    'routes.mapCaptionUnassigned': '{route} · no collector assigned · solid = collected, dashed = still to collect',
  },
  bn: {
    'routes.title': 'রুট',
    'routes.subtitle': 'ধারাবাহিক সংগ্রহ — সংগ্রহ হওয়া ও বাকি থাকা বাড়ি, স্ক্যানের তথ্য থেকে সরাসরি',

    'routes.stat.activeRoutes': 'চলমান রুট',
    'routes.stat.acrossWards': 'সব ওয়ার্ড মিলিয়ে',
    'routes.stat.stopsVisited': 'সম্পন্ন স্টপ',
    'routes.stat.ofTodaysPlan': 'আজকের পরিকল্পনার {pct}',
    'routes.stat.pendingStops': 'বাকি স্টপ',
    'routes.stat.notYetVisited': 'এখনও যাওয়া হয়নি',
    'routes.stat.sensitiveAvoided': 'এড়ানো সংবেদনশীল এলাকা',
    'routes.stat.schoolsHospitals': 'স্কুল ও হাসপাতাল',

    'routes.unassigned': 'বরাদ্দ হয়নি',
    'routes.noCollector': 'কোনো কালেক্টর বরাদ্দ নেই',

    'routes.nextStop': 'পরবর্তী স্টপ',
    'routes.routeComplete': 'রুট সম্পন্ন',
    'routes.allVisited': '✓ সব বাড়ি সম্পন্ন',
    'routes.visitedCount': '{done}/{total} সম্পন্ন',

    'routes.view.timeline': 'ধাপক্রম',
    'routes.view.liveMap': 'সরাসরি মানচিত্র',

    'routes.legend.collected': 'সংগৃহীত',
    'routes.legend.skipped': 'বাদ পড়েছে',
    'routes.legend.next': 'পরবর্তী',
    'routes.legend.pending': 'বাকি',

    'routes.badge.skipped': 'বাদ পড়েছে',
    'routes.badge.skippedAt': '{time}-এ বাদ পড়েছে',
    'routes.badge.nextStop': 'পরবর্তী স্টপ',
    'routes.badge.pending': 'বাকি',

    'routes.holding': 'হোল্ডিং {holding}',
    'routes.due': '{amount} বকেয়া',

    'routes.fullscreen': 'পূর্ণ পর্দা',
    'routes.exitFullscreen': 'পূর্ণ পর্দা বন্ধ',
    'routes.mapCaption': '{name}-এর সংগ্রহের পথ · একটানা রেখা = সংগ্রহ হয়েছে, বিন্দু রেখা = এখনও বাকি',
    'routes.mapCaptionUnassigned': '{route} · কোনো কালেক্টর বরাদ্দ নেই · একটানা রেখা = সংগ্রহ হয়েছে, বিন্দু রেখা = এখনও বাকি',
  },
}
