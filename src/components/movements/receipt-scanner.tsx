"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, FileImage, LoaderCircle, ScanText, ShieldCheck, TriangleAlert } from "lucide-react";
import { parseReceiptText, type ReceiptDraft } from "@/lib/ocr/parse-receipt";
import type { FinanceOcrMode } from "@/lib/ocr/scan-handoff";

export type ScanDestination = "MOVEMENT" | FinanceOcrMode;
const kindLabels: Record<ReceiptDraft["documentType"], string> = {
  RECEIPT: "Ticket o factura",
  CARD_PURCHASE_ALERT: "Alerta bancaria de compra con tarjeta",
  TRANSFER: "Transferencia bancaria",
  CARD_PAYMENT: "Pago a tarjeta",
  LOAN_PAYMENT: "Pago a préstamo",
  PAYMENT: "Comprobante de pago",
  UNKNOWN: "Documento por clasificar",
};
function suggestedDestination(draft: ReceiptDraft): ScanDestination {
  if (draft.documentType === "TRANSFER") return "EXTERNAL";
  if (draft.documentType === "CARD_PAYMENT") return "CARD";
  if (draft.documentType === "LOAN_PAYMENT") return "LOAN";
  return "MOVEMENT";
}

type Props = {
  onUse: (receipt: ReceiptDraft, destination: ScanDestination) => void;
  onManual: () => void;
};

const MAX_BYTES = 10 * 1024 * 1024;
const imageMimeTypes = ["image/jpeg", "image/png", "image/webp"];

