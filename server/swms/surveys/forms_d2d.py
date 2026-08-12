"""The door-to-door household survey, transcribed from the printed form.

Source: "Sylhet City Corporation (SCC) Survey Form Organized by READO
Bangladesh", 11 pages, ~65 questions.

This is *data*, not schema — one questionnaire that `seed_survey_form` loads
into the form engine. A second city, or a revised wording, is another file like
this one rather than a migration.

Transcription notes, so a later reader can check it against the paper:

* Question numbers ran exactly as printed in v1. From v2 the survey section is
  ordered as the field team asked — house number first, then survey area,
  district, thana and ward — so the numbers are this form's own running order,
  and everything after the section shifts by the one question that was added.
  The unnumbered run at the end carries `number=""` and keeps its printed order.
* Version 2 also stopped hard-coding "Sylhet" as the only district. District and
  thana are drawn from `catalog.GeoLocation`, which is the list the holding
  register offers, so a survey and the holding it is converted into agree.
* Bangla is the source text; the English alongside is a translation for the
  English UI and for exports, not an alternative wording of the question.
* `maps_to` marks the handful of answers that also belong in a column — the
  address, the GPS, the fee figures — so reports do not have to walk answers.
* `shown_if` is the conditional logic the paper expresses by greying a question
  out. `(question_code, [option_codes])` means "only when that question was
  answered with one of these".
"""

CODE = "d2d-household"
#: v1 has surveys attached, so it is frozen — the engine refuses to edit a
#: version people have already answered. This is v2.
VERSION = 2
TITLE = "Door-to-door solid waste household survey"
TITLE_BN = "বাড়ি বাড়ি কঠিন বর্জ্য সংগ্রহ জরিপ"
ORGANISATION = "Sylhet City Corporation · READO Bangladesh"

#: Sections, in the order the paper runs.
SURVEY_META = "Survey"
RESPONDENT = "Respondent & premises"
WASTE = "Waste generation & storage"
SERVICE = "Collection service"
COMPLAINTS = "Complaints"
FEES = "Fees"
OBSERVATION = "Observation"
LOCATION = "Location"


def q(code, number, section, kind, text, text_bn, **extra):
    return {
        "code": code, "number": number, "section": section, "kind": kind,
        "text": text, "text_bn": text_bn, **extra,
    }


def opts(*pairs):
    """`("code", "English", "বাংলা")` triples, in printed order."""
    return [
        {"code": c, "label": en, "label_bn": bn, "is_other": c == "other"}
        for c, en, bn in pairs
    ]


YES_NO = opts(("yes", "Yes", "হ্যাঁ"), ("no", "No", "না"))
YES_NO_DK = YES_NO + opts(("dont_know", "Do not know", "জানি না"))

