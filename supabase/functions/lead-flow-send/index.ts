// The one place lead WhatsApp messages are sent from (19 Oct 2026).
// Callers: sync-justdial-leads and the lead webhooks (welcome),
// aisensy-whatsapp-status (the next message after a button tap),
// lead-touch-sequencer (din 2/5/10 follow-ups). Each AiSensy template is
// an API campaign of the same name; its switch in whatsapp_controls must
// be ON (all start OFF — migration 0090) before anything goes out.
//
// POST { leadIds: string[], template: "WELCOME" | "<CAMPAIGN_NAME>", allowDnd?: boolean }
// with header x-cron-secret. Inlined helpers, like every other function
// here: the MCP deploy path can't resolve _shared/ imports.

import { createClient } from "npm:@supabase/supabase-js@2";

type Category =
  | "SKIN" | "AUTOIMMUNE" | "CANCER" | "RENAL" | "GENETIC" | "AUTISM" | "NERVOUS" | "CHILDREN" | "WOMEN" | "MEN"
  | "RESPIRATORY" | "DIGESTIVE" | "HORMONAL" | "MENTAL" | "JOINT_BONE" | "CARDIAC" | "SEXUAL" | "HOMEOPATHY_DIRECT" | "GENERAL";

// Copy of DISEASE_KEYWORDS / classifyDiseaseCategory in src/lib/db.ts —
// keep the two in step.
const DISEASE_KEYWORDS: [Category, string[]][] = [
  ["AUTISM", ["autism", "add", "adhd", "speech delay", "developmental delay"]],
  ["CANCER", ["cancer", "tumou", "tumor", "oncolog", "chemo"]],
  ["RENAL", ["kidney", "renal", "creatinine", "dialysis", "nephro"]],
  ["GENETIC", ["genetic", "rare disease", "down syndrome", "muscular dystrophy"]],
  ["NERVOUS", ["nerve", "neuro", "paralysis", "migraine", "epilepsy", "seizure", "parkinson", "sciatica", "numbness", "headache"]],
  ["WOMEN", ["pcod", "pcos", "menstrual", "period", "infertility", "menopause", "uterus", "breast", "pregnan", "leucorrhea"]],
  ["MEN", ["prostate", "erectile", "male infertility", "sperm", "urolog"]],
  ["SEXUAL", ["sexual", "std", "hiv", "genital", "herpes"]],
  ["RESPIRATORY", ["asthma", "breathing", "cough", "sinus", "bronchitis", "allerg", "pulmo"]],
  ["DIGESTIVE", ["stomach", "acidity", "gas", "constipation", "ibs", "colitis", "piles", "digestion", "liver", "fissure"]],
  ["HORMONAL", ["thyroid", "hormone", "diabetes", "obesity", "weight"]],
  ["MENTAL", ["anxiety", "depression", "stress", "insomnia", "sleep", "ocd"]],
  ["JOINT_BONE", ["joint", "arthritis", "knee", "back pain", "spondylitis", "osteoporosis", "bone", "rheumat"]],
  ["CARDIAC", ["heart", "cardiac", "blood pressure", " bp", "cholesterol"]],
  ["AUTOIMMUNE", ["autoimmune", "lupus", "sjogren", "scleroderma"]],
  ["CHILDREN", ["child", "kids", "bedwetting", "bed wetting", "paediat", "pediatric"]],
  ["SKIN", ["skin", "psoriasis", "eczema", "vitiligo", "acne", "pimple", "rash", "dermat", "hair fall", "hair loss", "baldness", "alopecia", "wart", "fungal"]],
  ["HOMEOPATHY_DIRECT", ["homeopath", "homeo clinic", "homeo hospital", "homeo doctor"]],
];
function classify(diseaseInterest: string | null): Category {
  const text = (diseaseInterest ?? "").toLowerCase();
  if (!text.trim()) return "GENERAL";
  for (const [cat, words] of DISEASE_KEYWORDS) if (words.some((w) => text.includes(w))) return cat;
  return "GENERAL";
}

