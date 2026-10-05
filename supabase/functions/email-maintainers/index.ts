// Sends the emails that tell the maintainers of AGENTS.md for Empirical Legal Scholars about new suggestions and
// comments on Suggest Edits. The database writes them (supabase/robot.sql); this Supabase Edge Function sends them
// through an email account's SMTP server.
//
// The database calls this function with a one-time key. With the key, the function collects the emails waiting in
// the database, sends them, and tells the database what came of each. It takes no message, address, or server from
// whoever calls it, so it can't be used to send anything else, and without the database's key it does nothing.
//
// Set it up once, in the Supabase dashboard (supabase/README.md, step 9):
//   1. Edge Functions, then Secrets: add SMTP_USER, the account's address (such as the Gmail address that sends the
//      sign-in codes), and SMTP_PASSWORD, an app password for it. For an account that isn't Gmail, add SMTP_HOST too,
//      and SMTP_PORT if it isn't 465. The port must use TLS from the start: Supabase doesn't allow ports 25 and 587.
//   2. Edge Functions, then Deploy a new function, then Via Editor: name it email-maintainers, replace the code with
//      this file, and deploy it.
//   3. In the function's settings, turn off JWT verification: the database calls it without anyone's sign-in, and
//      the function checks each call itself, as above.
// The password is a secret of this function in Supabase, never in the repository.
//
// It uses no libraries: the few SMTP commands it needs are written out here, so nothing is downloaded when it's
// deployed, and nothing changes under it.

const VERSION = 1; // public.mail_status, in supabase/robot.sql, says which version the database expects

type Email = { id: number; to: string; subject: string; body: string };
type Result = { id: number; sent: true } | { id: number; error: string };

