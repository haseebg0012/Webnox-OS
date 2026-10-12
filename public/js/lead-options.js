export const STAGES = [
  "new",
  "contacted",
  "qualified",
  "meeting",
  "proposal",
  "negotiation",
  "won",
  "lost",
];
export const CURRENCIES = [
  ...new Set([
    "PKR",
    "USD",
    "GBP",
    "EUR",
    "AED",
    "SAR",
    "CAD",
    "AUD",
    "INR",
    ...(Intl.supportedValuesOf?.("currency") || []),
  ]),
];
export const SERVICES = [
  "Web development",
  "Ecommerce store",
  "Business growth",
  "SEO",
  "Paid advertising",
  "Branding",
  "Social media",
  "Other",
];
export const SOURCES = [
  "Website",
  "Referral",
  "LinkedIn",
  "Facebook",
  "Instagram",
  "Cold call",
  "Email",
  "Other",
];

// ISO 3166-1 region codes, displayed in English consistently across forms.
const REGION_CODES =
  "AF AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW".split(
    " ",
  );
const regions = new Intl.DisplayNames(["en"], { type: "region" });
export const COUNTRIES = REGION_CODES.map((code) => regions.of(code)).sort(
  (a, b) => a.localeCompare(b),
);
export const INDUSTRIES = [
  "Accounting & bookkeeping",
  "Advertising & marketing",
  "Agriculture",
  "Architecture",
  "Arts & crafts",
  "Automotive",
  "Baby & maternity",
  "Banking",
  "Beauty & cosmetics",
  "Biotechnology",
  "Business consulting",
  "Charities & nonprofits",
  "Cleaning services",
  "Construction",
  "Consumer electronics",
  "Cybersecurity",
  "Data & analytics",
  "Dental care",
  "Digital products",
  "Ecommerce",
  "Education & tutoring",
  "Energy & utilities",
  "Engineering",
  "Entertainment",
  "Environmental services",
  "Events & weddings",
  "Fashion & apparel",
  "Financial services",
  "Fitness & gyms",
  "Food & beverages",
  "Freelancing",
  "Furniture & home decor",
  "Gaming & esports",
  "Government & public services",
  "Graphic design",
  "Grocery & supermarkets",
  "Healthcare",
  "Home improvement",
  "Hospitality & hotels",
  "Human resources & recruitment",
  "Import & export",
  "Industrial equipment",
  "Information technology",
  "Insurance",
  "Interior design",
  "Jewelry & accessories",
  "Landscaping",
  "Legal services",
  "Logistics & shipping",
  "Manufacturing",
  "Media & publishing",
  "Medical devices",
  "Mobile apps",
  "Music",
  "Online marketplaces",
  "Packaging & printing",
  "Personal branding",
  "Pet care & supplies",
  "Pharmaceuticals",
  "Photography & videography",
  "Plumbing & electrical",
  "Professional services",
  "Real estate",
  "Renewable energy",
  "Restaurants & cafes",
  "Retail",
  "SaaS & software",
  "Security services",
  "Social media & creators",
  "Sports & outdoors",
  "Telecommunications",
  "Textiles",
  "Toys & games",
  "Transportation",
  "Travel & tourism",
  "Veterinary services",
  "Web development",
  "Wellness & nutrition",
  "Wholesale",
  "Other",
];
export function existingOptions(options, value) {
  return value && !options.includes(value) ? [value, ...options] : options;
}
export function validateContactForm(form) {
  const email = form.elements.email,
    phone = form.elements.phone;
  const validate = () => {
    email?.setCustomValidity(
      email.value &&
        !/^[^\s@]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(
          email.value.trim(),
        )
        ? "Enter a valid email address, such as name@example.com."
        : "",
    );
    phone?.setCustomValidity(
      phone.value && !/^\+[1-9][0-9]{7,14}$/.test(phone.value.trim())
        ? "Include + and the country code, followed by digits only (for example +923001234567)."
        : "",
    );
  };
  [email, phone]
    .filter(Boolean)
    .forEach((input) => input.addEventListener("input", validate));
  validate();
}
