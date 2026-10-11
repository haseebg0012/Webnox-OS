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