const setting = (name: string) => (Deno.env.get(name) ?? "").trim();
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ADDRESS = /^[^\s<>()@",;:\\[\]]+@[^\s<>()@",;:\\[\]]+\.[^\s<>()@",;:\\[\]]+$/;

Deno.serve(async (request) => {
  const answer = (fields: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify({ from: "email-maintainers", version: VERSION, ...fields }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  if (request.method !== "POST") return answer({ error: "POST only" }, 405);
  let key = "";
  try {
    key = String((await request.json())?.key ?? "");
  } catch {
    // not JSON: no key
  }
  if (!/^[0-9a-f]{64}$/.test(key)) return answer({ error: "no key" }, 401);
  const user = setting("SMTP_USER"), password = setting("SMTP_PASSWORD");
  if (!ADDRESS.test(user) || !password) {
    return answer({ error: "SMTP_USER and SMTP_PASSWORD aren't set: add them under Edge Functions, then Secrets" });
  }

  let collected;
  try {
    collected = await database("mail_claim", { key });
  } catch (error) {
    return answer({ error: `couldn't collect the emails: ${reason(error)}` });
  }
  if (collected?.error) return answer({ error: String(collected.error) }, 401);
  const emails: Email[] = Array.isArray(collected?.messages) ? collected.messages : [];
  if (!emails.length) return answer({ sent: 0, failed: 0 });

  const results = await sendAll(emails, user, password, String(collected.from_name ?? ""));
  let recorded = false;
  for (let attempt = 0; attempt < 3 && !recorded; attempt++) {
    try {
      await database("mail_done", { batch: collected.batch, results });
      recorded = true;
    } catch {
      await new Promise((wait) => setTimeout(wait, 1000));
    }
  }
  const sent = results.filter((r) => "sent" in r).length;
  const failure = results.find((r): r is { id: number; error: string } => "error" in r);
  const error = !recorded ? "sent, but couldn't tell the database, so it will send them again" : failure?.error;
  return answer({ sent, failed: results.length - sent, ...(error ? { error } : {}) });
});

// ---- The database ----

// The project's public key: the function calls the database's API as any visitor would, and the one-time key is what
// lets it collect the emails. Supabase gives each function its project's keys: the publishable ones as JSON
// ({"default": "sb_publishable_..."}), and, on older projects, the anon key.
function projectKey(): string {
  try {
    const keys = JSON.parse(setting("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    const key = keys?.default ?? Object.values(keys ?? {}).find((value) => typeof value === "string" && value);
    if (typeof key === "string" && key) return key;
  } catch {
    // not given
  }
  return setting("SUPABASE_ANON_KEY");
}

async function database(name: string, args: Record<string, unknown>) {
  const base = setting("SUPABASE_URL").replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+$/.test(base)) throw new Error("SUPABASE_URL isn't set");
  const key = projectKey();
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json", Accept: "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`; // a legacy key is a JWT, and goes in both
  const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`the database answered ${response.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

// ---- Sending ----

// One connection for all the emails collected. If one is refused, the rest still go; if the connection fails, those
// not sent yet are reported as not sent, and the database tries them again later.
async function sendAll(emails: Email[], user: string, password: string, fromName: string): Promise<Result[]> {
  const results = new Map<number, Result>();
  let smtp: Smtp | null = null;
  try {
    smtp = await Smtp.open(setting("SMTP_HOST") || "smtp.gmail.com", Number(setting("SMTP_PORT") || 465));
    await smtp.expect([220], "the mail server's greeting");
    await smtp.command(`EHLO ${helloName()}`, [250], "EHLO");
    await smtp.command(`AUTH PLAIN ${base64(`\u0000${user}\u0000${password}`)}`, [235], "signing in");
    for (const email of emails) {
      if (smtp.broken) break;
      try {
        if (!ADDRESS.test(email.to)) throw new Error("not an email address");
        await smtp.command(`MAIL FROM:<${user}>`, [250], "MAIL FROM");
        await smtp.command(`RCPT TO:<${email.to}>`, [250, 251], "RCPT TO");
        await smtp.command("DATA", [354], "DATA");
        await smtp.command(`${message(email, user, fromName)}\r\n.`, [250], "sending");
        results.set(email.id, { id: email.id, sent: true });
      } catch (error) {
        results.set(email.id, { id: email.id, error: reason(error) });
        if (!smtp.broken) await smtp.command("RSET", [250], "RSET").catch(() => {});
      }
    }
    if (!smtp.broken) await smtp.command("QUIT", [221], "QUIT").catch(() => {});
  } catch (error) {
    const why = reason(error);
    for (const email of emails) if (!results.has(email.id)) results.set(email.id, { id: email.id, error: why });
  } finally {
    smtp?.close();
  }
  return emails.map((email) => results.get(email.id) ?? { id: email.id, error: "not sent: the connection to the mail server failed" });
}

// The few SMTP commands needed, over a connection that uses TLS from the start (port 465).
class Smtp {
  broken = false;
  private buffer = "";

  private constructor(
    private conn: Deno.TlsConn,
    private reader: ReadableStreamDefaultReader<Uint8Array>,
    private writer: WritableStreamDefaultWriter<Uint8Array>,
  ) {}

  static async open(hostname: string, port: number): Promise<Smtp> {
    const conn = await within(Deno.connectTls({ hostname, port }), 20_000, `connecting to ${hostname}:${port}`);
    return new Smtp(conn, conn.readable.getReader(), conn.writable.getWriter());
  }

  private async line(): Promise<string> {
    for (;;) {
      const end = this.buffer.indexOf("\n");
      if (end >= 0) {
        const line = this.buffer.slice(0, end).replace(/\r$/, "");
        this.buffer = this.buffer.slice(end + 1);
        return line;
      }
      const { value, done } = await this.reader.read();
      if (done) throw new Error("the mail server closed the connection");
      this.buffer += decoder.decode(value, { stream: true });
      if (this.buffer.length > 65_536) throw new Error("the mail server's answer is too long");
    }
  }

  // The server's answer: one line, or several ("250-..." lines, then "250 ..."), which must have one of the codes.
  async expect(codes: number[], what: string): Promise<void> {
    const lines: string[] = [];
    try {
      for (;;) {
        lines.push(await within(this.line(), 30_000, what));
        if (!/^\d{3}-/.test(lines.at(-1)!)) break;
      }
    } catch (error) {
      this.broken = true;
      throw error;
    }
    const code = Number(lines.at(-1)!.slice(0, 3));
    if (!codes.includes(code)) throw new Error(`${what}: ${lines.join(" ").slice(0, 300)}`);
  }

  // A command (never repeated in an error, since one of them carries the password), and its answer.
  async command(text: string, codes: number[], what: string): Promise<void> {
    try {
      await within(this.writer.write(encoder.encode(`${text}\r\n`)), 30_000, what);
    } catch (error) {
      this.broken = true;
      throw error;
    }
    await this.expect(codes, what);
  }

  close() {
    try {
      this.conn.close();
    } catch {
      // closed already
    }
  }
}

// ---- The email ----

// Plain text, in UTF-8, encoded in base64 so no line is too long and none starts with a dot.
function message(email: Email, user: string, fromName: string): string {
  const name = oneLine(fromName);
  const headers = [
    `From: ${name ? `${displayName(name)} ` : ""}<${user}>`,
    `To: <${email.to}>`,
    `Subject: ${encodedWords(oneLine(email.subject) || "AGENTS.md")}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomUUID()}@${user.split("@")[1]}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "Auto-Submitted: auto-generated", // so out-of-office replies aren't sent back (RFC 3834)
  ];
  const body = base64(String(email.body ?? "").replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n")).match(/.{1,76}/g) ?? [];
  return [...headers, "", ...body].join("\r\n");
}

// A header's words on one line: no line breaks or other control characters, at most 200 characters.
function oneLine(text: string): string {
  // deno-lint-ignore no-control-regex
  return [...String(text ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim()]
    .slice(0, 200).join("");
}

function displayName(name: string): string {
  return /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/[\\"]/g, "\\$&")}"` : encodedWords(name);
}

// Words that aren't plain ASCII, as RFC 2047 encoded words of at most 75 characters each.
function encodedWords(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const words: string[] = [];
  let chunk = "";
  for (const character of text) {
    if (encoder.encode(chunk + character).length > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  if (chunk) words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${base64(word)}?=`).join("\r\n ");
}

function base64(text: string): string {
  const bytes = encoder.encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function helloName(): string {
  try {
    return new URL(setting("SUPABASE_URL")).hostname || "localhost";
  } catch {
    return "localhost";
  }
}

function reason(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

// A promise, or an error if it takes longer than `ms`. (If the time runs out first, the promise's own later failure is
// expected, so it isn't reported again.)
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  promise.catch(() => {});
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what}: no answer within ${ms / 1000} seconds`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
