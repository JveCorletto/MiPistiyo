import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

function validSecret(header: string | null, expected: string) {
  const received = Buffer.from((header ?? "").replace(/^Bearer /, ""));
  const secret = Buffer.from(expected);
  return received.length === secret.length && timingSafeEqual(received, secret);
}

type MailJob = {
  id: string;
  user_id: string;
  title: string;
  message: string;
  due_on: string;
  href: string;
};

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !validSecret(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Falta configurar el servicio de base de datos" }, { status: 503 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const generated = await admin.rpc("run_due_notification_job");
  if (generated.error) {
    console.error("notification cron generation:", generated.error.message);
    return NextResponse.json({ error: "Error al generar avisos" }, { status: 500 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!apiKey || !from || !baseUrl) {
    return NextResponse.json({ generated: generated.data ?? 0, email: "no configurado" });
  }

  const claims = await admin.rpc("claim_notification_emails", { p_limit: 25 });
  if (claims.error) {
    console.error("notification cron claim:", claims.error.message);
    return NextResponse.json({ generated: generated.data ?? 0, error: "Error al preparar correos" }, { status: 500 });
  }

  let sent = 0;
  let failed = 0;
  for (const job of ((claims.data ?? []) as MailJob[])) {
    let success = false;
    try {
      const { data: userData, error: userError } = await admin.auth.admin.getUserById(job.user_id);
      if (userError || !userData.user?.email) throw new Error("Destinatario no disponible");
      const destination = new URL(job.href, baseUrl).toString();
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `mipistiyo-notification-${job.id}`,
        },
        body: JSON.stringify({
          from,
          to: [userData.user.email],
          subject: `MiPistiyo · ${job.title}`,
          text: `${job.title}\n\n${job.message}\nFecha: ${job.due_on}\n\nRevisar: ${destination}\n\nEste aviso no confirma ni ejecuta ningún pago.`,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`Resend respondió HTTP ${response.status}`);
      success = true;
      sent++;
    } catch (error) {
      failed++;
      console.error("notification mail failed:", job.id, error instanceof Error ? error.message : "error");
    } finally {
      const completed = await admin.rpc("complete_notification_email", {
        p_id: job.id, p_success: success,
      });
      if (completed.error) console.error("notification mail finalize:", job.id, completed.error.message);
    }
  }
  return NextResponse.json({ generated: generated.data ?? 0, emails_sent: sent, emails_failed: failed });
}
