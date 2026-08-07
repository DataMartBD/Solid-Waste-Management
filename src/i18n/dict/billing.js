// Service-charge collection screen — summary cards, bill list and the
// record-payment dialog. Status badges come from common.js (status.*) and
// payment methods from options.js (opt.paymentMode.*), so nothing is repeated
// here.

export default {
  en: {
    'billing.title': 'Service Charge Collection',
    'billing.subtitle': 'Automated billing & reconciliation · period {period}',
    'billing.exportCsv': 'Export CSV',
    'billing.recordPayment': 'Record payment',

    'billing.totalBilled': 'Total billed',
    'billing.totalBilledSub': '{count} households · this period',
    'billing.collected': 'Collected',
    'billing.collectedSub': '{rate} collection rate',
    'billing.outstanding': 'Outstanding',
    'billing.outstandingSub': 'Dues + {partial} + {overdue}',
    'billing.collectionRate': 'Collection rate',
    'billing.collectionRateSub': 'Target ≥ {target}',

    'billing.chartTitle': 'Billed vs collected',
    'billing.collectedLower': 'collected',

    'billing.billCount': '{count} bills',

    'billing.col.billId': 'Bill ID',
    'billing.col.household': 'Household',
    'billing.col.ward': 'Ward',
    'billing.col.period': 'Period',
    'billing.col.amount': 'Amount',
    'billing.col.amountBdt': 'Amount (BDT)',
    'billing.col.method': 'Method',
    'billing.col.status': 'Status',
    'billing.col.receivedBdt': 'Received (BDT)',
    'billing.col.outstandingBdt': 'Outstanding (BDT)',

    'billing.receipt': 'receipt',
    'billing.empty': 'No bills in this view.',
    'billing.error.generic': 'The request could not be completed.',

    'billing.amountDue': 'Amount due',
    'billing.paymentMethod': 'Payment method',
    'billing.receiptNo': 'Receipt no.',
    'billing.confirmPaid': 'Confirm {amount} paid',

    // A bill carries what has really been received against it, so a part payment
    // is shown as the figure it is instead of being guessed at.
    'billing.received': 'Received',
    'billing.receivedOf': '{received} received · {due} due',
    'billing.amountReceived': 'Amount received',
    'billing.amountHint': 'Up to {amount} outstanding',
    'billing.reference': 'Reference',
    'billing.referencePlaceholder': 'bKash / bank transaction id',
    'billing.referenceHint': 'Optional — leave blank for cash',
    'billing.priorPayments': 'Already received',

    'billing.generate': 'Generate bills',
    'billing.generateTitle': 'Generate bills for {period}',
    'billing.generateSubtitle': 'One charge per active, routed household. Safe to run twice.',
    'billing.generateNew': 'New bills',
    'billing.generateAmount': 'New charges',
    'billing.generateSkipped': 'Already issued',
    'billing.generateMonthTotal': 'Month total after this run',
    'billing.generateDueOn': 'Due on',
    'billing.generateHint': 'Nothing has been written yet. Confirm to issue {count} bills.',
    'billing.generateNone': 'Every eligible household is already billed for this month.',
    'billing.generateConfirm': 'Issue {count} bills',
  },
  bn: {
    'billing.title': 'সার্ভিস চার্জ আদায়',
    'billing.subtitle': 'স্বয়ংক্রিয় বিল ও হিসাব মিলকরণ · সময়কাল {period}',
    'billing.exportCsv': 'সিএসভি ডাউনলোড',
    'billing.recordPayment': 'পেমেন্ট দাখিল করুন',

    'billing.totalBilled': 'মোট বিলকৃত',
    'billing.totalBilledSub': '{count}টি হাউসহোল্ড · এই সময়কালে',
    'billing.collected': 'আদায়কৃত',
    'billing.collectedSub': 'আদায়ের হার {rate}',
    'billing.outstanding': 'বকেয়া',
    'billing.outstandingSub': 'বকেয়া + {partial} + {overdue}',
    'billing.collectionRate': 'আদায়ের হার',
    'billing.collectionRateSub': 'লক্ষ্যমাত্রা ≥ {target}',

    'billing.chartTitle': 'বিলকৃত বনাম আদায়কৃত',
    'billing.collectedLower': 'আদায় হয়েছে',

    'billing.billCount': '{count}টি বিল',

    'billing.col.billId': 'বিল আইডি',
    'billing.col.household': 'হাউসহোল্ডস',
    'billing.col.ward': 'ওয়ার্ড',
    'billing.col.period': 'সময়কাল',
    'billing.col.amount': 'পরিমাণ',
    'billing.col.amountBdt': 'পরিমাণ (টাকা)',
    'billing.col.method': 'মাধ্যম',
    'billing.col.status': 'অবস্থা',
    'billing.col.receivedBdt': 'আদায়কৃত (টাকা)',
    'billing.col.outstandingBdt': 'বকেয়া (টাকা)',

    'billing.receipt': 'রসিদ',
    'billing.empty': 'এই তালিকায় কোনো বিল নেই।',
    'billing.error.generic': 'অনুরোধটি সম্পন্ন করা যায়নি।',

    'billing.amountDue': 'পেমেন্টের পরিমাণ',
    'billing.paymentMethod': 'পেমেন্টের মাধ্যম',
    'billing.receiptNo': 'রসিদ নম্বর',
    'billing.confirmPaid': '{amount} পেমেন্ট নিশ্চিত করুন',

    'billing.received': 'আদায়কৃত',
    'billing.receivedOf': '{received} আদায় · {due} বকেয়া',
    'billing.amountReceived': 'আদায়কৃত পরিমাণ',
    'billing.amountHint': 'সর্বোচ্চ {amount} বকেয়া',
    'billing.reference': 'রেফারেন্স',
    'billing.referencePlaceholder': 'বিকাশ / ব্যাংক লেনদেন নম্বর',
    'billing.referenceHint': 'ঐচ্ছিক — নগদের ক্ষেত্রে ফাঁকা রাখুন',
    'billing.priorPayments': 'ইতিমধ্যে আদায়কৃত',

    'billing.generate': 'বিল তৈরি করুন',
    'billing.generateTitle': '{period}-এর বিল তৈরি করুন',
    'billing.generateSubtitle': 'রুটে থাকা প্রতিটি একটিভ হাউসহোল্ডের জন্য একটি চার্জ। দুইবার চালালেও সমস্যা নেই।',
    'billing.generateNew': 'নতুন বিল',
    'billing.generateAmount': 'নতুন চার্জ',
    'billing.generateSkipped': 'আগেই তৈরি হয়েছে',
    'billing.generateMonthTotal': 'এই ধাপের পর মাসের মোট',
    'billing.generateDueOn': 'পেমেন্টের শেষ তারিখ',
    'billing.generateHint': 'এখনও কিছু সংরক্ষণ করা হয়নি। {count}টি বিল তৈরি করতে নিশ্চিত করুন।',
    'billing.generateNone': 'এই মাসের জন্য যোগ্য প্রতিটি হাউসহোল্ডের বিল আগেই তৈরি হয়েছে।',
    'billing.generateConfirm': '{count}টি বিল তৈরি করুন',
  },
}