// Fills {{1}} in the follow-up templates. Copy of LEAD_WELCOME_CONTENT[cat].concern.
const CONCERN: Record<Category, string> = {
  NERVOUS: "sar dard ya chakkar", SKIN: "skin aur baalon ki takleef", CHILDREN: "bachche ki baar-baar ki beemari",
  DIGESTIVE: "pet aur paachan ki takleef", RESPIRATORY: "saans aur allergy ki takleef", HOMEOPATHY_DIRECT: "purani bimariyon",
  MEN: "peshaab ya prostate ki takleef", RENAL: "kidney ki takleef", JOINT_BONE: "jodon ke dard", CANCER: "is takleef",
  AUTISM: "bachche ke development", AUTOIMMUNE: "autoimmune bimari", SEXUAL: "is takleef", WOMEN: "periods ya PCOD ki takleef",
  HORMONAL: "thyroid ya hormone ki takleef", MENTAL: "neend aur tension ki takleef", CARDIAC: "BP ya heart ki takleef",
  GENETIC: "is bimari", GENERAL: "aapki takleef",
};

// How each template was submitted to AiSensy. settings.lead_flow_config
// .templates can override any entry (e.g. once a video-button version is
// approved) without a redeploy.
interface TemplateConfig {
  header?: "image" | "document";
  params?: "concern"[];
  urlButton?: "video" | "playlist";
}
// First version goes out without PDFs (Dr. Yadav, 20 Oct 2026); a PDF
// version can be switched on later via settings, no redeploy.
const DEFAULT_TEMPLATES: Record<string, TemplateConfig> = {
  LEAD_NUDGE_1: { params: ["concern"] },
  LEAD_NUDGE_2: { params: ["concern"] },
  LEAD_NUDGE_3: { params: ["concern"] },
};
const WELCOME_TEMPLATE: TemplateConfig = { header: "image" };

interface Assets {
  welcomeImageUrl?: string;
  defaultPdfUrl?: string;
  pdfByCategory?: Partial<Record<Category, string>>;
  videoIdByCategory?: Partial<Record<Category, string>>;
  playlistIdByCategory?: Partial<Record<Category, string>>;
}

const WELCOME_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function istTodayStartUtc(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return new Date(`${ist}T00:00:00+05:30`).toISOString();
}

