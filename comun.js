/* =====================================================================
 * CONTROL DE LIMPIEZA — núcleo compartido (app del operador y panel)
 * ÚNICO archivo con configuración: edite solo el bloque de abajo.
 * ===================================================================== */

/* ====== CONFIGURACIÓN ====== */
const API_URL = 'https://script.google.com/macros/s/AKfycbwmg2BQFpPGVC-azHCi6hSJkhqEYZlU09E2RASHg8KxPufAkmT-tinpIt0bQf-ZO04K/exec';

/* ====== FIN DE CONFIGURACIÓN ====== */

const RELOJ = { off: 0 };                 // diferencia entre el reloj del celular y la hora oficial
const EC_MS = 5 * 3600e3;                 // Ecuador: UTC-5 fijo (sin horario de verano)

/* ---------- Utilidades ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function ls(k, v){
  try{
    if(v === undefined) return JSON.parse(localStorage.getItem(k) || 'null');
    if(v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
  }catch(e){ return null; }
}
function ahora(){ return Date.now() + RELOJ.off; }
function fh(ms, conFecha, conSeg){
  if(!ms) return '—';
  return new Date(ms).toLocaleString('es-EC', Object.assign({timeZone:'America/Guayaquil', hour:'2-digit', minute:'2-digit', hour12:false},
    conSeg ? {second:'2-digit'} : {}, conFecha ? {day:'2-digit', month:'2-digit', year: conFecha === 'corta' ? undefined : 'numeric'} : {}));
}
async function sha256(txt){
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
}
const ESTADOS = {
  PENDIENTE:['⏳ Pendiente','gray'], EN_PROCESO:['🧹 En limpieza','info'], ANALIZANDO:['🔎 Analizando','info'],
  POR_REVISAR:['🕒 Por evaluar','info'], OBSERVADO:['⚠️ Corregir','warn'], REHACER:['❌ Rehacer','bad'], REVISION_JEFE:['👁 Revisión jefe','info'],
  APROBADO:['✅ Aprobado','ok'], ANULADO:['❌ Anulado','bad']
};
const est = e => ESTADOS[e] || [e, 'gray'];

/* ---------- Hora oficial ----------
 * Se toma del encabezado Date del servidor de la página (no del reloj del celular),
 * y se corrige con cada respuesta del Apps Script. El servidor vuelve a validar la hora al recibir. */
async function sincronizarHora(){
  try{
    const t0 = Date.now();
    const r = await fetch(location.href.split('#')[0], {method:'HEAD', cache:'no-store'});
    const d = Date.parse(r.headers.get('Date'));
    if(d) RELOJ.off = d + 500 - Math.round((t0 + Date.now()) / 2);
  }catch(e){}
}

/* ---------- Apps Script (solo para escribir: fotos, IA, decisiones) ---------- */
function despertarServidor(){ fetch(API_URL + '?ping=' + Date.now(), {mode:'no-cors', cache:'no-store'}).catch(() => {}); }
async function api(body){
  let r;
  const t0 = Date.now();
  try{ r = await fetch(API_URL, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(body)}); }
  catch(e){ throw new Error('Sin conexión con el servidor. Revise el internet del celular e intente de nuevo.'); }
  const txt = await r.text();
  let j;
  try{ j = JSON.parse(txt); }
  catch(e){ throw new Error(/accounts\.google|ServiceLogin|Sign in|Iniciar sesi/i.test(txt)
    ? 'El servidor pide iniciar sesión en Google. El jefe debe poner el acceso de la app web en "Cualquier usuario".'
    : 'El servidor respondió con un error (' + r.status + '). Avise al jefe para revisar la implementación del Apps Script.'); }
  if(j.servidor) RELOJ.off = j.servidor - Math.round((t0 + Date.now()) / 2);
  if(!j.ok) throw new Error(j.error || 'Error del servidor');
  return j;
}

/* ---------- Datos (desde la hoja, vía Apps Script) ----------
 * Una consulta trae el maestro y los registros recientes. Se repite cada
 * `cadaSeg` segundos mientras la pantalla está visible, y al volver a ella. */
function suscribirDatos(opc){
  let timer = null, activo = true, enCurso = false;
  async function traer(){
    if(enCurso) return; enCurso = true;
    try{ const r = await api(Object.assign({accion:'datos'}, opc.clave ? {clave: opc.clave} : {})); opc.datos(r); }
    catch(e){ opc.error && opc.error(e); }
    finally{ enCurso = false; }
  }
  function programar(){ clearInterval(timer); timer = setInterval(() => { if(activo && !document.hidden) traer(); }, (opc.cadaSeg || 20) * 1000); }
  document.addEventListener('visibilitychange', () => { if(!document.hidden && activo) traer(); });
  traer(); programar();
  return { ahora: traer, detener(){ activo = false; clearInterval(timer); } };
}