export function ReceiptScanner({ onUse, onManual }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ReceiptDraft | null>(null);
  const [destination, setDestination] = useState<ScanDestination>("MOVEMENT");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const [confirmedDuplicate, setConfirmedDuplicate] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<Array<{ id: string; kind: string; date: string; amount: number }>>([]);
  const [duplicateCheckError, setDuplicateCheckError] = useState("");
  const unmounted = useRef(false);

  useEffect(() => {
    unmounted.current = false;
    return () => { unmounted.current = true; };
  }, []);

  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pick(selected: File | undefined) {
    if (!selected) return;
    setError("");
    setResult(null);
    setConfidence(null);
    setConfirmedDuplicate(false);
    setDuplicateMatches([]);
    setDuplicateCheckError("");
    if (!imageMimeTypes.includes(selected.type)) {
      setFile(null);
      setError("Usá una imagen JPG, PNG o WEBP. No se admiten PDF ni HEIC en esta versión.");
      return;
    }
    if (selected.size > MAX_BYTES) {
      setFile(null);
      setError("El archivo supera 10 MB. Reducí su tamaño e intentá de nuevo.");
      return;
    }
    setFile(selected);
  }

  async function recognize() {
    if (!file || busy) return;
    setError("");
    setBusy(true);
    setProgress(0);
    setStatus("Preparando el motor OCR...");
    setConfirmedDuplicate(false);
    setDuplicateMatches([]);
    setDuplicateCheckError("");
    let worker: Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>> | undefined;
    try {
      // Importación diferida: el motor OCR no carga en el dashboard inicial.
      const { createWorker } = await import("tesseract.js");
      worker = await createWorker(["spa", "eng"], 1, {
        logger: (message) => {
          if (unmounted.current) return;
          if (typeof message.status === "string") setStatus(message.status);
          if (typeof message.progress === "number") setProgress(Math.round(message.progress * 100));
        },
      });
      const { data } = await worker.recognize(file);
      if (unmounted.current) return;
      if (!data.text.trim()) {
        setError("No se pudo leer texto. Probá con una foto enfocada y bien iluminada.");
        return;
      }
      const parsed = parseReceiptText(data.text);
      setResult(parsed);
      setDestination(suggestedDestination(parsed));
      setConfidence(data.confidence);
    } catch (reason) {
      if (!unmounted.current) {
        console.error("Error OCR", reason);
        setError("No se pudo completar la lectura. Revisá tu conexión para la primera descarga del idioma, o ingresá el gasto manualmente.");
      }
    } finally {
      if (worker) await worker.terminate().catch(() => undefined);
      if (!unmounted.current) { setBusy(false); setStatus(""); }
    }
  }

  async function reviewBeforeContinue() {
    if (!result || checkingDuplicate) return;
    if (!result.reference || confirmedDuplicate) {
      onUse(result, destination);
      return;
    }
    setCheckingDuplicate(true);
    setDuplicateCheckError("");
    try {
      const response = await fetch("/api/ocr/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ reference: result.reference }),
      });
      if (!response.ok) throw new Error("No fue posible consultar el historial.");
      const data = await response.json() as {
        matches: Array<{ id: string; kind: string; date: string; amount: number }>;
      };
      if (data.matches.length) {
        setDuplicateMatches(data.matches);
        setConfirmedDuplicate(true);
        return;
      }
      onUse(result, destination);
    } catch {
      setDuplicateCheckError("No pudimos verificar si la referencia ya existe. Revisá el historial antes de continuar.");
      setConfirmedDuplicate(true); // El usuario debe confirmar explícitamente el siguiente paso.
    } finally {
      setCheckingDuplicate(false);
    }
  }

  return (
    <section className="space-y-4" aria-label="Lectura OCR de documentos financieros">
      <p className="text-sm text-slate-400">
        Tomá una foto o seleccioná una imagen del comprobante. Los datos detectados se podrán editar antes de guardar.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-3 text-sm font-medium text-emerald-300 hover:bg-emerald-500/15">
          <Camera size={17} /> Tomar foto
          <input type="file" accept="image/*" capture="environment" className="sr-only"
            disabled={busy} onChange={(event) => { pick(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
        </label>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-3 text-sm text-slate-200 hover:bg-slate-800">
          <FileImage size={17} /> Elegir imagen
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
            disabled={busy} onChange={(event) => { pick(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
        </label>
      </div>

      {preview && <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-950 p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview} alt="Vista previa del comprobante seleccionado" className="mx-auto max-h-52 w-auto max-w-full rounded-lg object-contain" />
        <p className="mt-2 truncate text-center text-xs text-slate-400">{file?.name}</p>
      </div>}

      {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      {busy && <div role="status" aria-live="polite" className="rounded-lg bg-slate-950 p-3 text-sm text-slate-300">
        <div className="mb-2 flex items-center gap-2"><LoaderCircle size={16} className="animate-spin" /> Leyendo comprobante... {progress}%</div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full bg-emerald-400 transition-all" style={{ width: `${progress}%` }}/></div>
        <p className="mt-2 text-xs text-slate-500">{status}</p>
      </div>}

      {result && <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300"><ScanText size={17}/> Datos sugeridos por OCR</div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="col-span-2"><dt className="text-xs text-slate-400">Documento detectado</dt><dd>{kindLabels[result.documentType]}</dd></div>
          <div className="col-span-2"><dt className="text-xs text-slate-400">Emisor / comercio</dt><dd className="break-words">{result.merchant || "No detectado"}</dd></div>
          <div><dt className="text-xs text-slate-400">Importe</dt><dd>{result.total ? `$${result.total}` : "Revisar manualmente"}</dd></div>
          <div><dt className="text-xs text-slate-400">Fecha</dt><dd>{result.date || "No detectada"}</dd></div>
          {result.time && <div><dt className="text-xs text-slate-400">Hora de la compra</dt><dd>{result.time}</dd></div>}
          {result.cardLastFour && <div><dt className="text-xs text-slate-400">Tarjeta (últimos 4)</dt><dd>•••• {result.cardLastFour}</dd></div>}
          {result.reference && <div className="col-span-2"><dt className="text-xs text-slate-400">Referencia (verificar)</dt><dd>{result.reference}</dd></div>}
          {result.counterparty && <div className="col-span-2"><dt className="text-xs text-slate-400">Posible remitente (verificar)</dt><dd className="break-words">{result.counterparty}</dd></div>}
        </dl>
        <label className="block space-y-2">
          <span className="text-xs font-semibold text-slate-200">¿Cómo querés registrar este documento?</span>
          <select
            value={destination}
            onChange={(event) => setDestination(event.target.value as ScanDestination)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500"
          >
            <option value="MOVEMENT">Gasto o ingreso (incluye modo histórico)</option>
            <option value="INTERNAL">Transferencia entre mis cuentas</option>
            <option value="EXTERNAL">Transferencia con terceros</option>
            <option value="CARD">Pago de tarjeta de crédito</option>
            <option value="LOAN">Pago de préstamo</option>
          </select>
        </label>
        {result.documentType === "CARD_PURCHASE_ALERT" && destination === "MOVEMENT" && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          Detectamos una compra con tarjeta. Se abrirá un gasto, con la fecha y hora del mensaje; verificá la tarjeta y elegí si ya estaba incluida en el saldo inicial.
        </p>}
        {destination === "EXTERNAL" && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Confirmá si recibiste o enviaste dinero y si realmente fue un ingreso o gasto. Una transferencia recibida no siempre representa ingreso.
        </p>}
        {destination === "LOAN" && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          El monto leído es el pago total, no necesariamente capital. En el formulario tendrás que separar capital, intereses y comisiones.
        </p>}
        {destination === "MOVEMENT" && result.documentType !== "RECEIPT" && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Revisá que este documento realmente corresponda a un ingreso o gasto. Pagos de deudas y transferencias propias tienen formularios separados.
        </p>}
        {(confidence !== null && confidence < 65 || result.warnings.length > 0) && <div className="space-y-1 text-xs text-amber-200">
          <p className="flex items-center gap-1 font-medium"><TriangleAlert size={14}/> Verificá los datos detectados.</p>
          {result.warnings.map((warning, i) => <p key={`${i}-${warning}`}>{warning}</p>)}
        </div>}
        <details className="text-xs text-slate-400"><summary className="cursor-pointer">Ver texto reconocido</summary>
          <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-2">{result.rawText}</pre>
        </details>
        {(duplicateMatches.length > 0 || duplicateCheckError) && <div role="alert"
          className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          <p className="font-semibold"><TriangleAlert size={16} className="mr-1 inline"/>
            {duplicateMatches.length ? "Esta referencia ya aparece en tu historial" : "Verificación de duplicados pendiente"}
          </p>
          {duplicateMatches.map(match => <p key={match.id} className="text-xs">
            {match.kind} · {match.date} · ${match.amount.toFixed(2)}
          </p>)}
          {duplicateCheckError && <p className="text-xs">{duplicateCheckError}</p>}
          <p className="text-xs">Comprobá si es el mismo pago. No se anulará ni registrará automáticamente.</p>
          <a href="/dashboard/movimientos" target="_blank" rel="noopener noreferrer"
            className="inline-block text-xs font-semibold underline underline-offset-2">Consultar historial</a>
        </div>}
        <button type="button" onClick={reviewBeforeContinue} disabled={checkingDuplicate}
          className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50">
          {checkingDuplicate ? "Verificando referencia..." : confirmedDuplicate ? "Continuar de todos modos y revisar" : "Continuar al formulario y revisar"}
        </button>
      </div>}

      <div className="flex items-center justify-between gap-3 border-t border-slate-800 pt-4">
        <button type="button" onClick={onManual} disabled={busy} className="text-sm text-slate-300 underline-offset-4 hover:underline disabled:opacity-50">Continuar manualmente</button>
        <button type="button" onClick={recognize} disabled={!file || busy} className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-semibold hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40">
          <ScanText size={17} /> {result ? "Leer nuevamente" : "Analizar comprobante"}
        </button>
      </div>
      <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500">
        <ShieldCheck size={15} className="mt-0.5 shrink-0" />
        La foto se procesa en tu navegador y no se guarda en Supabase. La primera lectura requiere descargar el motor y los idiomas OCR.
      </p>
    </section>
  );
}
