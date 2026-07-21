export type RxItem = { med: string; potency: string; form: string; qty: number; freq: string };
export type PharmaPatient = {
  token: string;
  name: string;
  branch: "Bajaj Nagar" | "Jagatpura";
  rx: RxItem[];
  status: "Pending" | "Preparing";
};

export const PHARMA_QUEUE: PharmaPatient[] = [
  {
    token: "T-01",
    name: "Ramesh Sharma",
    branch: "Bajaj Nagar",
    rx: [
      { med: "Rhus Tox", potency: "200C", form: "Globules", qty: 2, freq: "BD" },
      { med: "SLX", potency: "—", form: "Globules", qty: 1, freq: "TDS" },
    ],
    status: "Pending",
  },
  {
    token: "T-03",
    name: "Aarav Gupta",
    branch: "Jagatpura",
    rx: [
      { med: "Sulphur", potency: "30C", form: "Globules", qty: 1, freq: "OD" },
      { med: "SLX", potency: "—", form: "Globules", qty: 2, freq: "BD" },
    ],
    status: "Pending",
  },
  {
    token: "T-06",
    name: "Neha Jain",
    branch: "Bajaj Nagar",
    rx: [{ med: "Ignatia", potency: "30C", form: "Globules", qty: 1, freq: "BD" }],
    status: "Preparing",
  },
];

export const INVENTORY = [
  { med: "Sulphur", potency: "30C", stock: 45, unit: "drams", low: 20 },
  { med: "Sulphur", potency: "200C", stock: 12, unit: "drams", low: 20 },
  { med: "Nux Vomica", potency: "200C", stock: 38, unit: "drams", low: 20 },
  { med: "Rhus Tox", potency: "200C", stock: 8, unit: "drams", low: 20 },
  { med: "Pulsatilla", potency: "30C", stock: 52, unit: "drams", low: 20 },
  { med: "Ignatia", potency: "30C", stock: 15, unit: "drams", low: 20 },
  { med: "SLX (Sac Lac)", potency: "—", stock: 340, unit: "grams", low: 100 },
  { med: "Arsenicum", potency: "200C", stock: 6, unit: "drams", low: 20 },
];

export const MASTER = [
  { med: "Sulphur", potencies: "6C, 30C, 200C, 1M", type: "Deep-acting antipsoric" },
  { med: "Nux Vomica", potencies: "30C, 200C, 1M", type: "Digestive, irritable" },
  { med: "Pulsatilla", potencies: "30C, 200C", type: "Mild, changeable moods" },
  { med: "Rhus Tox", potencies: "30C, 200C, 1M", type: "Joints, restless" },
  { med: "Ignatia", potencies: "30C, 200C", type: "Grief, emotional" },
  { med: "Arsenicum", potencies: "30C, 200C, 1M", type: "Anxiety, restlessness" },
  { med: "Lycopodium", potencies: "200C, 1M", type: "Digestive, liver" },
  { med: "Calcarea Carb", potencies: "200C, 1M", type: "Constitutional" },
];

export function getPharmaPatient(token: string) {
  return PHARMA_QUEUE.find((p) => p.token === token);
}
