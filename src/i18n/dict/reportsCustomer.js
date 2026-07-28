// Customer-wise reports — bill collection (daily/weekly/monthly/yearly) and
// bill status (paid / partial / unpaid / overdue) for one billing month.
//
// Only strings unique to this screen live here. Settlement states reuse the
// shared status.* keys from common.js, payment methods come from
// opt.paymentMode.* and ward names from opt.ward.*, so a badge on this screen
// and the same badge on Billing can never drift apart.

export default {
  en: {
    'reportsCustomer.title': 'Customer Reports',
    'reportsCustomer.subtitle': 'Bill collection and bill status, household by household',

    'reportsCustomer.tab.collection': 'Bill collection',
    'reportsCustomer.tab.status': 'Bill status',

    'reportsCustomer.mode.daily': 'Daily',
    'reportsCustomer.mode.weekly': 'Weekly',
    'reportsCustomer.mode.monthly': 'Monthly',
    'reportsCustomer.mode.yearly': 'Yearly',

    'reportsCustomer.allPeriods': 'All periods',
    'reportsCustomer.allWards': 'All wards',
    'reportsCustomer.weekLabel': 'Week {week}, {year}',
    'reportsCustomer.chip': '{label} ({count})',
    'reportsCustomer.rows': '{count} rows',
    'reportsCustomer.empty': 'No customer rows for this selection.',
    'reportsCustomer.searchPlaceholder': 'Search head, holding, road or household ID…',

    'reportsCustomer.collection.title': 'Bill collection, customer-wise',
    'reportsCustomer.collection.subtitle': 'Billed, received and outstanding for each household, on a {mode} basis.',
    'reportsCustomer.status.title': 'Bill status, customer-wise',
    'reportsCustomer.status.subtitle': 'Every bill for {period}, settled from what was actually received.',

    'reportsCustomer.col.period': 'Period',
    'reportsCustomer.col.household': 'Household',
    'reportsCustomer.col.ward': 'Ward',
    'reportsCustomer.col.holding': 'Holding',
    'reportsCustomer.col.billed': 'Billed',
    'reportsCustomer.col.received': 'Received',
    'reportsCustomer.col.outstanding': 'Outstanding',
    'reportsCustomer.col.rate': 'Collection rate',
    'reportsCustomer.col.billId': 'Bill ID',
    'reportsCustomer.col.collector': 'Collector',
    'reportsCustomer.col.state': 'Status',
    'reportsCustomer.col.method': 'Method',

    'reportsCustomer.stat.customers': 'Customers',
    'reportsCustomer.stat.customersSub': '{count} rows in view',
    'reportsCustomer.stat.billed': 'Billed',
    'reportsCustomer.stat.billedSub': '{count} bills',
    'reportsCustomer.stat.received': 'Received',
    'reportsCustomer.stat.receivedSub': '{count} payments',
    'reportsCustomer.stat.outstanding': 'Outstanding',
    'reportsCustomer.stat.outstandingSub': 'Still to recover',
    'reportsCustomer.stat.rate': 'Collection rate',
    'reportsCustomer.stat.rateSub': 'Received against billed',
    'reportsCustomer.stat.bills': 'Bills',
    'reportsCustomer.stat.billsSub': 'In {period}',
    'reportsCustomer.stat.ofBills': '{count} of {total} bills',

    'reportsCustomer.export.collectionTitle': 'Bill collection by customer — {mode} · {period}',
    'reportsCustomer.export.statusTitle': 'Bill status by customer — {period}',
    'reportsCustomer.export.subtitle': '{count} rows · {scope}',
  },
  bn: {
    'reportsCustomer.title': 'গ্রাহকভিত্তিক রিপোর্ট',
    'reportsCustomer.subtitle': 'গৃহস্থালি ধরে ধরে বিল আদায় ও বিলের অবস্থা',

    'reportsCustomer.tab.collection': 'বিল আদায়',
    'reportsCustomer.tab.status': 'বিলের অবস্থা',

    'reportsCustomer.mode.daily': 'দৈনিক',
    'reportsCustomer.mode.weekly': 'সাপ্তাহিক',
    'reportsCustomer.mode.monthly': 'মাসিক',
    'reportsCustomer.mode.yearly': 'বার্ষিক',

    'reportsCustomer.allPeriods': 'সব সময়কাল',
    'reportsCustomer.allWards': 'সব ওয়ার্ড',
    'reportsCustomer.weekLabel': 'সপ্তাহ {week}, {year}',
    'reportsCustomer.chip': '{label} ({count})',
    'reportsCustomer.rows': '{count}টি সারি',
    'reportsCustomer.empty': 'এই নির্বাচনে কোনো গ্রাহক সারি নেই।',
    'reportsCustomer.searchPlaceholder': 'গৃহকর্তা, হোল্ডিং, সড়ক বা গৃহস্থালি আইডি খুঁজুন…',

    'reportsCustomer.collection.title': 'বিল আদায়, গ্রাহকভিত্তিক',
    'reportsCustomer.collection.subtitle': 'প্রতিটি গৃহস্থালির বিলকৃত, আদায়কৃত ও বকেয়া — {mode} ভিত্তিতে।',
    'reportsCustomer.status.title': 'বিলের অবস্থা, গ্রাহকভিত্তিক',
    'reportsCustomer.status.subtitle': '{period} মাসের প্রতিটি বিল, প্রকৃত আদায়ের ভিত্তিতে নির্ধারিত।',

    'reportsCustomer.col.period': 'সময়কাল',
    'reportsCustomer.col.household': 'গৃহস্থালি',
    'reportsCustomer.col.ward': 'ওয়ার্ড',
    'reportsCustomer.col.holding': 'হোল্ডিং',
    'reportsCustomer.col.billed': 'বিলকৃত',
    'reportsCustomer.col.received': 'আদায়কৃত',
    'reportsCustomer.col.outstanding': 'বকেয়া',
    'reportsCustomer.col.rate': 'আদায়ের হার',
    'reportsCustomer.col.billId': 'বিল আইডি',
    'reportsCustomer.col.collector': 'সংগ্রাহক',
    'reportsCustomer.col.state': 'অবস্থা',
    'reportsCustomer.col.method': 'মাধ্যম',

    'reportsCustomer.stat.customers': 'গ্রাহক',
    'reportsCustomer.stat.customersSub': 'দৃশ্যমান {count}টি সারি',
    'reportsCustomer.stat.billed': 'বিলকৃত',
    'reportsCustomer.stat.billedSub': '{count}টি বিল',
    'reportsCustomer.stat.received': 'আদায়কৃত',
    'reportsCustomer.stat.receivedSub': '{count}টি পরিশোধ',
    'reportsCustomer.stat.outstanding': 'বকেয়া',
    'reportsCustomer.stat.outstandingSub': 'এখনও আদায় বাকি',
    'reportsCustomer.stat.rate': 'আদায়ের হার',
    'reportsCustomer.stat.rateSub': 'বিলকৃতের বিপরীতে আদায়',
    'reportsCustomer.stat.bills': 'বিল',
    'reportsCustomer.stat.billsSub': '{period} মাসে',
    'reportsCustomer.stat.ofBills': '{total}টির মধ্যে {count}টি বিল',

    'reportsCustomer.export.collectionTitle': 'গ্রাহকভিত্তিক বিল আদায় — {mode} · {period}',
    'reportsCustomer.export.statusTitle': 'গ্রাহকভিত্তিক বিলের অবস্থা — {period}',
    'reportsCustomer.export.subtitle': '{count}টি সারি · {scope}',
  },
}
