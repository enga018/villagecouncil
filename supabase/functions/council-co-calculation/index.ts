import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set(["https://villagecouncil.enga.in", "https://villagecouncil-git-feat-fto-co-calculation-enga018s-projects.vercel.app", "https://enga018.github.io"]);
function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://villagecouncil.enga.in",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function reply(body: Record<string, unknown>, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
function isExempt(transactionDate: string | null, intervals: Array<{ id: string; started_at: string; ended_at: string | null }>) {
  if (!transactionDate) return null;
  return intervals.find(interval => {
    const start = interval.started_at.slice(0, 10);
    const end = interval.ended_at ? interval.ended_at.slice(0, 10) : null;
    return transactionDate >= start && (!end || transactionDate < end);
  }) || null;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: cors(origin) });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return reply({ error: "Origin not allowed." }, 403, origin);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return reply({ error: "Authentication required." }, 401, origin);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")
    ? JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}").default
    : Deno.env.get("SUPABASE_ANON_KEY");
  const secretKey = Deno.env.get("SUPABASE_SECRET_KEYS")
    ? JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default
    : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !publishableKey || !secretKey) return reply({ error: "Server configuration is incomplete." }, 500, origin);

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return reply({ error: "Invalid or expired session." }, 401, origin);

  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const actorId = userData.user.id;
  const { data: membership, error: membershipError } = await admin.from("council_memberships")
    .select("village_council_id").eq("user_id", actorId).eq("is_active", true).maybeSingle();
  if (membershipError) return reply({ error: "Could not verify the active Council assignment." }, 500, origin);
  if (!membership) return reply({ error: "No active Village Council assignment was found." }, 403, origin);
  const tenantId = membership.village_council_id;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ error: "A valid JSON request body is required." }, 400, origin); }
  const action = String(body.action || "");

  try {
    if (action === "exemptions") {
      const [{ data: intervals, error: intervalsError }, { data: jobCards, error: jobCardsError }] = await Promise.all([
        admin.from("council_co_exemption_intervals")
          .select("id,job_card_number,started_at,ended_at,add_reason,remove_reason,added_by,removed_by,created_at,updated_at")
          .eq("village_council_id", tenantId).order("started_at", { ascending: false }),
        admin.from("council_job_cards")
          .select("job_card_number,head_of_household,status")
          .eq("village_council_id", tenantId).order("job_card_number"),
      ]);
      if (intervalsError) throw intervalsError;
      if (jobCardsError) throw jobCardsError;
      const cardMap = new Map((jobCards || []).map(card => [card.job_card_number, card]));
      const actorIds = [...new Set((intervals || []).flatMap(interval => [interval.added_by, interval.removed_by]).filter((id): id is string => Boolean(id)))];
      const actorEntries = await Promise.all(actorIds.map(async id => {
        const { data } = await admin.auth.admin.getUserById(id);
        const user = data?.user;
        const label = String(user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || id);
        return [id, label] as const;
      }));
      return reply({
        intervals: (intervals || []).map(interval => ({
          ...interval,
          head_of_household: cardMap.get(interval.job_card_number)?.head_of_household || null,
          job_card_status: cardMap.get(interval.job_card_number)?.status || null,
        })),
        job_cards: jobCards || [],
        actor_labels: Object.fromEntries(actorEntries),
      }, 200, origin);
    }

    if (action === "add_exemption") {
      const jobCardNumber = String(body.jobCardNumber || "").trim();
      const startDate = String(body.startDate || "").trim();
      const reason = String(body.reason || "").trim();
      if (!jobCardNumber || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || reason.length < 3 || reason.length > 1000) {
        return reply({ error: "Select a Job Card, provide a valid start date, and enter a reason of 3–1000 characters." }, 400, origin);
      }
      const { data: jobCard, error: jobCardError } = await admin.from("council_job_cards")
        .select("job_card_number").eq("village_council_id", tenantId)
        .eq("job_card_number", jobCardNumber).maybeSingle();
      if (jobCardError) throw jobCardError;
      if (!jobCard) return reply({ error: "The selected Job Card does not belong to this Village Council." }, 404, origin);
      const { data: existing, error: existingError } = await admin.from("council_co_exemption_intervals")
        .select("id").eq("village_council_id", tenantId).eq("job_card_number", jobCardNumber)
        .is("ended_at", null).maybeSingle();
      if (existingError) throw existingError;
      if (existing) return reply({ error: "This Job Card already has an active exemption." }, 409, origin);
      const { data: previousIntervals, error: previousError } = await admin.from("council_co_exemption_intervals")
        .select("ended_at").eq("village_council_id", tenantId).eq("job_card_number", jobCardNumber)
        .not("ended_at", "is", null).order("ended_at", { ascending: false }).limit(1);
      if (previousError) throw previousError;
      const previousEndDate = previousIntervals?.[0]?.ended_at?.slice(0, 10);
      if (previousEndDate && startDate < previousEndDate) {
        return reply({ error: `The new exemption cannot start before the previous interval ended on ${previousEndDate}.` }, 409, origin);
      }
      const { data: interval, error } = await admin.from("council_co_exemption_intervals").insert({
        village_council_id: tenantId, job_card_number: jobCardNumber,
        started_at: `${startDate}T00:00:00.000Z`, add_reason: reason, added_by: actorId,
      }).select("id,job_card_number,started_at,ended_at,add_reason,remove_reason,added_by,removed_by,created_at,updated_at").single();
      if (error) throw error;
      return reply({ interval }, 201, origin);
    }

    if (action === "remove_exemption") {
      const intervalId = String(body.intervalId || "").trim();
      const reason = String(body.reason || "").trim();
      if (!intervalId || reason.length < 3 || reason.length > 1000) {
        return reply({ error: "A valid exemption and a removal reason of 3–1000 characters are required." }, 400, origin);
      }
      const removalDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const { data: interval, error } = await admin.from("council_co_exemption_intervals").update({
        ended_at: `${removalDate}T23:59:59.999Z`, remove_reason: reason, removed_by: actorId, updated_at: new Date().toISOString(),
      }).eq("id", intervalId).eq("village_council_id", tenantId).is("ended_at", null)
        .select("id,job_card_number,started_at,ended_at,add_reason,remove_reason,added_by,removed_by,created_at,updated_at").maybeSingle();
      if (error) throw error;
      if (!interval) return reply({ error: "The active exemption was not found or has already been removed." }, 404, origin);
      return reply({ interval }, 200, origin);
    }

    if (action === "settings") {
      const { error: seedError } = await admin.from("council_co_settings")
        .upsert({ village_council_id: tenantId }, { onConflict: "village_council_id", ignoreDuplicates: true });
      if (seedError) throw seedError;
      const { data, error } = await admin.from("council_co_settings")
        .select("divisor,multiplier,updated_at,updated_by")
        .eq("village_council_id", tenantId).single();
      if (error) throw error;
      const { data: history, error: historyError } = await admin.from("council_co_settings_history")
        .select("previous_divisor,previous_multiplier,new_divisor,new_multiplier,reason,changed_at,changed_by")
        .eq("village_council_id", tenantId).order("changed_at", { ascending: false }).limit(10);
      if (historyError) throw historyError;
      return reply({ settings: data, history: history || [] }, 200, origin);
    }

    if (action === "save_settings") {
      const divisor = Number(body.divisor), multiplier = Number(body.multiplier);
      const reason = String(body.reason || "").trim();
      if (!Number.isSafeInteger(divisor) || divisor <= 0 || !Number.isSafeInteger(multiplier) || multiplier <= 0)
        return reply({ error: "Divisor and multiplier must be positive whole numbers." }, 400, origin);
      if (reason.length < 3) return reply({ error: "Please provide a reason for changing the formula." }, 400, origin);
      const { data, error } = await admin.rpc("save_council_co_settings", {
        p_actor_id: actorId, p_divisor: divisor, p_multiplier: multiplier, p_reason: reason,
      });
      if (error) throw error;
      return reply({ result: data }, 200, origin);
    }

    if (action === "tags") {
      const { data, error } = await admin.from("council_co_tags")
        .select("id,name,is_archived,created_at,updated_at")
        .eq("village_council_id", tenantId).order("created_at", { ascending: false });
      if (error) throw error;
      return reply({ tags: data || [] }, 200, origin);
    }

    if (action === "create_tag") {
      const name = String(body.name || "").trim();
      if (!name || name.length > 60) return reply({ error: "Tag name must be between 1 and 60 characters." }, 400, origin);
      const { data: tag, error } = await admin.rpc("create_council_co_tag", {
        p_actor_id: actorId, p_name: name,
      });
      if (error) throw error;
      return reply({ tag }, 201, origin);
    }

    if (action === "rename_tag") {
      const tagId = String(body.tagId || ""), name = String(body.name || "").trim();
      if (!tagId || !name || name.length > 60) return reply({ error: "A valid tag and name are required." }, 400, origin);
      const { data: tag, error } = await admin.rpc("rename_council_co_tag", {
        p_actor_id: actorId, p_tag_id: tagId, p_name: name,
      });
      if (error) throw error;
      return reply({ tag }, 200, origin);
    }

    if (action === "preview" || action === "details") {
      const ftoId = String(body.ftoId || "");
      if (!ftoId) return reply({ error: "FTO ID is required." }, 400, origin);
      const { data: fto, error: ftoError } = await admin.from("council_ftos")
        .select("id,fto_number,fto_date,current_co_tag_id,co_calculation_version,latest_co_calculation_id")
        .eq("id", ftoId).eq("village_council_id", tenantId).eq("status", "active").single();
      if (ftoError) throw ftoError;
      const [{ data: transactions, error: txError }, { data: tags, error: tagsError },
        { data: intervals, error: intervalsError }, { data: marks, error: marksError }, { data: lastTagEvent, error: lastTagError }] = await Promise.all([
        admin.from("council_fto_transactions")
          .select("id,job_card_number,reference_number,transaction_date,applicant_name,primary_account_holder,amount_to_be_credited,credit_amount,government_status,normalized_status,rejection_reason,first_imported_at,updated_at")
          .eq("village_council_id", tenantId).eq("fto_id", ftoId).order("transaction_date", { ascending: true }),
        admin.from("council_co_tags").select("id,name,is_archived,created_at")
          .eq("village_council_id", tenantId).order("created_at", { ascending: false }),
        admin.from("council_co_exemption_intervals").select("id,job_card_number,started_at,ended_at,updated_at")
          .eq("village_council_id", tenantId),
        admin.from("council_co_exempt_transactions").select("fto_transaction_id,exemption_interval_id,marked_at")
          .eq("village_council_id", tenantId),
        admin.from("council_co_tag_events").select("tag_id")
          .eq("village_council_id", tenantId).in("action", ["assigned", "reassigned"])
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (txError) throw txError;
      if (tagsError) throw tagsError;
      if (intervalsError) throw intervalsError;
      if (marksError) throw marksError;
      if (lastTagError) throw lastTagError;

      let latestCalculation = null, latestItems: unknown[] = [];
      if (fto.latest_co_calculation_id) {
        const { data: calculation, error: calcError } = await admin.from("council_fto_co_calculations")
          .select("id,version,tag_id,tag_name_snapshot,divisor,multiplier,transaction_count,total_credit_amount,total_co_amount,exempt_count,chargeable_count,created_at,created_by")
          .eq("id", fto.latest_co_calculation_id).eq("village_council_id", tenantId).single();
        if (calcError) throw calcError;
        latestCalculation = calculation;
        const { data: items, error: itemsError } = await admin.from("council_fto_co_calculation_items")
          .select("fto_transaction_id,job_card_number,applicant_name,credit_amount,co_amount,is_exempt,first_imported_at,transaction_date")
          .eq("calculation_id", fto.latest_co_calculation_id).eq("village_council_id", tenantId);
        if (itemsError) throw itemsError;
        latestItems = items || [];
      }

      const parameters = {
        divisor: Number(latestCalculation?.divisor ?? 300),
        multiplier: Number(latestCalculation?.multiplier ?? 100),
      };

      const invalidCredit = (transactions || []).find(tx => tx.credit_amount == null || !Number.isFinite(Number(tx.credit_amount)) || Number(tx.credit_amount) < 0);
      if (invalidCredit) return reply({ error: `Transaction ${invalidCredit.reference_number} has an invalid Credit Amount and cannot be calculated.` }, 409, origin);

      const intervalsByCard = new Map<string, typeof intervals>();
      for (const interval of intervals || []) {
        const current = intervalsByCard.get(interval.job_card_number) || [];
        current.push(interval);
        intervalsByCard.set(interval.job_card_number, current);
      }
      const rows = (transactions || []).map(tx => {
        const interval = isExempt(tx.transaction_date, intervalsByCard.get(tx.job_card_number) || []);
        const exemptionIntervalId = interval?.id || null;
        const exempt = Boolean(interval);
        const creditAmount = Number(tx.credit_amount);
        const coAmount = roundMoney((creditAmount / parameters.divisor) * parameters.multiplier);
        return {
          id: tx.id, job_card_number: tx.job_card_number, reference_number: tx.reference_number,
          transaction_date: tx.transaction_date,
          applicant_name: tx.applicant_name || tx.primary_account_holder,
          amount_to_be_credited: tx.amount_to_be_credited, credit_amount: tx.credit_amount,
          government_status: tx.government_status, normalized_status: tx.normalized_status,
          rejection_reason: tx.rejection_reason, first_imported_at: tx.first_imported_at,
          co_amount: coAmount, is_exempt: exempt, exemption_interval_id: exemptionIntervalId,
        };
      });
      const count = rows.length;
      const latestUpdatedAt = (transactions || []).reduce((latest, tx) =>
        !latest || Date.parse(tx.updated_at) > Date.parse(latest) ? tx.updated_at : latest, null as string | null);
      const transactionIds = new Set((transactions || []).map(tx => tx.id));
      const jobCardNumbers = new Set((transactions || []).map(tx => tx.job_card_number));
      const relevantIntervals = (intervals || []).filter(interval => jobCardNumbers.has(interval.job_card_number));
      const relevantMarks = (marks || []).filter(mark => transactionIds.has(mark.fto_transaction_id));
      const latestExemptionUpdatedAt = relevantIntervals.reduce((latest, interval) =>
        !latest || Date.parse(interval.updated_at) > Date.parse(latest) ? interval.updated_at : latest, null as string | null);
      const latestExemptMarkedAt = relevantMarks.reduce((latest, mark) =>
        !latest || Date.parse(mark.marked_at) > Date.parse(latest) ? mark.marked_at : latest, null as string | null);
      const totalCredit = roundMoney(rows.reduce((sum, tx) => sum + Number(tx.credit_amount), 0));
      const totalCo = roundMoney(rows.reduce((sum, tx) => sum + tx.co_amount, 0));
      const exemptCount = rows.filter(tx => tx.is_exempt).length;
      return reply({
        fto, parameters, tags: tags || [], rows,
        suggested_tag_id: (fto.current_co_tag_id || lastTagEvent?.tag_id || (tags || []).find(tag => !tag.is_archived)?.id || null),
        summary: { transaction_count: count, total_credit_amount: totalCredit, total_co_amount: totalCo,
          exempt_count: exemptCount, chargeable_count: count - exemptCount },
        snapshot: {
          transaction_count: count,
          latest_transaction_updated_at: latestUpdatedAt,
          exemption_interval_count: relevantIntervals.length,
          latest_exemption_updated_at: latestExemptionUpdatedAt,
          exempt_mark_count: relevantMarks.length,
          latest_exempt_marked_at: latestExemptMarkedAt,
        },
        latest_calculation: latestCalculation, latest_items: latestItems,
      }, 200, origin);
    }

    if (action === "apply") {
      const ftoId = String(body.ftoId || ""), tagId = String(body.tagId || "");
      const divisor = Number(body.divisor), multiplier = Number(body.multiplier);
      const transactionCount = Number(body.transactionCount);
      const latestTransactionUpdatedAt = body.latestTransactionUpdatedAt ? String(body.latestTransactionUpdatedAt) : null;
      const exemptionIntervalCount = Number(body.exemptionIntervalCount);
      const latestExemptionUpdatedAt = body.latestExemptionUpdatedAt ? String(body.latestExemptionUpdatedAt) : null;
      const exemptMarkCount = Number(body.exemptMarkCount);
      const latestExemptMarkedAt = body.latestExemptMarkedAt ? String(body.latestExemptMarkedAt) : null;
      const idempotencyKey = String(body.idempotencyKey || "");
      if (!ftoId || !tagId || !Number.isSafeInteger(divisor) || divisor <= 0
        || !Number.isSafeInteger(multiplier) || multiplier <= 0 || !Number.isInteger(transactionCount)
        || !Number.isInteger(exemptionIntervalCount) || !Number.isInteger(exemptMarkCount) || !idempotencyKey)
        return reply({ error: "The preview is incomplete. Generate a fresh preview and try again." }, 400, origin);
      const { data, error } = await admin.rpc("apply_council_fto_co_calculation", {
        p_actor_id: actorId, p_fto_id: ftoId, p_tag_id: tagId,
        p_divisor: divisor, p_multiplier: multiplier,
        p_expected_transaction_count: transactionCount,
        p_expected_latest_transaction_updated_at: latestTransactionUpdatedAt,
        p_expected_exemption_interval_count: exemptionIntervalCount,
        p_expected_latest_exemption_updated_at: latestExemptionUpdatedAt,
        p_expected_exempt_mark_count: exemptMarkCount,
        p_expected_latest_exempt_marked_at: latestExemptMarkedAt,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;
      return reply({ result: data }, 200, origin);
    }

    if (action === "assign_tag") {
      const ftoId = String(body.ftoId || ""), tagId = String(body.tagId || "");
      const { data: result, error } = await admin.rpc("set_council_fto_tag", {
        p_actor_id: actorId, p_fto_id: ftoId, p_tag_id: tagId,
      });
      if (error) throw error;
      return reply({ success: true, result }, 200, origin);
    }

    return reply({ error: "Unsupported CO calculation action." }, 400, origin);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "CO calculation request failed." }, 400, origin);
  }
});