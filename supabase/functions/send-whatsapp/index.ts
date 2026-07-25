// Sends ONE WhatsApp message via AiSensy. Called from the app whenever a
// single event happens (registration, appointment created, etc.)
//
// Requires AiSensy to have an approved WhatsApp template + API Campaign
// already set up (AiSensy Dashboard -> Campaigns -> Launch campaign ->
// API campaign). The "campaignName" you pass here must match that
// campaign's name exactly.
//
// Called with:
//   { campaignName, destination, userName, templateParams }

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }
  try {
    const { campaignName, destination, userName, templateParams, media } = await req.json();
    if (!campaignName || !destination) {
      return new Response(JSON.stringify({ error: "campaignName and destination required" }), { status: 400 });
    }

    const apiKey = Deno.env.get("AISENSY_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "AISENSY_API_KEY not configured as a secret" }), { status: 500 });
    }

    const res = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        campaignName,
        destination,
        userName: userName ?? "Patient",
        source: "YHC-OS",
        templateParams: templateParams ?? [],
        ...(media ? { media } : {}),
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return new Response(JSON.stringify({ error: data?.message ?? "AiSensy send failed" }), { status: 400 });
    }
    return new Response(JSON.stringify({ success: true, data }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
