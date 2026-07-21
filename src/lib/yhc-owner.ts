export const STAFF = [
  { name: "Priya Sharma", role: "RECP1", branch: "Bajaj Nagar", status: "Active", cap: "2" },
  { name: "Anjali Verma", role: "RECP2", branch: "Bajaj Nagar", status: "Active", cap: "1" },
  { name: "Dr. Amit", role: "CASE-DR", branch: "Both", status: "Active", cap: "N" },
  { name: "Dr. Priya", role: "CASE-DR", branch: "Both", status: "Active", cap: "N" },
  { name: "Dr. Yadav", role: "DOCTOR", branch: "Both", status: "Active", cap: "1" },
  { name: "Ramesh", role: "PHARMA", branch: "Jagatpura", status: "Active", cap: "1" },
  { name: "Sunita", role: "CALLING", branch: "Bajaj Nagar", status: "Active", cap: "1" },
  { name: "Vikram", role: "BACKEND", branch: "Both", status: "Leave", cap: "1" },
];

export const INCENTIVE_STAFF = [
  { name: "Priya Sharma", role: "RECP1", target: 50000, done: 42000 },
  { name: "Anjali Verma", role: "RECP2", target: 40000, done: 38500 },
  { name: "Sunita", role: "Telecaller", target: 35000, done: 29000 },
];

export const CONTROLS = [
  {
    section: "Clinic Operations",
    items: [
      { k: "Online booking", on: true },
      { k: "Walk-in registration", on: true },
      { k: "Courier delivery", on: true },
      { k: "Home visits", on: false },
    ],
  },
  {
    section: "Feature Modules",
    items: [
      { k: "Lead CRM", on: true },
      { k: "Follow-up CRM", on: true },
      { k: "WhatsApp automation", on: true },
      { k: "Marketing module", on: false },
    ],
  },
  {
    section: "Privacy & Access",
    items: [
      { k: "Hidden Identity Mode", on: true },
      { k: "Case-DR patient access", on: false },
      { k: "Backup doctor access", on: false },
    ],
  },
  {
    section: "Payment & Delivery",
    items: [
      { k: "Advance payment", on: false },
      { k: "COD delivery", on: true },
      { k: "Partial payment", on: true },
    ],
  },
];

export const HEALTH_CHECKS = [
  { check: "Database connection", status: "ok" as const },
  { check: "WhatsApp API", status: "ok" as const },
  { check: "Backup (last night)", status: "ok" as const },
  { check: "Payment gateway", status: "ok" as const },
  { check: "Low stock alerts", status: "warn" as const },
  { check: "Pending follow-ups", status: "warn" as const },
];

export const REPORT_ROWS: [string, string][] = [
  ["Total Revenue", "₹2,10,400"],
  ["Total Patients", "142"],
  ["New Patients", "38"],
  ["Avg per Patient", "₹1,482"],
  ["Cash Collection", "₹94,000"],
  ["UPI Collection", "₹88,400"],
  ["Card Collection", "₹28,000"],
  ["Outstanding", "₹18,600"],
  ["Deliveries", "56"],
  ["Leads Converted", "22"],
];

export const WEEK_REVENUE: [string, number][] = [
  ["Mon", 6200],
  ["Tue", 7800],
  ["Wed", 5400],
  ["Thu", 8900],
  ["Fri", 7100],
  ["Sat", 9600],
];

export const ROLE_COLOR: Record<string, string> = {
  RECP1: "bg-accent text-accent-foreground",
  RECP2: "bg-accent text-accent-foreground",
  "CASE-DR": "bg-primary text-primary-foreground",
  DOCTOR: "bg-success text-success-foreground",
  PHARMA: "bg-purple-500 text-white",
  CALLING: "bg-sky-600 text-white",
  BACKEND: "bg-slate-500 text-white",
  OWNER: "bg-destructive text-destructive-foreground",
};
