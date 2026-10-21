// くらしの献立帖：写真（勤務表・カレンダーのスクリーンショット）から勤務と予定を読み取る
// - ログイン中のユーザーだけが呼べる（Supabase Auth で本人確認）
// - 1人1日 DAILY_LIMIT 回まで（public.bump_ai_usage）
// - 画像は Claude API に送るだけで保存しない。結果は確認画面に返し、登録はアプリ側で行う
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = "claude-sonnet-5-5";
const DAILY_LIMIT = 30;
const MAX_BASE64 = 8_000_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SCHEMA = {
  type: "object",
  properties: {
    source_kind: { type: "string", enum: ["roster", "calendar", "other"] },
    person_found: { type: "boolean" },
    month: { type: "string" },
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string", format: "date" },
          kind: { type: "string", enum: ["shift", "plan"] },
          type: { type: "string", enum: ["day", "evening", "night", "off", "other", "out", "shopping", "chores", "custom"] },
          label: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          sure: { type: "boolean" },
        },
        required: ["date", "kind", "type", "label", "start", "end", "sure"],
        additionalProperties: false,
      },
    },
    note: { type: "string" },
  },
  required: ["source_kind", "person_found", "month", "entries", "note"],
  additionalProperties: false,
};

const SYSTEM = `あなたは、日本の職場の勤務表やカレンダーアプリの画面写真から、ひとりの人の勤務と予定を正確に書き起こす係です。
写真に書かれていないことは決して作らないでください。読めない・自信がない箇所は sure を false にしてください。`;

function buildPrompt(month: string, name: string): string {
  return `この画像から、勤務と予定を書き起こしてください。

## 画像の種類を判定する（source_kind）
- roster：職場の勤務表（行が人の名前、列が日付で、セルに「日」「準」「深」「休」などの記号が入る表）
- calendar：カレンダーアプリやシフトアプリの画面
- other：どちらでもない

## だれの予定を読むか
- 勤務表（roster）の場合は「${name || "（名前の指定なし）"}」の行だけを読みます。名字だけ・名前だけ・空白の違いは同じ人とみなしてください。
  - 指定の名前の行が見つかったら person_found を true にします。
  - 名前の指定がない、または見つからない場合：表に1人分しかなければその人を読んで person_found を true に。複数人いて決められないときは entries を空にし、person_found を false にして、note に表にある名前を最大10人まで「、」区切りで書いてください。
- カレンダー（calendar）の場合は画面に出ている予定をすべて読み、person_found を true にします。

## 日付（date）
- 画像の見出しにある年月を優先し、なければ ${month || "今月"} とみなします。
- 勤務表が月をまたぐ（例：21日〜翌月20日）ときは、日ごとに正しい年月にしてください。
- 形式は YYYY-MM-DD。month には主な年月を YYYY-MM で入れます。

## 勤務（kind = "shift"）の type
- day：日勤（日、D、日勤 など）
- evening：準夜勤（準、E、準夜、夕 など）
- night：深夜勤・夜勤（深、N、深夜、夜、夜勤 など）
- off：休み（休、公、公休、有、有休、年休、代休、特休、希望休、×、ー など）
- other：上記以外の勤務（早番、遅番、明け、研修、会議、出張、半日 など）
- label には写真の表記をそのまま入れます（例：「日」「公」「明」）。
- 空欄のセルは書き出しません。

## 予定（kind = "plan"）の type（カレンダー画面で、勤務ではない予定）
- out：外出、shopping：買い物、chores：家事、custom：それ以外（label に予定のタイトル）

## 時刻（start / end）
- 画像に時刻が書かれていれば HH:MM（24時間制）で入れます。勤務表の凡例に記号ごとの時間があれば使って構いません。なければ空文字にします。

## note
- 読み取りで気をつけてほしい点があれば、日本語で1〜2文。なければ空文字。`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "not_configured" }, 503);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const image = typeof body.image === "string" ? body.image : "";
  const mediaType = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(String(body.media_type)) ? String(body.media_type) : "image/jpeg";
  if (!image || image.length > MAX_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 200))) return json({ error: "bad_image" }, 400);
  const month = /^\d{4}-\d{2}$/.test(String(body.month ?? "")) ? String(body.month) : "";
  const name = String(body.name ?? "").replace(/[\r\n]/g, " ").slice(0, 40).trim();

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: allowed, error: limitErr } = await admin.rpc("bump_ai_usage", { p_user: user.id, p_limit: DAILY_LIMIT });
  if (limitErr) { console.error("usage limit check failed", limitErr.message); return json({ error: "server_error" }, 500); }
  if (!allowed) return json({ error: "limit" }, 429);

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: buildPrompt(month, name) },
          ],
        }],
      }),
    });
  } catch (e) {
    console.error("anthropic fetch failed", String(e));
    return json({ error: "busy" }, 502);
  }

  const out = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = String(out?.error?.message ?? "");
    console.error("anthropic error", res.status, msg);
    const code = /credit balance/i.test(msg) ? "no_credit"
      : res.status === 401 || res.status === 403 ? "bad_key"
      : res.status === 429 || res.status === 529 || res.status >= 500 ? "busy"
      : "ai_error";
    return json({ error: code }, 502);
  }
  if (out?.stop_reason === "refusal") return json({ error: "refused" }, 422);
  if (out?.stop_reason === "max_tokens") return json({ error: "too_long" }, 422);
  const text = (out?.content ?? []).find((b: { type: string }) => b.type === "text")?.text;
  let result: unknown;
  try { result = JSON.parse(text); } catch { return json({ error: "parse" }, 502); }
  return json({ result });
});