/* ---------- Calendario de turnos (misma lógica que el servidor) ---------- */
function fechaDe(ms){ const d = new Date(ms - EC_MS); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }
function horaDe(ms){ return new Date(ms - EC_MS).getUTCHours(); }
function addDays(f, n){ return fechaDe(Date.parse(f + 'T12:00:00-05:00') + n * 864e5); }
function fmtCorta(f){ const p = String(f).split('-'); return p.length === 3 ? p[2] + '/' + p[1] : f; }
function turnoDe(ms){
  const h = horaDe(ms);
  if(h >= 8 && h < 20) return {fecha: fechaDe(ms), turno: 'DIA'};
  return {fecha: fechaDe(h < 8 ? ms - 864e5 : ms), turno: 'NOCHE'};
}
function turnoAnterior(t){ return t.turno === 'DIA' ? {fecha: addDays(t.fecha, -1), turno: 'NOCHE'} : {fecha: t.fecha, turno: 'DIA'}; }
function semanaDe(f){ const dow = new Date(Date.parse(f + 'T12:00:00-05:00')).getUTCDay(); return addDays(f, dow === 0 ? -6 : 1 - dow); }
function hhmm(s){ const p = String(s).trim().split(':'); return String(Number(p[0])).padStart(2, '0') + ':' + String(Number(p[1] || 0)).padStart(2, '0'); }
function ventana(t, cfg){
  const v = (t.turno === 'DIA' ? cfg.ventanaDia : cfg.ventanaNoche) || (t.turno === 'DIA' ? '08:00-20:00' : '20:00-08:00');
  const p = v.split('-');
  return {a: hhmm(p[0]), b: hhmm(p[1]), txt: hhmm(p[0]) + ' a ' + hhmm(p[1])};
}
function horaEnTurno(t, hm){
  const f = (t.turno === 'NOCHE' && Number(hm.split(':')[0]) < 20) ? addDays(t.fecha, 1) : t.fecha;
  return Date.parse(f + 'T' + hhmm(hm) + ':00-05:00');
}
function enVentana(ms, t, cfg){ const v = ventana(t, cfg); return ms >= horaEnTurno(t, v.a) && ms <= horaEnTurno(t, v.b); }
function limiteTurno(t, cfg){ return horaEnTurno(t, ventana(t, cfg).b); }
function programados(t, prog){
  if(!prog || !prog.desde) return [];
  const idx = Math.round((Date.parse(t.fecha + 'T12:00:00-05:00') - Date.parse(prog.desde + 'T12:00:00-05:00')) / 864e5);
  if(idx < 0 || idx > 6) return [];
  const l = t.turno === 'DIA' ? 'D' : 'N';
  return prog.filas.filter(f => f.dias[idx] === l).map(f => f.id);
}
function nombresProg(t, M){ return programados(t, M.programacion).map(id => (M.operadores.find(o => o.id === id) || {nombre: id}).nombre); }

/* ---------- Estado de zonas (misma lógica que el servidor) ---------- */
const PRIORIDAD = {APROBADO:6, POR_REVISAR:5, OBSERVADO:4, REHACER:4, REVISION_JEFE:4, ANALIZANDO:4, EN_PROCESO:3, ANULADO:1};
function mejorReg(rs){
  let b = null;
  rs.forEach(r => { const p = PRIORIDAD[r.estado] || 0, pb = b ? (PRIORIDAD[b.estado] || 0) : -1;
    if(p > pb || (p === pb && (r.horaAntes || 0) > (b.horaAntes || 0))) b = r; });
  return b;
}
function resumirZonas(zonas, regsDe){
  const out = zonas.map(z => { const b = mejorReg(regsDe(z));
    return {id: z.id, nombre: z.nombre, estado: b ? b.estado : 'PENDIENTE', reg: b, ejecutada: !!(b && b.horaDespues && ['POR_REVISAR','APROBADO','OBSERVADO'].includes(b.estado))}; });
  const ap = out.filter(z => z.estado === 'APROBADO').length, ej = out.filter(z => z.ejecutada).length;
  return {zonas: out, aprobadas: ap, ejecutadas: ej, porRevisar: out.filter(z => z.estado === 'POR_REVISAR').length,
    total: out.length, pct: out.length ? Math.round(ej * 100 / out.length) : 0};
}
function estadoTurno(t, M, regs){
  const zonas = M.zonas.filter(z => z.activa && z.frecuencia !== 'SEMANAL');
  const del = regs.filter(r => r.fecha === t.fecha && r.turno === t.turno);
  return Object.assign({fecha: t.fecha, turno: t.turno}, resumirZonas(zonas, z => del.filter(r => r.zonaId === z.id)));
}
function estadoSemana(sem, tAct, M, regs){
  const zonas = M.zonas.filter(z => z.activa && z.frecuencia === 'SEMANAL');
  const del = regs.filter(r => r.semana === sem);
  return Object.assign({semana: sem}, resumirZonas(zonas, z => del.filter(r => r.zonaId === z.id)));
}
