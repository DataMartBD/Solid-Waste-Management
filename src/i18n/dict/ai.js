// Sweep AI floating assistant — header chrome, shortcut chips, the greeting,
// the canned answer sentences and their deep-link buttons.
// Numbers are formatted by the caller (n / taka / percent) and injected through
// the {placeholders}, so the digits localise along with the sentence.

export default {
  en: {
    'ai.title': 'Sweep AI',
    'ai.subtitle': 'Assistant · beta',
    'ai.greeting': "Hi! I'm Sweep AI. Ask me about collection, dues, fleet or complaints — or tap a shortcut below.",
    'ai.placeholder': 'Ask Sweep AI…',
    'ai.send': 'Send',
    // While POST /api/ai/ask is in flight, and when it fails.
    'ai.sending': 'Sending…',
    'ai.thinking': 'Checking the latest figures…',
    'ai.error': 'I could not answer that just now. Please try again.',
    'ai.offline': 'I cannot reach the server, so I have no figures to answer with.',

    'ai.sug.dues': 'How many households have dues?',
    'ai.sug.vans': 'Which vans need service?',
    'ai.sug.complaints': 'Show open complaints',
    'ai.sug.rate': 'Collection rate this period',

    'ai.answer.dues': '{count} households currently have outstanding dues, totalling {amount}.',
    'ai.answer.fleet': '{count} van(s) need attention (service due or in maintenance).',
    'ai.answer.complaints': 'There are {count} active complaint tickets.',
    'ai.answer.collection': 'Collected {paid} of {billed} billed ({rate} charge rate).',
    'ai.answer.households': '{count} households are registered. Customer reports break this down by ward and road.',
    'ai.answer.fallback': 'I can help with dues, fleet/maintenance, complaints, and collection rates — try one of the shortcuts below.',

    'ai.go.billing': 'View billing',
    'ai.go.fleet': 'Open fleet',
    'ai.go.complaints': 'View complaints',
    'ai.go.openReports': 'Open reports',
    'ai.go.viewReports': 'View reports',
    'ai.go.default': 'Open',
  },
  bn: {
    'ai.title': 'সুইপ এআই',
    'ai.subtitle': 'সহকারী · বেটা',
    'ai.greeting': 'হ্যালো! আমি সুইপ এআই। সংগ্রহ, বকেয়া, গাড়ি বা অভিযোগ নিয়ে যা জানতে চান জিজ্ঞেস করুন — অথবা নিচের শর্টকাটে চাপ দিন।',
    'ai.placeholder': 'সুইপ এআইকে জিজ্ঞেস করুন…',
    'ai.send': 'পাঠান',
    'ai.sending': 'পাঠানো হচ্ছে…',
    'ai.thinking': 'সর্বশেষ হিসাব দেখা হচ্ছে…',
    'ai.error': 'এখনই উত্তর দিতে পারলাম না। আবার চেষ্টা করুন।',
    'ai.offline': 'সার্ভারে পৌঁছানো যাচ্ছে না, তাই কোনো হিসাব দিয়ে উত্তর দিতে পারছি না।',

    'ai.sug.dues': 'কতগুলো হাউসহোল্ডের বকেয়া আছে?',
    'ai.sug.vans': 'কোন ভ্যানগুলোর সার্ভিস দরকার?',
    'ai.sug.complaints': 'খোলা অভিযোগগুলো দেখান',
    'ai.sug.rate': 'এই সময়ের আদায়ের হার',

    'ai.answer.dues': 'এখন {count}টি হাউসহোল্ডের বকেয়া আছে, সব মিলিয়ে {amount}।',
    'ai.answer.fleet': '{count}টি ভ্যানের দিকে নজর দিতে হবে (সার্ভিসের সময় হয়েছে বা রক্ষণাবেক্ষণে আছে)।',
    'ai.answer.complaints': 'এই মুহূর্তে {count}টি অভিযোগ টিকিট একটিভ আছে।',
    'ai.answer.collection': 'বিল হয়েছে {billed}, তার মধ্যে আদায় হয়েছে {paid} (আদায়ের হার {rate})।',
    'ai.answer.households': 'মোট {count}টি হাউসহোল্ড নিবন্ধিত আছে। কাস্টমার রিপোর্টে ওয়ার্ড ও রাস্তা অনুযায়ী এর বিস্তারিত পাবেন।',
    'ai.answer.fallback': 'আমি বকেয়া, গাড়ি/রক্ষণাবেক্ষণ, অভিযোগ ও আদায়ের হার নিয়ে সাহায্য করতে পারি — নিচের শর্টকাটগুলোর একটি চেষ্টা করে দেখুন।',

    'ai.go.billing': 'বিলিং দেখুন',
    'ai.go.fleet': 'গাড়ি খুলুন',
    'ai.go.complaints': 'অভিযোগ দেখুন',
    'ai.go.openReports': 'রিপোর্ট খুলুন',
    'ai.go.viewReports': 'রিপোর্ট দেখুন',
    'ai.go.default': 'খুলুন',
  },
}
