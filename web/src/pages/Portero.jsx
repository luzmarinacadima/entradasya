import { useEffect, useRef, useState } from 'react';
import { api, fmtDate } from '../api.js';
import { useAuth } from '../auth.jsx';

// Pantalla del portero: escanear (cámara, si el navegador lo soporta) o escribir el código.
export default function Portero() {
  const { token } = useAuth();
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('');
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [total, setTotal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const inputRef = useRef(null);
  const canScan = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  useEffect(() => {
    api('/events/').then((d) => {
      setEvents(d.events);
      if (d.events[0]) setEventId(String(d.events[0].id));
    });
    return () => stopCamera();
  }, []);

  useEffect(() => {
    if (!eventId) return;
    api(`/checkin/stats/${eventId}`, { token }).then((d) => setTotal(d.total)).catch(() => setTotal(null));
  }, [eventId, token, result]);

  async function check(value) {
    const c = (value ?? code).trim();
    if (!c || !eventId) return;
    setBusy(true);
    try {
      const d = await api('/checkin/', { method: 'POST', token, body: { code: c, event_id: Number(eventId) } });
      setResult(d);
    } catch (err) {
      setResult(err.data && 'allowed' in err.data ? err.data : { allowed: false, reason: err.message });
    } finally {
      setBusy(false);
      setCode('');
      inputRef.current?.focus();
    }
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setScanning(true);
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      let last = '';
      const tick = async () => {
        if (!streamRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes[0] && codes[0].rawValue !== last) {
            last = codes[0].rawValue;
            await check(last);
            setTimeout(() => { last = ''; }, 3000);
          }
        } catch { /* cuadro sin QR */ }
        requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setResult({ allowed: false, reason: 'No se pudo abrir la cámara. Escribe el código.' });
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }

  return (
    <div className="portero">
      <h1>Control de ingreso</h1>
      <label>Evento en el que trabajas
        <select value={eventId} onChange={(e) => { stopCamera(); setEventId(e.target.value); setResult(null); }}>
          {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name} — {fmtDate(ev.event_date)}</option>)}
        </select>
      </label>
      {total !== null && <p className="muted">Personas que ingresaron: <b>{total}</b></p>}

      <form className="row" onSubmit={(e) => { e.preventDefault(); check(); }}>
        <input ref={inputRef} className="code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="EY-XXXX-XXXX" autoFocus />
        <button className="btn" disabled={busy || !eventId}>Validar</button>
      </form>

      {canScan && (
        <div>
          {!scanning
            ? <button className="btn secondary" onClick={startCamera}>📷 Escanear QR con la cámara</button>
            : <button className="btn secondary" onClick={stopCamera}>Detener cámara</button>}
          <video ref={videoRef} className={scanning ? 'scanner' : 'hidden'} muted playsInline />
        </div>
      )}

      {result && (
        <div className={`verdict ${result.allowed ? 'ok' : 'no'}`}>
          <div className="big">{result.allowed ? '✅ INGRESO PERMITIDO' : '⛔ INGRESO RECHAZADO'}</div>
          {!result.allowed && <div className="reason">{result.reason}</div>}
          {result.code && <div className="code">{result.code}</div>}
          {result.allowed && <div>{result.sector_name} · asiento {result.seat_number}</div>}
          {result.first_checkin_at && <div>Primer ingreso: {fmtDate(result.first_checkin_at)}{result.first_porter ? ` (portero: ${result.first_porter})` : ''}</div>}
          {result.ticket_event && <div>Esta entrada es para: {result.ticket_event}</div>}
        </div>
      )}
    </div>
  );
}