QUESTIONS = [
    # ---------------------------------------------------------------- survey
    # The address is asked narrowing down: the house first, then the area it is
    # in, then district, thana and ward. This is the order the field team asked
    # for and it is not the order on the Sylhet paper, so the numbers below are
    # this form's own running order rather than the printed ones.
    q("holding_no", "1", SURVEY_META, "text", "House no.", "বাসা নং",
      hint="One per premises", hint_bn="একটা স্থাপনায় একটা হবে",
      required=True, maps_to="holding_no"),
    # A single-option dropdown on the paper, because that copy was printed for
    # Sylhet. It stays as printed; a deployment covering another corporation
    # edits this option list.
    q("survey_area", "2", SURVEY_META, "single", "Survey area", "জরিপ এলাকা",
      hint="Choose the survey area", hint_bn="জরিপ এলাকা নির্বাচন করুন", required=True,
      options=opts(("scc", "Sylhet City Corporation", "সিলেট সিটি কর্পোরেশন"))),
    # District and thana were one hard-coded option ("Sylhet") on the paper.
    # They now draw on the national geography table, the same list the holding
    # register offers, so a survey and the holding it becomes agree on where the
    # building is. Thana narrows to the district chosen above it.
    q("district", "3", SURVEY_META, "single", "District", "জেলা",
      hint_bn="জেলা নির্বাচন করুন", required=True,
      maps_to="district", options_source="district"),
    q("thana", "4", SURVEY_META, "single", "Thana / upazila", "থানা / উপজেলা",
      hint="Thanas of the district chosen above",
      hint_bn="উপরে নির্বাচিত জেলার থানা",
      maps_to="thana", options_source="thana"),
    q("ward", "5", SURVEY_META, "single", "Ward no.", "ওয়ার্ড নং",
      hint_bn="ওয়ার্ড নং নির্বাচন করুন", required=True, maps_to="ward_id",
      options_source="ward"),
    q("block", "6", SURVEY_META, "single", "Block name", "ব্লক নাম", maps_to="block_id",
      hint="Blocks of the ward chosen above", hint_bn="উপরে নির্বাচিত ওয়ার্ডের ব্লক",
      options_source="block"),
    q("road_name", "7", SURVEY_META, "text", "Road / street / mohalla name",
      "সড়ক/রোড/মহল্লা/-এর নাম", maps_to="road_name", width="wide"),
    # The paper names Sylhet's eight surveyors. That roster is staff, not
    # questionnaire — sourced from the collector table so the same form works
    # wherever it is run.
    q("surveyor", "8", SURVEY_META, "single", "Surveyor name", "জরিপকারীর নাম",
      hint="Full name, in Bangla", hint_bn="পূর্ণ নাম লিখুন (বাংলায়)", required=True,
      maps_to="surveyor_id", options_source="collector"),
    q("surveyed_on", "09", SURVEY_META, "date", "Survey date", "জরিপের তারিখ",
      hint_bn="তারিখ নির্বাচন করুন", required=True, maps_to="surveyed_on"),
    q("partner", "10", SURVEY_META, "single",
      "Partner organisation collecting the data",
      "তথ্য সংগ্রহকারী সহযোগি ব্যাক্তি/ প্রতিষ্ঠানের ধরণ ও নাম",
      hint_bn="প্রতিষ্ঠান এর ধরণ নির্বাচন করুন",
      options=opts(("ngo_reado", "NGO (READO Bangladesh)", "এনজিও ( রিডো বাংলাদেশ )"))),

    # ------------------------------------------------------------ respondent
    q("respondent_name", "11", RESPONDENT, "text", "Respondent name", "উত্তরদাতার নাম",
      hint="Full name", hint_bn="পূর্ণ নাম লিখুন", maps_to="respondent_name"),
    q("respondent_phone", "12", RESPONDENT, "text", "Respondent mobile no.",
      "উত্তরদাতার মোবাইল নং:", hint="Write the correct mobile number",
      hint_bn="সঠিক মোবাইল নাম্বার লিখুন", maps_to="respondent_phone"),
    q("premises_type", "13", RESPONDENT, "single", "Type of building / premises",
      "বাড়ির /স্থাপনার ধরণ:", hint="Tick after observing", hint_bn="পর্যবেক্ষণ করে টিক দিন",
      required=True, maps_to="premises_type",
      options=opts(
          ("residential", "Residential", "আবাসিক"),
          ("commercial", "Commercial", "বানিজ্যিক"),
          ("institution", "Institution", "প্রতিষ্ঠান"),
          ("mixed", "Mixed", "মিশ্র"),
          ("other", "Other", "অন্যান্য"),
      )),
    q("residential_detail", "14", RESPONDENT, "single",
      "Residential building description", "আবাসিক বাড়ি/স্থাপনার বিবরণ",
      hint_bn="পর্যবেক্ষণ করে টিক দিন",
      shown_if=("premises_type", ["residential"]),
      options=opts(
          ("kacha", "Kacha", "কাচা"),
          ("tinshed", "Tin-shed", "টিনসেড"),
          ("semi_pucca", "Semi-pucca", "সেমি পাকা"),
          ("pucca_1", "Pucca — 1 storey", "পাকা-১ তলা"),
          ("pucca_2_3", "Pucca — 2-3 storeys", "পাকা-২-৩ তলা"),
          ("pucca_4_6", "Pucca — 4-6 storeys", "পাকা-৪-৬ তলা"),
          ("pucca_7_9", "Pucca — 7-9 storeys", "পাকা ৭-৯ তলা"),
          ("pucca_10_20", "Pucca — 10-20 storeys", "পাকা ১০-২০ তলা"),
      )),
    q("commercial_detail", "15", RESPONDENT, "text", "Commercial premises description",
      "বানিজ্যিক স্থাপনার বিবরণ", hint_bn="পর্যবেক্ষণ করে টিক দিন",
      shown_if=("premises_type", ["commercial"]), width="wide"),
    q("commercial_other", "16", RESPONDENT, "text",
      "Name of other commercial premises", "অন্যান্য বানিজ্যিক স্থাপনার নাম লিখুন"),
    q("institution_type", "17", RESPONDENT, "single", "Type of institution",
      "প্রতিষ্ঠানের ধরণ", hint_bn="নির্বাচন করুন",
      shown_if=("premises_type", ["institution"]),
      options=opts(("govt", "Government", "সরকারি"), ("private", "Private", "বেসরকারি"),
                   ("other", "Other", "অন্যান্য"))),
    q("mixed_detail", "18", RESPONDENT, "text", "Description of mixed premises",
      "মিশ্র ধরনের স্থাপনার বিবরণ লিখুন", shown_if=("premises_type", ["mixed"]), width="wide"),
    q("institution_other", "19", RESPONDENT, "text",
      "State the other type of institution", "অন্যান্য প্রতিষ্ঠানের ধরন উল্লেখ করুন"),
    q("respondent_role", "20", RESPONDENT, "single", "Respondent type", "উত্তরদাতার ধরন",
      hint_bn="নির্বাচন করুন",
      options=opts(
          ("house_owner", "House owner", "বাড়ির মালিক"),
          ("flat_owner", "Flat owner", "ফ্লাটের মালিক"),
          ("shop_owner", "Shop owner", "দোকান মালিক"),
          ("tenant", "Tenant", "ভাড়াটিয়া"),
          ("manager", "Manager", "ম্যানেজার"),
          ("caretaker", "Caretaker", "কেয়ারটেকার"),
          ("other", "Other", "অন্যান্য"),
      )),
    q("respondent_role_other", "21", RESPONDENT, "text",
      "State the other respondent type", "অন্যান্য উত্তরদাতার ধরন লিখুন"),
    q("owner_name", "22", RESPONDENT, "text", "Name of the house / flat owner",
      "বাড়ির/ফ্লাটের মালিকের নাম:", hint="Full name, in Bangla",
      hint_bn="পূর্ণ নাম লিখুন (বাংলায়)", maps_to="owner_name"),
    q("household_count", "23", RESPONDENT, "number",
      "Number of families / flats living in this building",
      "উক্ত বাড়িতে বসবাসরত পরিবার/ফ্লাট-এর সংখ্যা",
      hint="Once per premises", hint_bn="একটি স্থাপনার ক্ষেত্রে একবার লিখতে হবে",
      min_value=0, max_value=500, maps_to="household_count"),
    q("respondent_gender", "24", RESPONDENT, "single", "Respondent gender",
      "উত্তরদাতার লিঙ্গ", hint_bn="নির্বাচন করুন",
      options=opts(("female", "Female", "নারী"), ("male", "Male", "পুরুষ"),
                   ("third", "Third gender", "তৃতীয় লিঙ্গ"))),
    q("head_occupation", "25", RESPONDENT, "single", "Occupation of the head of family",
      "পরিবার প্রধানের পেশা", hint_bn="নির্বাচন করুন",
      options=opts(
          ("govt_job", "Government service", "সরকারি চাকুরি"),
          ("private_job", "Private service", "বেসরকারি চাকুরি"),
          ("business", "Business", "ব্যবসায়ী"),
          ("entrepreneur", "Entrepreneur", "উদ্যোক্তা"),
          ("contractor", "Contractor", "ঠিকাদার"),
          ("expatriate", "Expatriate", "প্রবাসী"),
          ("homemaker", "Homemaker", "গৃহীনি"),
          ("unemployed", "Unemployed", "বেকার"),
          ("professional", "Independent profession (doctor, lawyer, designer…)",
           "স্বাধীন পেশা (ডাক্তার, আইনজীবি, ডিজাইনার ইত্যাদি)"),
          ("other", "Other", "অন্যান্য"),
      )),
    q("head_occupation_other", "26", RESPONDENT, "text", "State the other occupation",
      "অন্যান্য পেশার নাম লিখুন", shown_if=("head_occupation", ["other"])),
    q("years_here", "27", RESPONDENT, "number",
      "How many years have you lived / traded at this address",
      "কত বছর এই বাস-বাড়িতে/প্রতিষ্ঠানে বসবাস/ব্যবসা করছেন",
      hint="State the number of years", hint_bn="বছর উল্লেখ করুন", min_value=0, max_value=150),
    q("floor_no", "28", RESPONDENT, "number", "Which floor is your home on",
      "আপনার বাসা কত তলায়", hint="If residential and above the ground floor",
      hint_bn="আবাসিক ১ তলার উপরে হলে", min_value=0, max_value=50),
    q("member_count", "29", RESPONDENT, "number", "Number of family members",
      "পরিবারের সদস্য সংখ্যা", hint="Including a mess, hostel or student residence",
      hint_bn="আবাসিক মেস, হোস্টেল, ছাত্রাবাস হলে", min_value=0, max_value=999),

    # ----------------------------------------------------------------- waste
    q("waste_types", "30", WASTE, "multi",
      "Types of solid waste your family / institution produces",
      "আপনার পরিবার/প্রতিষ্ঠানে উৎপন্ন কঠিন বর্জ্যের ধরণ", hint_bn="নির্বাচন করুন",
      options=opts(
          ("organic", "Compostable (kitchen waste, fruit peel, food packets, paper)",
           "পচনশীল (রান্নাঘরের বর্জ্য, ফলের খোসা, খাবারের প্যাকেট, কাগজ)"),
          ("inorganic", "Non-compostable (plastic/polythene bags, bottles, others)",
           "অপচনশীল (প্লাস্টিক/পলিথিন জাতীয় ব্যাগ, বোতল, অন্যান্য)"),
          ("medical", "Clinical / medical waste", "চিকিৎসা/মেডিকেল বর্জ্য"),
          ("ewaste", "E-waste (electronic and electrical)", "ই-বর্জ্য (ইলেকট্রনিক ও ইলেকট্রিক্যাল)"),
          ("mixed", "Mixed (compostable, non-compostable, medical, e-waste)",
           "মিশ্র (পচনশীল, অপচনশীল, চিকিৎসা/মেডিকেল, ই-বর্জ্য )"),
          ("other", "Other", "অন্যান্য"),
      )),
    q("waste_types_other", "31", WASTE, "text", "State the other type of waste",
      "অন্যান্য বর্জ্যের ধরণ লিখুন", shown_if=("waste_types", ["other"])),
    q("daily_waste_kg", "32", WASTE, "number", "Daily waste produced (kg)",
      "দৈনিক উৎপন্ন বর্জ্যের পরিমাণ (কেজি)", min_value=0, max_value=10000,
      maps_to="daily_waste_kg"),
    q("storage_method", "33", WASTE, "multi", "How do you store your waste?",
      "আপনাদের ময়লা-আর্বজনা কি প্রক্রিয়ায় সংরক্ষণ করেন?", hint_bn="নির্বাচন করুন",
      options=opts(
          ("separated", "Compostable and non-compostable separately",
           "পচনশীল ও অপচনশীল পৃথকভাবে"),
          ("together", "All waste together / mixed", "সকল বর্জ্য একত্রে/মিশ্রিতভাবে"),
          ("sellable_apart", "Sellable waste separately", "বিক্রয়যোগ্য বর্জ্য আলাদাভাবে"),
          ("hazardous_apart", "Hazardous waste separately", "ঝুকিপূর্ণ বর্জ্য আলাদাভাবে"),
          ("other", "Other", "অন্যান্য"),
      )),
    q("storage_method_other", "34", WASTE, "text",
      "Describe the other storage process", "অন্যান্য সংরক্ষণ প্রক্রিয়ার বিবরণ লিখুন",
      shown_if=("storage_method", ["other"]), width="wide"),
    q("storage_container", "35", WASTE, "single", "Where / in what do you store it at home?",
      "আপনাদের বাসায় ময়লা-আর্বজনা কোথায়/কিসে সংরক্ষণ করেন", hint_bn="নির্বাচন করুন",
      options=opts(
          ("polybag", "Plastic bag / polythene", "প্লাস্টিকের ব্যাগ/পলিথিন"),
          ("open_bin", "Open pot / bucket", "খোলা পাত্র/বালতিতে"),
          ("covered_bin", "Covered pot / bucket", "ঢাকনাযুক্ত পাত্র/বালতিতে"),
          ("other", "Other", "অন্যান্য"),
      )),
    q("storage_container_other", "36", WASTE, "text",
      "Describe where else you store it", "অন্যান্য কোথায় সংরক্ষণ করেন তার বিবরণ লিখুন",
      shown_if=("storage_container", ["other"]), width="wide"),

    # --------------------------------------------------------------- service
    q("gives_to_van", "37", SERVICE, "single", "Do you give your solid waste to a van?",
      "আপনাদের কঠিন বর্জ্য কি কোন ভ্যানগাড়িতে দেন?", hint_bn="নির্বাচন করুন",
      required=True, maps_to="gives_to_van", options=YES_NO),
    q("van_given_to", "38", SERVICE, "text", "If yes, who do you give it to?",
      "ভ্যানে ময়লা দিলে, কাকে দেন?",
      hint="Name of the organisation, society or person",
      hint_bn="সংস্থা/প্রতিষ্ঠান/সমিতি/ব্যাক্তির নাম লিখুন",
      shown_if=("gives_to_van", ["yes"]), width="wide"),
    q("dump_place", "39", SERVICE, "single",
      "If not given to a van, where do you dispose of it?",
      "ভ্যানে ময়লা না দিলে বর্জ্য/ময়লা-আর্বজনা কোথায় ফেলেন", hint_bn="নির্বাচন করুন",
      shown_if=("gives_to_van", ["no"]),
      options=opts(
          ("corp_dustbin", "Corporation / municipal dustbin",
           "কর্পোরেশন/পৌরসভার নির্ধারিত ডাস্টবিনে"),
          ("corp_container", "Corporation / municipal container",
           "সিটি কর্পোরেশন/পৌরসভার নির্ধারিত কন্টেননারে"),
          ("open_sts", "Corporation / municipal open STS",
           "সিটি কর্পোরেশন/পৌরসভার নির্ধারিত উন্মুক্ত এসটিএস-"),
          ("sts", "Corporation / municipal STS", "সিটি কর্পোরেশন/পৌরসভার এসটিএস-এ"),
          ("street_marked", "A marked place on the street", "রাস্তায় নির্ধারিত স্থানে"),
          ("street_unmarked", "An unmarked place on the street", "রাস্থায় অনির্ধারিত স্থানে"),
          ("drain", "Drain", "ড্রেনে"),
          ("ditch", "Ditch", "ডোবায়"),
          ("waterbody", "River / canal / water body", "নদী/খাল/জলাশয়ে"),
          ("maid_takes", "The domestic help takes valuable waste away",
           "মুল্যাবান বর্জ্য কাজের বুয়া নিয়ে যায়"),
          ("sold", "Valuable waste sold to a hawker", "মুল্যাবান বর্জ্য ফেরিওয়ালার নিকট বিক্রি করি"),
          ("own_use", "Used in my own garden / farm / project",
           "নিজস্ব বাগান/খামার/প্রজেক্টে ব্যবহার করি"),
          ("other", "Other", "অন্যান্য"),
      )),
    q("dump_place_other", "40", SERVICE, "text", "State the other place",
      "অন্যান্য স্থানের বিবরণ/নাম উল্লেখ করুন", shown_if=("dump_place", ["other"])),
    q("no_van_reasons", "41", SERVICE, "multi", "Why do you not give waste to a van?",
      "ভ্যান গাড়িতে বর্জ্য/ময়লা না দেয়ার কারণ কী", hint_bn="নির্বাচন করুন",
      shown_if=("gives_to_van", ["no"]),
      options=opts(
          ("nobody_comes", "Nobody comes to take the waste", "বর্জ্য/ময়লা-আর্বজনা নিতে কেউ আসে না"),
          ("too_expensive", "They ask too much money", "বেশি টাকা চায়"),
          ("irregular", "They do not take it regularly", "নিয়মিত বর্জ্য/ময়লা-আর্বজনা নেয় না"),
          ("dustbin_available", "A corporation dustbin is available",
           "সিটি কর্পোরেশনের/ পৌরসভার ডাস্টবিনে ফেলার সুযোগ আছে"),
          ("staff_takes", "The domestic help takes it", "কাজের লোক নিয়ে যায়"),
          ("other", "Other", "অন্যান্য"),
      )),
    q("no_van_reason_other", "42", SERVICE, "text", "State the other reason",
      "অন্যান্য কারণ লিখুন", shown_if=("no_van_reasons", ["other"])),
    q("would_give", "43", SERVICE, "single",
      "If a van offered to collect your waste, would you give it?",
      "কোন ভ্যান গাড়ি আপনার বর্জ্য/ময়লা-আর্বজনা সংগ্রহ করতে চাইলে দিবেন কি?",
      hint_bn="নির্বাচন করুন",
      options=YES_NO + opts(("maybe", "Option 3", "Option 3"))),
    q("handover_preference", "44", SERVICE, "single", "How would you like to hand it over?",
      "ভ্যানে বর্জ্য/ময়লা-আর্বজনা কিভাবে দিতে চান?", hint_bn="নির্বাচন করুন",
      options=opts(
          ("from_home", "From the house", "বাসা থেকে"),
          ("downstairs_bin", "In a pot / container kept downstairs",
           "বাসার নিচে রক্ষিত পাত্র/ কনটেইনারে"),
          ("other", "Other", "অন্যান্য"),
      )),
    q("handover_other", "", SERVICE, "text", "State how else you would hand it over",
      "অন্য কিভাবে দিকে চান তা উল্লেখ করুন", shown_if=("handover_preference", ["other"])),
    q("knows_collector", "45", SERVICE, "single",
      "Do you know which organisation / person collects waste by van here?",
      "এই এলাকায় কোন সংস্থার/ব্যক্তির ভ্যান গাড়িতে বর্জ্য/ময়লা-আর্বজনা সংগ্রহ করে?",
      hint_bn="নির্বাচন করুন",
      options=opts(("no", "Do not know", "জানি না"), ("yes", "I know", "জানি"))),
    q("collector_name", "46", SERVICE, "text", "If you know, write the name",
      "জানলে তার নাম লিখুন:", hint="Full name, in Bangla", hint_bn="পূর্ন নাম লিখুন (বাংলায়)",
      shown_if=("knows_collector", ["yes"])),
    q("collection_frequency", "47", SERVICE, "single", "When does the van collect?",
      "কখন ভ্যান গাড়িতে বর্জ্য/ময়লা-আর্বজনা সংগ্রহ করে", hint_bn="নির্বাচন করুন",
      options=opts(
          ("daily7", "Regularly, 7 days a week", "নিয়মিত সপ্তাহে ৭ দিন"),
          ("daily6", "Regularly, 6 days a week", "নিয়মিত সপ্তাহে ৬ দিন"),
          ("irregular", "Irregularly / occasionally", "অনিয়মিত/মাঝেমাঝে"),
          ("alternate", "Every other day", "১ দিন পরপর"),
          ("other", "Other", "অন্যান্য"),
      )),
    q("collection_frequency_other", "48", SERVICE, "text", "State the other timing",
      "অন্যান্য সময় লিখুন", shown_if=("collection_frequency", ["other"]), width="wide"),
    q("satisfaction", "49", SERVICE, "single",
      "How satisfied are you with the current van service?",
      "ভ্যানে ময়লা দিলে তাদের বর্তমান সেবায় আপনি কি সন্তুষ্ট কেমন?",
      options=opts(
          ("very_satisfied", "Very satisfied", "অত্যন্ত সন্তুষ্ট"),
          ("satisfied", "Satisfied", "সন্তুষ্ট"),
          ("partly", "Partly satisfied", "আংশিক সন্তুষ্ট"),
          ("dissatisfied", "Dissatisfied", "অসন্তুষ্ট"),
          ("very_dissatisfied", "Very dissatisfied", "অত্যন্ত অসন্তুষ্ট"),
      )),

    # ------------------------------------------------------------ complaints
    q("dissatisfaction_reasons", "50", COMPLAINTS, "multi",
      "If dissatisfied, why?", "অসন্তুস্ট হলে তার কারণ কি",
      shown_if=("satisfaction", ["partly", "dissatisfied", "very_dissatisfied"]),
      options=opts(
          ("irregular", "They do not come regularly", "নিয়মিত আসে না"),
          ("late", "They do not come on time", "সময়মত আসেনা"),
          ("behaviour", "There are behaviour problems", "আচনগত সমস্যা আছে"),
          ("spills", "They spill waste while collecting", "ময়লা নেয়ার সময় সেখানে সেখানে ময়লা ফেলে যায়"),
          ("different_people", "A different person each day", "এক-একদিন এক-একজন আসে"),
          ("overcharges", "They demand extra money", "অতিরিক্ত টাকা দাবি করে"),
          ("other", "Other", "অন্যান্য"),
      )),
    q("dissatisfaction_other", "51", COMPLAINTS, "text", "State the other reason",
      "অন্যান্য কারণ লিখুন", shown_if=("dissatisfaction_reasons", ["other"]), width="wide"),
    q("complaint_channel_exists", "52", COMPLAINTS, "single",
      "Is there any way to complain about a problem with the van service?",
      "ভ্যানে ময়লা দেয়ায় কোন সমস্যা হলে তার জন্য কি কোন অভিযোগের ব্যবস্থা আছে?",
      options=YES_NO_DK),
    q("complaint_channels", "53", COMPLAINTS, "multi", "How can a complaint be made?",
      "কিভাবে অভিযোগ করা যায়", shown_if=("complaint_channel_exists", ["yes"]),
      options=opts(
          ("phone", "There is a designated phone number", "নির্ধারিত ফোন নাম্বার আছে"),
          ("they_call", "They call now and then to ask for feedback",
           "তারা মাঝে মাঝে ফোন করে মতামত জানতে চায়"),
          ("verbal", "Verbally, when the waste or the money is collected",
           "ময়লা নেয়ার বা টাকা সময় মৌখিকভাবে"),
          ("other", "Other", "অন্যান্য"),
      )),
    q("complaint_channel_other", "54", COMPLAINTS, "text", "State the other way",
      "অন্যান্য উপায় লিখুন", shown_if=("complaint_channels", ["other"]), width="wide"),
    q("complaint_resolved", "55", COMPLAINTS, "single",
      "Is a complaint resolved when you make one?", "অভিযোগ করলে সমাধান পাওয়া যায় কি?",
      options=YES_NO + opts(("sometimes", "Sometimes", "মাঝেমাঝে"))),

    # ------------------------------------------------------------------ fees
    q("pays_fee", "56", FEES, "single", "Do you have to pay for the van service?",
      "ভ্যান গাড়িতে বর্জ্য/ময়লা-আর্বজনা দিলে তার জন্য কি টাকা দিতে হয়?",
      options=YES_NO + opts(("dont_know", "Do not know", "জানা নাই"))),
    q("monthly_fee", "57", FEES, "number", "How much per month?", "মাসিক কত টাকা দিতে হয়?",
      min_value=0, max_value=100000, maps_to="monthly_fee", shown_if=("pays_fee", ["yes"])),
    q("fee_opinion", "58", FEES, "single", "What do you think of the current monthly fee?",
      "বর্তমান মাসিক ফি (টাকা)-এর পরিমাণ আপনার কেমন মনে হয়?",
      options=opts(
          ("fair", "It is about right", "ঠিক আছে"),
          ("too_high", "It seems high", "বেশি মনে হয়"),
          ("too_low", "It seems low", "কম মনে হয়"),
          ("other", "Other", "অন্যান্য"),
      )),
    q("fee_opinion_other", "", FEES, "text", "Any other opinion",
      "অন্যান্য মতামত থাকলে লিখুন", shown_if=("fee_opinion", ["other"]), width="wide"),
    q("fee_collected_by", "59", FEES, "single", "Who collects the monthly fee?",
      "মাসিক ফি-এর টাকা কে সংগ্রহ করে",
      options=opts(
          ("van_driver", "The van driver themselves", "ভ্যান ড্রাইভার নিজে"),
          ("designated", "A designated person", "নির্ধারিত লোক"),
          ("undesignated", "An undesignated person", "অনির্ধারিত লোক"),
          ("other", "Other", "অন্যান্য"),
      )),
    q("fee_collected_by_other", "", FEES, "text", "State who else collects it",
      "অন্যান্য কে সংগ্রহ করে তা লিখুন", shown_if=("fee_collected_by", ["other"])),
    q("gives_receipt", "60", FEES, "single", "Is a receipt given when the money is taken?",
      "টাকা সংগ্রহ সময় কি কোন রসিদ দেয়", options=YES_NO_DK),
    q("payment_preference", "61", FEES, "single", "How would you prefer to pay?",
      "আপনি কি পদ্ধতিতে টাকা পরিশোধ করতে চান?",
      options=opts(
          ("cash", "Cash (offline)", "নগদ (অফলাইন)"),
          ("digital", "Online / digital", "অনলাইন /ডিজিটাল"),
          ("both", "Both (offline and online)", "উভয় (অফলাইন ও অনলাইন)"),
      )),
    q("digital_channels", "", FEES, "multi",
      "Which channel would you prefer for online / digital payment?",
      "অনলাইন /ডিজিটাল পেমেন্ট-এর জন্য কোন মাধ্যম পছন্দ করবেন?",
      shown_if=("payment_preference", ["digital", "both"]),
      options=opts(
          ("bkash", "bKash", "বিকাশ"),
          ("nagad", "Nagad", "নগদ"),
          ("rocket", "Rocket", "রকেট"),
          ("upay", "Upay", "ইউপে"),
          ("bank", "Bank transfer", "ব্যাংক ট্রান্সফার"),
          ("other", "Other", "অন্যান্য"),
      )),
    q("digital_channel_other", "", FEES, "text", "State the other channel",
      "অন্যান্য মাধ্যম উল্লেখ করুন", shown_if=("digital_channels", ["other"])),
    q("pays_regularly", "", FEES, "single", "Do you pay the fee regularly?",
      "আপনি কি নিয়মিত ফি/টাকা পরিশোধ করেন", options=YES_NO),
    q("non_payment_reasons", "", FEES, "multi", "If not, why not?",
      "নিয়মিত ফি/টাকা না দিলে তার কারণ কী", shown_if=("pays_regularly", ["no"]),
      options=opts(
          ("too_high", "The fee is too high", "ফি বেশি"),
          ("cannot_afford", "Cannot afford it", "সামর্থ্য নাই"),
          ("nobody_collects", "Nobody collects it or comes", "কেউ সংগ্রহ করে না বা আসে না"),
          ("poor_service", "The service is not good", "সেবার মান ভাল না"),
          ("other", "Other", "অন্যান্য"),
      )),
    q("non_payment_other", "", FEES, "text", "State the other reason",
      "অন্যান্য কারণ উল্লেখ করুন", shown_if=("non_payment_reasons", ["other"])),
    q("willing_fee", "", FEES, "number",
      "How much would you be willing to pay monthly for a good / improved service?",
      "ভালো/ উন্নত সেবার জন্য মাসিক কত টাকা দিতে আগ্রহী",
      min_value=0, max_value=100000, maps_to="willing_fee"),
    q("recommendation", "", FEES, "text", "Your recommendation for improving the service",
      "সেবার মান উন্নয়নে আপনার সুপারিশ", width="full"),

    # ----------------------------------------------------------- observation
    q("observation", "", OBSERVATION, "multi", "Observation", "পর্যবেক্ষণ",
      hint="Ticked by the surveyor from what they can see",
      hint_bn="জরিপকারী দেখে টিক দিবেন",
      options=opts(
          ("bin_outside", "There is a designated bin in front of the premises",
           "বাসা-বাড়ি/দোকান প্রতিষ্ঠানের সামনে নির্ধারিত বিন আছে"),
          ("litter_outside", "Scattered waste is visible in front of the premises",
           "বাসা-বাড়ি/দোকান প্রতিষ্ঠানের সামনে সামনে ছড়ানো ছিটানো বর্জ্য দেখা যাচ্ছে"),
          ("covered_bin_below", "There is a covered pot below the multi-storey building",
           "বহুতল ভবনের/বাসার নিচে ঢাকনা যুক্ত পাত্র আছে"),
          ("uncovered_bin_below", "There is an uncovered pot below the building",
           "বহতল ভবনের/বাসার নিচে ঢাকনাবিহীন পাত্র আছে"),
          ("open_bin_inside", "There is an open pot for waste inside",
           "বাসা-বাড়ি/দোকান প্রতিষ্ঠানের ভিতরে ময়লা রাখার খোলা পাত্র আছে"),
          ("covered_bin_inside", "There is a covered pot for waste inside",
           "বাসা-বাড়ি/দোকান প্রতিষ্ঠানের ভিতরে ময়লা রাখার ঢাকনাযুক্ত পাত্র আছে"),
          ("polybag_inside", "Waste is kept in a polythene bag inside",
           "বাসা-বাড়ি/দোকান প্রতিষ্ঠানের ভিতরে পলিথিন ব্যাগে ময়লা রাখা আছে"),
          ("sellable_separated", "Sellable waste is stored separately",
           "বিক্রয়যোগ্য ময়লা পৃথকভাবে সংরক্ষণ করা হয়"),
          ("other", "Other", "অন্যান্য"),
      )),
    q("observation_other", "", OBSERVATION, "text", "State any other observation",
      "অন্যান্য কোন পর্যবেক্ষণ থাকলে উল্লেখ করুন", shown_if=("observation", ["other"]), width="wide"),
]