function extractMessageId(data: any): string | null {
  return data?.messages?.[0]?.id ?? data?.messageId ?? data?.data?.messageId ?? data?.data?.messages?.[0]?.id ?? data?.id ?? null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const expected = Deno.env.get("CRON_FUNCTION_SECRET");
  if (!expected || !constantTimeEqual(req.headers.get("x-cron-secret") ?? "", expected)) {
    return json({ error: "Unauthorized" }, 401);
  }
  let input: { leadIds?: string[]; template?: string; allowDnd?: boolean };
  try { input = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const leadIds = (input.leadIds ?? []).filter(Boolean).slice(0, 500);
  const template = (input.template ?? "").trim();
  if (!leadIds.length || !template) return json({ error: "leadIds and template required" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const apiKey = Deno.env.get("AISENSY_API_KEY");

  const [{ data: controlsRow }, { data: configRow }, { data: leads, error: leadsErr }] = await Promise.all([
    db.from("settings").select("value").eq("key", "whatsapp_controls").maybeSingle(),
    db.from("settings").select("value").eq("key", "lead_flow_config").maybeSingle(),
    db.from("leads").select("id, name, mobile, disease_interest, dnd, status, created_at, wa_welcome_sent_at").in("id", leadIds),
  ]);
  if (leadsErr) return json({ error: leadsErr.message }, 500);

  let master = false;
  let modules: Record<string, { enabled: boolean; dailyCap: number | null }> = {};
  try {
    const c = JSON.parse(controlsRow?.value ?? "{}");
    master = c.masterEnabled === true;
    modules = c.modules ?? {};
  } catch { /* stays off */ }
  let templates: Record<string, TemplateConfig> = { ...DEFAULT_TEMPLATES };
  let assets: Assets = {};
  try {
    const c = JSON.parse(configRow?.value ?? "{}");
    templates = { ...templates, ...(c.templates ?? {}) };
    assets = c.assets ?? {};
  } catch { /* defaults */ }

  // A template with no switch at all was never registered/approved: treat
  // it as OFF (unlike the older campaigns, which default to ON).
  const sentToday = new Map<string, number>();
  async function gate(campaign: string): Promise<string | null> {
    if (!master) return "master_off";
    const mod = modules[campaign];
    if (!mod || !mod.enabled) return "module_off";
    if (mod.dailyCap == null) return null;
    if (!sentToday.has(campaign)) {
      const { count } = await db.from("whatsapp_log").select("id", { count: "exact", head: true })
        .eq("campaign_name", campaign).eq("status", "sent").gte("created_at", istTodayStartUtc());
      sentToday.set(campaign, count ?? 0);
    }
    return (sentToday.get(campaign) ?? 0) >= mod.dailyCap ? "cap_reached" : null;
  }

  const results: { leadId: string; campaign: string | null; status: string; reason?: string }[] = [];

  for (const lead of leads ?? []) {
    const cat = classify(lead.disease_interest);
    const isWelcome = template === "WELCOME";

    if (lead.dnd && !input.allowDnd) { results.push({ leadId: lead.id, campaign: null, status: "skipped", reason: "dnd" }); continue; }
    if (isWelcome) {
      if (lead.wa_welcome_sent_at) { results.push({ leadId: lead.id, campaign: null, status: "skipped", reason: "welcome_already_sent" }); continue; }
      if (Date.now() - new Date(lead.created_at).getTime() > WELCOME_MAX_AGE_MS) {
        results.push({ leadId: lead.id, campaign: null, status: "skipped", reason: "lead_too_old" });
        continue;
      }
    }

    let campaign = isWelcome ? `LEAD_WELCOME_${cat}` : template;
    let blocked = await gate(campaign);
    if (isWelcome && blocked === "module_off" && cat !== "GENERAL") {
      campaign = "LEAD_WELCOME_GENERAL";
      blocked = await gate(campaign);
    }
    if (blocked || !apiKey) {
      results.push({ leadId: lead.id, campaign, status: "gated", reason: blocked ?? "no_api_key" });
      continue;
    }

    const cfg = isWelcome ? WELCOME_TEMPLATE : (templates[campaign] ?? {});
    const body: Record<string, unknown> = {
      // AiSensy only accepts lowercase campaign names; switches and logs keep the uppercase key.
      apiKey, campaignName: campaign.toLowerCase(), destination: lead.mobile, userName: lead.name || "Patient", source: "YHC-OS",
      templateParams: (cfg.params ?? []).map((p) => (p === "concern" ? CONCERN[cat] : "")),
    };
    let missing: string | null = null;
    if (cfg.header === "image") {
      if (assets.welcomeImageUrl) body.media = { url: assets.welcomeImageUrl, filename: "yadav-homeo-clinic.jpg" };
      else missing = "welcome photo";
    } else if (cfg.header === "document") {
      const url = assets.pdfByCategory?.[cat] || assets.defaultPdfUrl;
      if (url) body.media = { url, filename: "Yadav-Homeo-Clinic-jaankari.pdf" };
      else missing = "PDF";
    }
    if (cfg.urlButton) {
      const suffix = cfg.urlButton === "video" ? assets.videoIdByCategory?.[cat] : assets.playlistIdByCategory?.[cat];
      if (suffix) body.buttons = [{ type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: suffix }] }];
      else missing = cfg.urlButton === "video" ? "video link" : "playlist link";
    }
    if (missing) {
      // Sending without the header/button the template was approved with
      // fails at Meta; better to log it here so Owner sees what's missing.
      await db.from("whatsapp_log").insert({ patient_id: null, campaign_name: campaign, destination: lead.mobile, status: "failed", error_message: `${missing} set nahi hai (Owner Control → Lead WhatsApp media)` });
      results.push({ leadId: lead.id, campaign, status: "failed", reason: `missing ${missing}` });
      continue;
    }

    let status: "sent" | "failed" = "failed";
    let data: any = null;
    let errorMessage: string | null = null;
    try {
      const res = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      data = await res.json().catch(() => ({}));
      if (res.ok) status = "sent";
      else errorMessage = data?.message ?? `AiSensy HTTP ${res.status}`;
    } catch (e) {
      errorMessage = String(e);
    }
    await db.from("whatsapp_log").insert({
      patient_id: null, campaign_name: campaign, destination: lead.mobile, status,
      error_message: errorMessage, message_id: status === "sent" ? extractMessageId(data) : null, provider_response: data,
    });
    await db.from("interactions").insert({
      lead_id: lead.id, type: "whatsapp",
      summary: status === "sent" ? `${campaign} bheja` : `${campaign} nahi gaya — ${errorMessage}`,
    });
    if (status === "sent") {
      sentToday.set(campaign, (sentToday.get(campaign) ?? 0) + 1);
      if (isWelcome) await db.from("leads").update({ wa_welcome_sent_at: new Date().toISOString() }).eq("id", lead.id);
    }
    results.push({ leadId: lead.id, campaign, status, reason: errorMessage ?? undefined });
  }

  return json({ success: true, results });
});
