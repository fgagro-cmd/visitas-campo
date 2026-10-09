/* Visitas de campo: pestañas "Visitas" y "Ajustes" de la app FG Agro.
 * Guarda todo en el móvil y lo envía a la hoja de Google cuando hay cobertura. */
(function () {
  'use strict';

  var K = {
    fincas: 'v-fincas', visitas: 'v-visitas', ajustes: 'v-ajustes', plagas: 'v-plagas',
    fenologias: 'v-fenologias', cultivos: 'v-cultivos', borrador: 'v-borrador', tab: 'v-tab'
  };
  var CULTIVOS_DEFECTO = ['Limonero', 'Naranjo', 'Pomelo', 'Mandarino', 'Almendro', 'Albaricoquero',
    'Melocotonero', 'Nectarino', 'Paraguayo', 'Olivo', 'Otro'];
  var NIVELES = ['', 'leve', 'media', 'alta'];
  var MAX_FOTOS = 8;

  // ------------------------------------------------------------ utilidades

  function $(id) { return document.getElementById(id); }
  function leer(k, def) {
    try { var v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch (e) { return def; }
  }
  function guardar(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { console.error('No se pudo guardar ' + k, e); return false; }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function hoyTexto() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function aUTC(t) { var p = t.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function diffDias(a, b) { return Math.round((aUTC(a) - aUTC(b)) / 86400000); }
  function sumarDias(t, n) {
    var d = new Date(aUTC(t) + n * 86400000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function formatoFecha(t) { if (!t) return ''; var p = t.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  }
  function igual(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }
  function unicos(lista) {
    var vistos = {}, out = [];
    lista.forEach(function (x) { var k = x.toLowerCase(); if (!vistos[k]) { vistos[k] = true; out.push(x); } });
    return out;
  }

  // ------------------------------------------------------------ estado

  var fincas = leer(K.fincas, []);       // [{nombre, cliente, cultivos[], ultimaVisita}]
  var visitas = leer(K.visitas, []);     // copia local de cada fila enviada o pendiente
  var ajustes = leer(K.ajustes, { url: '', clave: '', diasPorMes: null });
  var plagas = leer(K.plagas, []);       // [{nombre, usos:{cultivo:n}}]
  var fenologias = leer(K.fenologias, []); // [{nombre, usos}]
  var cultivos = leer(K.cultivos, CULTIVOS_DEFECTO.slice());
  var form = null;                       // visita que se está rellenando
  var pendientes = 0;
  var detalleEstado = '';
  var flash = '';
  var sincronizando = false;

  function salvar() {
    guardar(K.fincas, fincas); guardar(K.visitas, visitas); guardar(K.ajustes, ajustes);
    guardar(K.plagas, plagas); guardar(K.fenologias, fenologias); guardar(K.cultivos, cultivos);
  }

  function buscarFinca(nombre) {
    for (var i = 0; i < fincas.length; i++) if (igual(fincas[i].nombre, nombre)) return fincas[i];
    return null;
  }
  function buscarPlaga(nombre) {
    for (var i = 0; i < plagas.length; i++) if (igual(plagas[i].nombre, nombre)) return plagas[i];
    return null;
  }
  function buscarFen(nombre) {
    for (var i = 0; i < fenologias.length; i++) if (igual(fenologias[i].nombre, nombre)) return fenologias[i];
    return null;
  }
  function limpiarNombre(n) { return String(n || '').replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function nombresDePlagas(texto) {
    return String(texto || '').split(',').map(function (x) { return x.replace(/\([^)]*\)/g, '').trim(); })
      .filter(Boolean);
  }
  function altaPlaga(nombre) {
    nombre = limpiarNombre(nombre);
    if (!nombre) return null;
    var p = buscarPlaga(nombre);
    if (!p) { p = { nombre: nombre, usos: {} }; plagas.push(p); }
    return p;
  }
  function altaFen(nombre) {
    nombre = limpiarNombre(nombre);
    if (!nombre) return null;
    var f = buscarFen(nombre);
    if (!f) { f = { nombre: nombre, usos: 0 }; fenologias.push(f); }
    return f;
  }

  // ------------------------------------------------------------ frecuencia de visita

  function diasPorMes() {
    var d = ajustes.diasPorMes;
    if (d && Object.keys(d).length) return d;
    var o = {};
    for (var m = 1; m <= 12; m++) o[m] = (m >= 3 && m <= 10) ? 15 : 30;
    return o;
  }
  function frecuenciaActual() {
    var n = Number(diasPorMes()[new Date().getMonth() + 1]);
    return n > 0 ? n : 15;
  }
  function estadoFinca(f) {
    var frec = frecuenciaActual();
    if (!f.ultimaVisita) return { dias: null, toca: true, texto: 'Sin visitas', frec: frec };
    var d = diffDias(hoyTexto(), f.ultimaVisita);
    return { dias: d, toca: d > frec, texto: 'hace ' + d + (d === 1 ? ' día' : ' días'), frec: frec };
  }

  // ------------------------------------------------------------ cola de envío (IndexedDB)

  var dbPromesa = null;
  function abrirDB() {
    if (dbPromesa) return dbPromesa;
    dbPromesa = new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error('Este navegador no puede guardar visitas sin conexión')); return; }
      var r = window.indexedDB.open('visitas-fg', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('cola', { keyPath: 'qid' }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return dbPromesa;
  }
  function colaOp(modo, fn) {
    return abrirDB().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction('cola', modo);
        var req = fn(t.objectStore('cola'));
        t.oncomplete = function () { res(req ? req.result : undefined); };
        t.onerror = function () { rej(t.error); };
        t.onabort = function () { rej(t.error || new Error('operación cancelada')); };
      });
    });
  }
  function colaAdd(item) { return colaOp('readwrite', function (st) { return st.put(item); }); }
  function colaTodos() { return colaOp('readonly', function (st) { return st.getAll(); }); }
  function colaDel(qid) { return colaOp('readwrite', function (st) { return st.delete(qid); }); }

  // ------------------------------------------------------------ comunicación con la hoja

  function configurado() { return !!(ajustes.url && ajustes.clave); }

  function llamar(cuerpo) {
    var datos = {};
    Object.keys(cuerpo).forEach(function (k) { datos[k] = cuerpo[k]; });
    datos.clave = ajustes.clave;
    return fetch(ajustes.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(datos)
    }).then(function (r) { return r.json(); });
  }

  function refrescarEstado() {
    return colaTodos().then(function (items) { pendientes = items.length; }, function () { pendientes = 0; })
      .then(function () { pintarEstado(); });
  }

  function sincronizar() {
    if (sincronizando) return Promise.resolve();
    if (!configurado()) { detalleEstado = ''; return refrescarEstado(); }
    if (navigator.onLine === false) { detalleEstado = 'Sin conexión: se enviará solo al volver la cobertura.'; return refrescarEstado(); }
    sincronizando = true;
    detalleEstado = '';
    return colaTodos().then(function (items) {
      items.sort(function (a, b) { return a.creado - b.creado; });
      var cadena = Promise.resolve(true);
      items.forEach(function (item) {
        cadena = cadena.then(function (seguir) { return seguir ? enviarItem(item) : false; });
      });
      return cadena;
    }).catch(function () {
      detalleEstado = 'No se pudo leer la cola de envío.';
    }).then(function () {
      sincronizando = false;
      return refrescarEstado();
    });
  }

  function enviarItem(item) {
    return llamar(item.payload).then(function (data) {
      if (data && data.ok) {
        if (item.tipo === 'visitas') {
          var ids = {};
          (item.payload.visitas || []).forEach(function (v) { ids[v.id] = true; });
          visitas.forEach(function (v) { if (ids[v.id]) v.enviada = true; });
          guardar(K.visitas, visitas);
        }
        return colaDel(item.qid).then(function () { return true; });
      }
      detalleEstado = (data && data.error === 'clave')
        ? 'La clave no coincide con la del script. Revísala en Ajustes.'
        : 'El script devolvió un error: ' + (data && data.error);
      return false;
    }).catch(function () {
      detalleEstado = 'No se pudo enviar (¿sin cobertura?). Se reintentará solo.';
      return false;
    });
  }

  function pedirDatos() {
    return llamar({ accion: 'leer' }).then(function (d) {
      if (!d || !d.ok) {
        var e = new Error(d && d.error ? d.error : 'respuesta no válida');
        e.codigo = d && d.error;
        throw e;
      }
      return d;
    });
  }

  function fusionar(d) {
    var nuevas = 0;
    (d.fincas || []).forEach(function (f) {
      var loc = buscarFinca(f.nombre);
      if (!loc) {
        fincas.push({ nombre: f.nombre, cliente: f.cliente || '', cultivos: f.cultivos || [], ultimaVisita: f.ultimaVisita || null });
        nuevas++;
      } else {
        if (f.ultimaVisita && (!loc.ultimaVisita || f.ultimaVisita > loc.ultimaVisita)) loc.ultimaVisita = f.ultimaVisita;
        if (!loc.cliente && f.cliente) loc.cliente = f.cliente;
        if ((!loc.cultivos || !loc.cultivos.length) && f.cultivos && f.cultivos.length) loc.cultivos = f.cultivos;
      }
    });
    if (d.ajustes) {
      if (d.ajustes.diasPorMes && Object.keys(d.ajustes.diasPorMes).length) ajustes.diasPorMes = d.ajustes.diasPorMes;
      (d.ajustes.cultivos || []).forEach(function (c) {
        if (!cultivos.some(function (x) { return igual(x, c); })) cultivos.push(c);
      });
    }
    (d.plagas || []).forEach(function (p) {
      var loc = altaPlaga(p.nombre);
      if (!loc) return;
      loc.usos = loc.usos || {};
      var c = p.cultivo || '';
      loc.usos[c] = Math.max(loc.usos[c] || 0, p.veces || 0);
    });
    (d.fenologias || []).forEach(function (x) {
      var loc = altaFen(x.nombre);
      if (loc) loc.usos = Math.max(loc.usos || 0, x.veces || 0);
    });
    var idsPend = {};
    (d.pendientes || []).forEach(function (p) {
      idsPend[p.id] = true;
      if (!visitas.some(function (v) { return v.id === p.id; })) {
        visitas.push({ id: p.id, fecha: p.fecha, finca: p.finca, cliente: p.cliente, cultivo: p.cultivo, fenologia: '',
          plagas: '', observaciones: '', accion: p.accion, seguimiento: p.seguimiento, hecho: false, nFotos: 0, enviada: true });
      }
    });
    visitas.forEach(function (v) { if (v.enviada && v.accion && !v.hecho && !idsPend[v.id]) v.hecho = true; });
    salvar();
    pintarTodo();
    return nuevas;
  }

  // ------------------------------------------------------------ pestañas

  function mostrarTab(nombre) {
    ['visitas', 'ajustes'].forEach(function (t) {
      var el = $('tab-' + t);
      if (el) el.hidden = (t !== nombre);
    });
    var btns = document.querySelectorAll('.tab-btn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i].getAttribute('data-tab') === nombre);
    guardar(K.tab, nombre);
  }
  function iniciarTabs() {
    var btns = document.querySelectorAll('.tab-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function (e) { mostrarTab(e.currentTarget.getAttribute('data-tab')); });
    }
    mostrarTab(leer(K.tab, 'visitas') === 'ajustes' ? 'ajustes' : 'visitas');
  }

  // ------------------------------------------------------------ pestaña Visitas: panel principal

  function pintarTodo() {
    pintarVisitas();
    pintarAjustes();
  }

  function pintarEstado() {
    var badge = $('badge-visitas');
    if (badge) { badge.textContent = pendientes; badge.hidden = !(pendientes > 0); }
    var el = $('v-estado');
    if (!el) return;
    var texto, tipo;
    if (!configurado()) { texto = 'La conexión con la hoja no está configurada. Ve a Ajustes.'; tipo = 'aviso'; }
    else if (pendientes > 0) { texto = pendientes + (pendientes === 1 ? ' envío pendiente' : ' envíos pendientes') + ' de subir a la hoja.'; tipo = 'aviso'; }
    else { texto = 'Todo enviado a la hoja.'; tipo = 'ok'; }
    if (detalleEstado) { texto += ' ' + detalleEstado; if (tipo === 'ok') tipo = 'aviso'; }
    el.textContent = texto;
    el.className = 'v-estado ' + tipo;
  }

  function pintarVisitas() {
    if (form) { pintarForm(); return; }
    var cont = $('tab-visitas');
    if (!cont) return;
    var hoy = hoyTexto();

    var lista = fincas.map(function (f) { return { f: f, e: estadoFinca(f) }; });
    lista.sort(function (a, b) {
      var da = a.e.dias === null ? 1e9 : a.e.dias, db = b.e.dias === null ? 1e9 : b.e.dias;
      return db - da;
    });
    var toca = lista.filter(function (x) { return x.e.toca; });
    var segs = visitas.filter(function (v) { return v.accion && !v.hecho; });
    segs.sort(function (a, b) { return (a.seguimiento || '9999').localeCompare(b.seguimiento || '9999'); });
    var ultimas = visitas.map(function (v, i) { return { v: v, i: i }; });
    ultimas.sort(function (a, b) { return (b.v.fecha || '').localeCompare(a.v.fecha || '') || (b.i - a.i); });
    ultimas = ultimas.slice(0, 12);

    function filaFinca(x) {
      var cult = (x.f.cultivos || []).join(', ');
      var sub = [x.f.cliente, cult].filter(Boolean).join(' · ');
      var alerta = x.e.toca ? ' alerta' : '';
      return '<div class="v-row click" data-finca="' + esc(x.f.nombre) + '"><div class="v-main"><div class="v-titulo">' + esc(x.f.nombre) +
        '</div><div class="v-sub">' + esc(sub) + '</div></div><div class="v-aparte' + alerta + '">' + esc(x.e.texto) +
        '<br>toca cada ' + x.e.frec + ' d</div></div>';
    }

    var html = '<div class="v-wrap">' +
      '<div class="v-card"><div id="v-estado" class="v-estado"></div>' +
      (flash ? '<div class="v-flash">' + esc(flash) + '</div>' : '') +
      '<div class="btn-row"><button class="btn btn-primary" id="v-nueva" type="button" style="margin-top:12px;">Nueva visita</button>' +
      '<button class="btn btn-outline" id="v-sync" type="button">Enviar ahora</button></div></div>' +

      '<div class="v-card"><h2>Toca visitar (' + toca.length + ')</h2>' +
      (toca.length ? toca.map(filaFinca).join('') : '<div class="v-vacio">' + (fincas.length ? 'Ninguna finca pasada de plazo.' : 'Aún no hay fincas. Se crean al registrar la primera visita.') + '</div>') +
      '</div>' +

      '<div class="v-card"><h2>Seguimientos pendientes (' + segs.length + ')</h2>' +
      (segs.length ? segs.map(function (v) {
        var venc = v.seguimiento && v.seguimiento < hoy;
        return '<div class="v-row"><div class="v-main"><div class="v-titulo">' + esc(v.finca) + (v.cultivo ? ' · ' + esc(v.cultivo) : '') +
          '</div><div class="v-sub">' + esc(v.accion) + '</div><div class="v-sub' + '">' + (v.seguimiento ? (venc ? 'Vencido el ' : 'Para el ') + formatoFecha(v.seguimiento) : 'Sin fecha') +
          '</div></div><button class="btn-mini" type="button" data-hecho="' + esc(v.id) + '">Hecho</button></div>';
      }).join('') : '<div class="v-vacio">No hay seguimientos pendientes.</div>') + '</div>' +

      '<div class="v-card"><h2>Últimas visitas</h2>' +
      (ultimas.length ? ultimas.map(function (x) {
        var v = x.v;
        var sub = [v.cultivo, v.plagas].filter(Boolean).join(' · ');
        return '<div class="v-row"><div class="v-main"><div class="v-titulo">' + esc(v.finca) + '</div><div class="v-sub">' + esc(sub || 'Sin plagas anotadas') +
          '</div></div><div class="v-aparte">' + formatoFecha(v.fecha) + '<br>' + (v.enviada ? 'enviada' : 'pendiente') + '</div></div>';
      }).join('') : '<div class="v-vacio">Todavía no hay visitas registradas.</div>') + '</div>' +

      '<details class="v-card"><summary>Todas las fincas (' + lista.length + ')</summary>' +
      (lista.length ? lista.map(filaFinca).join('') : '<div class="v-vacio">Sin fincas todavía.</div>') + '</details>' +
      '</div>';

    cont.innerHTML = html;
    $('v-nueva').addEventListener('click', function () { abrirForm(null); });
    $('v-sync').addEventListener('click', function () { sincronizar(); });
    var filas = cont.querySelectorAll('.v-row.click');
    for (var i = 0; i < filas.length; i++) {
      filas[i].addEventListener('click', function (e) { abrirForm(e.currentTarget.getAttribute('data-finca')); });
    }
    var hechos = cont.querySelectorAll('[data-hecho]');
    for (var j = 0; j < hechos.length; j++) {
      hechos[j].addEventListener('click', function (e) { marcarHecho(e.currentTarget.getAttribute('data-hecho')); });
    }
    pintarEstado();
  }

  function marcarHecho(id) {
    var v = null;
    visitas.forEach(function (x) { if (x.id === id) v = x; });
    if (!v) return;
    colaAdd({ qid: uuid(), creado: Date.now(), tipo: 'hecho', payload: { accion: 'marcarHecho', ids: [id] } })
      .then(function () {
        v.hecho = true;
        guardar(K.visitas, visitas);
        pintarVisitas();
        sincronizar();
      }).catch(function (e) { flash = 'No se pudo guardar el cambio: ' + e.message; pintarVisitas(); });
  }

  // ------------------------------------------------------------ formulario de visita

  function nuevoBorrador() {
    return { fecha: hoyTexto(), finca: '', cliente: '', clienteNuevo: false, fincaNueva: false, fincaCargada: null, cultivosFinca: [], visitado: {}, sel: {},
      observaciones: '', accion: '', seguimiento: '', fotos: [] };
  }
  function asegurarSel(b) {
    b.cultivosFinca.forEach(function (c) {
      if (!b.sel[c]) b.sel[c] = { fenologia: '', plagas: {} };
      if (b.visitado[c] === undefined) b.visitado[c] = true;
    });
  }
  function cargarFincaEnBorrador(b, nombre) {
    var f = buscarFinca(nombre);
    if (!f) return;
    b.finca = f.nombre;
    b.fincaCargada = f.nombre;
    b.fincaNueva = false;
    b.clienteNuevo = false;
    b.cliente = f.cliente || '';
    b.cultivosFinca = (f.cultivos || []).slice();
    b.visitado = {};
    b.sel = {};
    asegurarSel(b);
  }
  function guardarBorrador() {
    // Solo se guarda borrador si la persona ha tocado algo: abrir una finca y salir sin escribir no deja nada.
    if (!form || !form.tocado) return;
    var copia = JSON.parse(JSON.stringify(form));
    copia.fotos = [];
    guardar(K.borrador, copia);
  }
  function abrirForm(nombreFinca) {
    var previo = leer(K.borrador, null);
    if (!nombreFinca && previo && previo.tocado && (previo.finca || '').trim()) {
      form = previo; form.fotos = []; form.restaurado = true;
    } else {
      form = nuevoBorrador();
      if (nombreFinca) cargarFincaEnBorrador(form, nombreFinca);
      try { localStorage.removeItem(K.borrador); } catch (e) { /* nada */ }
    }
    pintarVisitas();
    window.scrollTo(0, 0);
  }
  function cerrarForm(descartar) {
    if (descartar) { try { localStorage.removeItem(K.borrador); } catch (e) { /* nada */ } }
    form = null;
    pintarVisitas();
    window.scrollTo(0, 0);
  }

  function pintarForm() {
    var cont = $('tab-visitas');
    var b = form;
    cont.innerHTML = '<div class="v-wrap"><div class="v-card">' +
      '<h2>Nueva visita</h2>' +
      (b.restaurado ? '<div class="v-banner"><span>Has recuperado una visita sin terminar.</span><button class="btn-mini" id="vf-descartar" type="button">Descartar</button></div>' : '') +
      '<label class="first">Fecha</label><input type="date" id="vf-fecha" value="' + esc(b.fecha) + '">' +
      '<label>Cliente</label><select id="vf-cliente-sel"></select>' +
      '<input type="text" id="vf-cliente" autocomplete="off" placeholder="Nombre del cliente nuevo" value="' + esc(b.cliente) + '" hidden>' +
      '<label>Finca</label><select id="vf-finca-sel"></select>' +
      '<input type="text" id="vf-finca" autocomplete="off" placeholder="Nombre de la finca nueva" value="' + esc(b.finca) + '" hidden>' +
      '<p class="hint" id="vf-info"></p>' +
      '<div id="vf-cultivos-wrap"></div>' +
      '<div id="vf-bloques"></div>' +
      '<label style="margin-top:20px;">Observaciones generales</label><textarea id="vf-obs" placeholder="Lo que has visto en la finca">' + esc(b.observaciones) + '</textarea>' +
      '<label>Acción pendiente</label><input type="text" id="vf-accion" name="nota-seguimiento" autocomplete="off" placeholder="Ej. Volver a mirar el riego del sector 2" value="' + esc(b.accion) + '">' +
      '<label>Fecha de seguimiento</label><input type="date" id="vf-seg" value="' + esc(b.seguimiento) + '">' +
      '<div class="seg-rapido"><button class="btn-mini" type="button" data-sumar="7">+7 días</button><button class="btn-mini" type="button" data-sumar="15">+15 días</button><button class="btn-mini" type="button" data-sumar="30">+30 días</button></div>' +
      '<label>Fotos</label><input type="file" id="vf-fotos" accept="image/*" multiple><div class="fotos" id="vf-fotos-prev"></div>' +
      '<div class="btn-row"><button class="btn btn-primary" id="vf-guardar" type="button">Guardar visita</button><button class="btn btn-outline" id="vf-cancelar" type="button">Cancelar</button></div>' +
      '<p class="hint" id="vf-msg"></p></div></div>';

    $('vf-fecha').addEventListener('change', function (e) { form.fecha = e.target.value; guardarBorrador(); });
    $('vf-cliente-sel').addEventListener('change', function (e) {
      var v = e.target.value;
      var anterior = (form.cliente || '').trim();
      if (v === '__nuevo__') { form.clienteNuevo = true; form.cliente = ''; soltarFinca(); }
      else if (v === '') { form.clienteNuevo = false; form.cliente = ''; soltarFinca(); }
      else { form.clienteNuevo = false; if (!igual(anterior, v)) soltarFinca(); form.cliente = v; }
      $('vf-cliente').value = form.cliente;
      $('vf-finca').value = form.finca;
      repintarFincaYCultivos();
      guardarBorrador();
    });
    $('vf-cliente').addEventListener('input', function (e) { form.cliente = e.target.value; pintarInfoFinca(); guardarBorrador(); });
    $('vf-finca-sel').addEventListener('change', function (e) {
      var v = e.target.value;
      if (v === '__nuevo__') { soltarFinca(); form.fincaNueva = true; }
      else if (v === '') { soltarFinca(); }
      else { cargarFincaEnBorrador(form, v); }
      $('vf-finca').value = form.finca;
      $('vf-cliente').value = form.cliente;
      repintarFincaYCultivos();
      guardarBorrador();
    });
    $('vf-finca').addEventListener('input', alEscribirFinca);
    $('vf-obs').addEventListener('input', function (e) { form.observaciones = e.target.value; guardarBorrador(); });
    $('vf-accion').addEventListener('input', function (e) { form.accion = e.target.value; guardarBorrador(); });
    $('vf-seg').addEventListener('change', function (e) { form.seguimiento = e.target.value; guardarBorrador(); });
    var rapidos = cont.querySelectorAll('[data-sumar]');
    for (var i = 0; i < rapidos.length; i++) {
      rapidos[i].addEventListener('click', function (e) {
        form.seguimiento = sumarDias(form.fecha || hoyTexto(), Number(e.currentTarget.getAttribute('data-sumar')));
        $('vf-seg').value = form.seguimiento;
        guardarBorrador();
      });
    }
    $('vf-fotos').addEventListener('change', alElegirFotos);
    var tarjeta = cont.querySelector('.v-card');
    ['input', 'change', 'click'].forEach(function (ev) {
      tarjeta.addEventListener(ev, function () { if (form) form.tocado = true; }, true);
    });
    $('vf-guardar').addEventListener('click', guardarVisita);
    $('vf-cancelar').addEventListener('click', function () { cerrarForm(true); });
    if ($('vf-descartar')) $('vf-descartar').addEventListener('click', function () { cerrarForm(true); abrirForm(null); });

    var bloques = $('vf-bloques');
    bloques.addEventListener('click', alTocarBloques);
    bloques.addEventListener('change', alCambiarBloques);
    bloques.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.classList.contains('vf-np-input')) { e.preventDefault(); e.target.parentNode.querySelector('button').click(); }
    });

    pintarSelectores();
    pintarInfoFinca();
    pintarCultivosFinca();
    pintarBloques();
    pintarFotos();
  }

  function clienteExiste(c) {
    return !!(c || '').trim() && fincas.some(function (f) { return igual(f.cliente, c); });
  }
  function clienteEsNuevo() {
    return !!form.clienteNuevo || (!!(form.cliente || '').trim() && !clienteExiste(form.cliente));
  }
  function fincaEsNueva() {
    if (form.fincaCargada) return false;
    return clienteEsNuevo() || !!form.fincaNueva || !!(form.finca || '').trim();
  }
  function soltarFinca() {
    form.finca = ''; form.fincaCargada = null; form.fincaNueva = false;
    form.cultivosFinca = []; form.visitado = {}; form.sel = {};
  }
  function repintarFincaYCultivos() {
    pintarSelectores();
    pintarInfoFinca();
    pintarCultivosFinca();
    pintarBloques();
  }

  // Cliente y finca van en desplegables encadenados: la lista de fincas solo contiene las del cliente elegido.
  function pintarSelectores() {
    var sc = $('vf-cliente-sel'), sf = $('vf-finca-sel');
    if (!sc || !sf) return;
    var nuevoC = clienteEsNuevo(), nuevoF = fincaEsNueva();
    var cli = (form.cliente || '').trim();
    var clientes = unicos(fincas.map(function (f) { return f.cliente; }).filter(Boolean)).sort(function (a, b) { return a.localeCompare(b, 'es'); });
    sc.innerHTML = '<option value="">Elige un cliente…</option>' +
      clientes.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('') +
      '<option value="__nuevo__">+ Cliente nuevo…</option>';
    sc.value = nuevoC ? '__nuevo__' : (cli ? (clientes.filter(function (c) { return igual(c, cli); })[0] || '') : '');

    var delCliente = (cli && !nuevoC) ? fincas.filter(function (f) { return igual(f.cliente, cli); }) : [];
    if (form.fincaCargada && !delCliente.some(function (f) { return igual(f.nombre, form.fincaCargada); })) {
      var c0 = buscarFinca(form.fincaCargada); if (c0) delCliente.push(c0);
    }
    delCliente.sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
    var hayCliente = nuevoC || !!cli || !!form.fincaCargada;
    sf.innerHTML = '<option value="">' + (hayCliente ? 'Elige una finca…' : 'Primero elige el cliente') + '</option>' +
      delCliente.map(function (f) { return '<option value="' + esc(f.nombre) + '">' + esc(f.nombre) + '</option>'; }).join('') +
      (hayCliente ? '<option value="__nuevo__">+ Finca nueva…</option>' : '');
    sf.disabled = !hayCliente;
    sf.value = form.fincaCargada ? form.fincaCargada : (nuevoF && hayCliente ? '__nuevo__' : '');
    $('vf-cliente').hidden = !nuevoC;
    $('vf-finca').hidden = !nuevoF;
  }

  function pintarInfoFinca() {
    var info = $('vf-info');
    if (!info) return;
    var f = form.fincaCargada ? buscarFinca(form.fincaCargada) : null;
    var cli = (form.cliente || '').trim();
    if (f) {
      var e = estadoFinca(f);
      info.textContent = 'Finca existente. Última visita: ' + (f.ultimaVisita ? formatoFecha(f.ultimaVisita) + ' (' + e.texto + ')' : 'ninguna') + '.';
    } else if (fincaEsNueva()) {
      info.textContent = 'Finca nueva: se creará al guardar. Añade sus cultivos.';
    } else if (!cli && !clienteEsNuevo()) {
      info.textContent = 'Empieza eligiendo el cliente.';
    } else {
      info.textContent = 'Elige una de sus fincas o crea una nueva.';
    }
  }

  function alEscribirFinca(e) {
    form.finca = e.target.value;
    var f = buscarFinca(form.finca);
    if (f && !form.fincaCargada) {
      // Ya existía con ese nombre: se carga con su cliente y sus cultivos en vez de duplicarla.
      cargarFincaEnBorrador(form, f.nombre);
      $('vf-finca').value = form.finca;
      $('vf-cliente').value = form.cliente;
      repintarFincaYCultivos();
    } else {
      pintarInfoFinca();
    }
    guardarBorrador();
  }

  function pintarCultivosFinca() {
    var cont = $('vf-cultivos-wrap');
    if (!cont) return;
    if (!(form.fincaCargada || fincaEsNueva())) { cont.innerHTML = ''; return; }
    var elegidos = form.cultivosFinca.map(function (c) {
      return '<button type="button" class="chip on" data-cf-quitar="' + esc(c) + '" title="Quitar de la finca">' + esc(c) + ' ×</button>';
    }).join('');
    var resto = unicos(cultivos).filter(function (c) { return !form.cultivosFinca.some(function (x) { return igual(x, c); }); });
    cont.innerHTML = '<label>Cultivos de la finca</label>' +
      (elegidos ? '<div class="chips">' + elegidos + '</div>' : '') +
      '<select id="vf-cultivo-add"><option value="">' + (form.cultivosFinca.length ? 'Añadir otro cultivo…' : 'Añadir cultivo…') + '</option>' +
      resto.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('') + '</select>';
    var quitar = cont.querySelectorAll('[data-cf-quitar]');
    for (var i = 0; i < quitar.length; i++) {
      quitar[i].addEventListener('click', function (e) {
        var c = e.currentTarget.getAttribute('data-cf-quitar');
        form.cultivosFinca = form.cultivosFinca.filter(function (x) { return !igual(x, c); });
        delete form.sel[c]; delete form.visitado[c];
        pintarCultivosFinca();
        pintarBloques();
        guardarBorrador();
      });
    }
    $('vf-cultivo-add').addEventListener('change', function (e) {
      var c = e.target.value;
      if (!c) return;
      if (!form.cultivosFinca.some(function (x) { return igual(x, c); })) form.cultivosFinca.push(c);
      asegurarSel(form);
      pintarCultivosFinca();
      pintarBloques();
      guardarBorrador();
    });
  }

  function ordenPlagas(cultivo) {
    return plagas.slice().sort(function (a, b) {
      var ua = (a.usos && a.usos[cultivo]) || 0, ub = (b.usos && b.usos[cultivo]) || 0;
      if (ub !== ua) return ub - ua;
      var ta = 0, tb = 0;
      Object.keys(a.usos || {}).forEach(function (k) { ta += a.usos[k]; });
      Object.keys(b.usos || {}).forEach(function (k) { tb += b.usos[k]; });
      return (tb - ta) || a.nombre.localeCompare(b.nombre, 'es');
    });
  }

  function pintarBloques() {
    var cont = $('vf-bloques');
    if (!cont) return;
    if (!form.cultivosFinca.length) {
      cont.innerHTML = '<p class="hint">Elige la finca y sus cultivos para anotar plagas y estado fenológico.</p>';
      return;
    }
    cont.innerHTML = form.cultivosFinca.map(function (c) {
      var s = form.sel[c] || { fenologia: '', plagas: {} };
      var visit = form.visitado[c] !== false;
      var opciones = '<option value="">Sin indicar</option>' + fenologias.map(function (f) {
        return '<option value="' + esc(f.nombre) + '"' + (igual(f.nombre, s.fenologia) ? ' selected' : '') + '>' + esc(f.nombre) + '</option>';
      }).join('');
      var chips = ordenPlagas(c).map(function (p) {
        var nivel = s.plagas[p.nombre] || '';
        return '<button type="button" class="chip' + (nivel ? ' nivel-' + nivel : '') + '" data-c="' + esc(c) + '" data-p="' + esc(p.nombre) + '">' +
          esc(p.nombre) + (nivel ? ' · ' + nivel : '') + '</button>';
      }).join('');
      return '<div class="cultivo-bloque' + (visit ? '' : ' off') + '" data-bloque="' + esc(c) + '">' +
        '<label class="chk"><input type="checkbox" class="vf-visitado" data-c="' + esc(c) + '"' + (visit ? ' checked' : '') + '> <strong>' + esc(c) + '</strong> <span class="hint" style="margin:0;">visitado hoy</span></label>' +
        '<label>Estado fenológico</label><select class="vf-fen" data-c="' + esc(c) + '">' + opciones + '</select>' +
        '<div class="nueva-fila"><input type="text" class="vf-nf-input" placeholder="Nuevo estado fenológico"><button type="button" class="btn-mini" data-nf="' + esc(c) + '">Añadir</button></div>' +
        '<label>Plagas y enfermedades <span class="hint" style="margin:0;">(toca para subir el nivel: leve, media, alta, quitar)</span></label>' +
        '<div class="chips">' + (chips || '<span class="hint" style="margin:0;">Aún no hay ninguna en la lista. Añade la primera aquí abajo.</span>') + '</div>' +
        '<div class="nueva-fila"><input type="text" class="vf-np-input" placeholder="Nueva plaga o enfermedad"><button type="button" class="btn-mini" data-np="' + esc(c) + '">Añadir</button></div>' +
        '</div>';
    }).join('');
  }

  function alTocarBloques(e) {
    var t = e.target.closest ? e.target.closest('button') : null;
    if (!t) return;
    if (t.hasAttribute('data-p')) {
      var c = t.getAttribute('data-c'), p = t.getAttribute('data-p');
      var s = form.sel[c];
      var actual = NIVELES.indexOf(s.plagas[p] || '');
      var sig = NIVELES[(actual + 1) % NIVELES.length];
      if (sig) s.plagas[p] = sig; else delete s.plagas[p];
      pintarBloques();
      guardarBorrador();
    } else if (t.hasAttribute('data-np')) {
      var cp = t.getAttribute('data-np');
      var inp = t.parentNode.querySelector('.vf-np-input');
      var plaga = altaPlaga(inp.value);
      if (!plaga) return;
      form.sel[cp].plagas[plaga.nombre] = form.sel[cp].plagas[plaga.nombre] || 'leve';
      guardar(K.plagas, plagas);
      pintarBloques();
      guardarBorrador();
    } else if (t.hasAttribute('data-nf')) {
      var cf = t.getAttribute('data-nf');
      var inp2 = t.parentNode.querySelector('.vf-nf-input');
      var fen = altaFen(inp2.value);
      if (!fen) return;
      form.sel[cf].fenologia = fen.nombre;
      guardar(K.fenologias, fenologias);
      pintarBloques();
      guardarBorrador();
    }
  }

  function alCambiarBloques(e) {
    var t = e.target;
    var c = t.getAttribute('data-c');
    if (!c) return;
    if (t.classList.contains('vf-visitado')) {
      form.visitado[c] = t.checked;
      var bloque = t.closest('.cultivo-bloque');
      if (bloque) bloque.classList.toggle('off', !t.checked);
    } else if (t.classList.contains('vf-fen')) {
      form.sel[c].fenologia = t.value;
    }
    guardarBorrador();
  }

  // ------------------------------------------------------------ fotos

  function comprimir(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 1280, w = img.naturalWidth, h = img.naturalHeight;
        var k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        var dataUrl = c.toDataURL('image/jpeg', 0.72);
        URL.revokeObjectURL(url);
        res({ mime: 'image/jpeg', base64: dataUrl.split(',')[1], preview: dataUrl });
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('No se pudo leer la imagen')); };
      img.src = url;
    });
  }

  function alElegirFotos(e) {
    var archivos = Array.prototype.slice.call(e.target.files || []);
    e.target.value = '';
    var msg = $('vf-msg');
    var espacio = MAX_FOTOS - form.fotos.length;
    if (archivos.length > espacio) { msg.textContent = 'Máximo ' + MAX_FOTOS + ' fotos por visita.'; archivos = archivos.slice(0, Math.max(0, espacio)); }
    archivos.reduce(function (p, f) {
      return p.then(function () {
        return comprimir(f).then(function (foto) { form.fotos.push(foto); pintarFotos(); })
          .catch(function () { msg.textContent = 'Una de las fotos no se pudo procesar.'; });
      });
    }, Promise.resolve());
  }

  function pintarFotos() {
    var cont = $('vf-fotos-prev');
    if (!cont) return;
    cont.innerHTML = form.fotos.map(function (f, i) {
      return '<div class="foto"><img src="' + f.preview + '" alt="Foto ' + (i + 1) + '"><button type="button" data-quitar="' + i + '">×</button></div>';
    }).join('');
    var btns = cont.querySelectorAll('[data-quitar]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function (e) {
        form.fotos.splice(Number(e.currentTarget.getAttribute('data-quitar')), 1);
        pintarFotos();
      });
    }
  }

  // ------------------------------------------------------------ guardar la visita

  function textoPlagas(mapa) {
    return Object.keys(mapa).filter(function (n) { return mapa[n]; })
      .map(function (n) { return n + ' (' + mapa[n] + ')'; }).join(', ');
  }

  function guardarVisita() {
    var b = form;
    var msg = $('vf-msg');
    var nombre = (b.finca || '').trim();
    if (!nombre) { msg.textContent = 'Elige la finca o escribe el nombre de la nueva.'; return; }
    if (!b.fincaCargada && !(b.cliente || '').trim()) { msg.textContent = 'Indica el cliente de la finca nueva.'; return; }
    var cvis = b.cultivosFinca.filter(function (c) { return b.visitado[c] !== false; });
    if (!cvis.length) { msg.textContent = 'Elige al menos un cultivo visitado.'; return; }
    if (/https?:\/\/|script\.google\.com/i.test(b.accion || '')) {
      msg.textContent = 'En "Acción pendiente" hay un enlace. Escribe solo lo que quieres revisar (o déjalo vacío).';
      return;
    }
    var fecha = b.fecha || hoyTexto();
    var existente = buscarFinca(nombre);
    var nombreFinal = existente ? existente.nombre : nombre;
    var cliente = (b.cliente || '').trim();
    var base = uuid();
    var filas = cvis.map(function (c, i) {
      var s = b.sel[c] || { fenologia: '', plagas: {} };
      var primera = (i === 0);
      return {
        id: base + '-' + (i + 1), fecha: fecha, finca: nombreFinal, cliente: cliente, cultivo: c,
        fenologia: s.fenologia || '', plagas: textoPlagas(s.plagas),
        observaciones: primera ? (b.observaciones || '').trim() : '',
        accion: primera ? (b.accion || '').trim() : '',
        seguimiento: (primera && (b.accion || '').trim()) ? (b.seguimiento || '') : '',
        hecho: false,
        fotos: primera ? b.fotos.map(function (f) { return { base64: f.base64, mime: f.mime }; }) : []
      };
    });
    var fincaPayload = { nombre: nombreFinal, cliente: cliente, cultivos: b.cultivosFinca.slice() };
    var item = { qid: uuid(), creado: Date.now(), tipo: 'visitas',
      payload: { accion: 'guardarVisitas', fincas: [fincaPayload], visitas: filas } };
    msg.textContent = 'Guardando...';
    colaAdd(item).then(function () {
      var f = buscarFinca(nombreFinal);
      if (!f) { f = { nombre: nombreFinal, cliente: cliente, cultivos: [], ultimaVisita: null }; fincas.push(f); }
      if (cliente) f.cliente = cliente;
      f.cultivos = b.cultivosFinca.slice();
      if (!f.ultimaVisita || fecha > f.ultimaVisita) f.ultimaVisita = fecha;
      filas.forEach(function (r) {
        var copia = {};
        Object.keys(r).forEach(function (k) { if (k !== 'fotos') copia[k] = r[k]; });
        copia.nFotos = r.fotos.length;
        copia.enviada = false;
        visitas.push(copia);
        nombresDePlagas(r.plagas).forEach(function (n) {
          var p = altaPlaga(n);
          p.usos = p.usos || {};
          p.usos[r.cultivo] = (p.usos[r.cultivo] || 0) + 1;
        });
        if (r.fenologia) { var fe = altaFen(r.fenologia); fe.usos = (fe.usos || 0) + 1; }
      });
      salvar();
      try { localStorage.removeItem(K.borrador); } catch (e) { /* nada */ }
      form = null;
      flash = 'Visita guardada (' + filas.length + (filas.length === 1 ? ' cultivo' : ' cultivos') + ').';
      pintarVisitas();
      window.scrollTo(0, 0);
      setTimeout(function () { flash = ''; if (!form) pintarVisitas(); }, 5000);
      return sincronizar();
    }).catch(function (err) {
      var m = $('vf-msg');
      if (m) m.textContent = 'No se pudo guardar en el móvil: ' + (err && err.message ? err.message : err);
    });
  }

  // ------------------------------------------------------------ pestaña Ajustes

  function pintarAjustes() {
    var cont = $('tab-ajustes');
    if (!cont) return;
    var hayFoco = cont.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (hayFoco) return; // no repintar mientras se escribe
    var frec = frecuenciaActual();
    cont.innerHTML = '<div class="v-wrap">' +
      '<div class="v-card"><h2>Conexión con la hoja</h2>' +
      '<label class="first">Dirección del script (termina en /exec)</label><input type="text" id="aj-url" name="direccion-script" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(ajustes.url) + '">' +
      '<label>Clave</label><input type="text" id="aj-clave" class="secreto" name="clave-script" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(ajustes.clave) + '">' +
      '<button class="btn btn-primary" id="aj-probar" type="button">Guardar y probar la conexión</button><p class="hint" id="aj-msg"></p></div>' +
      '<div class="v-card"><h2>Datos de la hoja</h2><p class="hint" style="margin-top:0;">Descarga las fincas, las plagas, los estados fenológicos y los pendientes que ya hay en la hoja. Sirve para preparar un móvil nuevo.</p>' +
      '<button class="btn btn-outline" id="aj-cargar" type="button">Cargar datos de la hoja</button><p class="hint" id="aj-msg2"></p></div>' +
      '<div class="v-card"><h2>Listas</h2>' +
      '<label class="first">Cultivos (uno por línea)</label><textarea id="aj-cultivos" rows="6">' + esc(cultivos.join('\n')) + '</textarea>' +
      '<label>Estados fenológicos (uno por línea, en el orden que quieras verlos)</label><textarea id="aj-fen" rows="6">' + esc(fenologias.map(function (f) { return f.nombre; }).join('\n')) + '</textarea>' +
      '<label>Plagas y enfermedades (una por línea)</label><textarea id="aj-plagas" rows="8">' + esc(plagas.map(function (p) { return p.nombre; }).join('\n')) + '</textarea>' +
      '<button class="btn btn-secondary" id="aj-listas" type="button">Guardar listas</button><p class="hint" id="aj-msg3"></p></div>' +
      '<div class="v-card"><h2>Copia de seguridad</h2><p class="hint" style="margin-top:0;">Guarda en un archivo tus fincas, visitas y listas. La dirección y la clave no se incluyen. <span id="aj-ultima"></span></p>' +
      '<button class="btn btn-outline" id="aj-copia" type="button">Descargar copia</button>' +
      '<label style="margin-top:18px;">Restaurar desde una copia</label><input type="file" id="aj-restaurar" accept=".json,application/json,text/plain"><p class="hint" id="aj-msg4"></p></div>' +
      '<div class="v-card"><h2>Frecuencia de visita</h2><p class="hint" style="margin-top:0;">Este mes toca visitar cada ' + frec + ' días. Los días por mes se cambian en la pestaña Ajustes de la hoja y se actualizan aquí con "Cargar datos de la hoja".</p></div>' +
      '</div>';
    $('aj-probar').addEventListener('click', probarConexion);
    $('aj-cargar').addEventListener('click', cargarDeHoja);
    $('aj-listas').addEventListener('click', guardarListas);
    $('aj-copia').addEventListener('click', descargarCopia);
    $('aj-restaurar').addEventListener('change', restaurarCopia);
    mostrarUltimaCopia();
  }

  function mostrarUltimaCopia() {
    var iso = leer('v-ultima-copia', null);
    var el = $('aj-ultima');
    if (el) el.textContent = iso ? 'Última copia: ' + formatoFecha(String(iso).slice(0, 10)) + '.' : 'Todavía no has hecho ninguna copia.';
  }

  function descargarCopia() {
    try {
      var copia = { app: 'visitas-campo', version: 1, fecha: new Date().toISOString(), datos: exportar() };
      var blob = new Blob([JSON.stringify(copia, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'copia-visitas-' + hoyTexto() + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      guardar('v-ultima-copia', new Date().toISOString());
      mostrarUltimaCopia();
      fijarMsg('aj-msg4', 'Copia descargada. Guárdala en un sitio seguro (Drive, por ejemplo).');
    } catch (e) {
      fijarMsg('aj-msg4', 'No se pudo crear la copia.');
    }
  }

  function restaurarCopia(e) {
    var input = e.target;
    var archivo = input.files && input.files[0];
    if (!archivo) return;
    var lector = new FileReader();
    lector.onload = function () {
      try {
        var d = JSON.parse(lector.result);
        if (!d || d.app !== 'visitas-campo' || !d.datos) throw new Error('formato no válido');
        var r = importar(d.datos);
        fijarMsg('aj-msg4', 'Copia restaurada. Añadidos: ' + r.visitas + ' visitas, ' + r.fincas + ' fincas, ' + r.plagas + ' plagas y ' + r.fenologias + ' estados fenológicos. No se ha borrado nada de lo que ya tenías.');
      } catch (err) {
        fijarMsg('aj-msg4', 'Ese archivo no parece una copia válida de esta app.');
      }
      input.value = '';
    };
    lector.readAsText(archivo);
  }

  function fijarMsg(id, texto) { var el = $(id); if (el) el.textContent = texto; }

  function textoErrorConexion(e) {
    if (e && e.codigo === 'clave') return 'La clave no coincide con la del script. Cópiala otra vez, sin espacios.';
    if (e && e.codigo) return 'El script respondió con un error: ' + e.codigo;
    return 'No se pudo conectar. Revisa que la dirección termine en /exec y que tengas cobertura.';
  }

  function probarConexion() {
    ajustes.url = $('aj-url').value.trim();
    ajustes.clave = $('aj-clave').value.trim();
    guardar(K.ajustes, ajustes);
    if (!configurado()) { fijarMsg('aj-msg', 'Rellena la dirección y la clave.'); return; }
    fijarMsg('aj-msg', 'Probando...');
    pedirDatos().then(function (d) {
      var n = fusionar(d);
      fijarMsg('aj-msg', 'Conexión correcta. Fincas nuevas cargadas: ' + n + '.');
      return sincronizar();
    }).catch(function (e) { fijarMsg('aj-msg', textoErrorConexion(e)); });
  }

  function cargarDeHoja() {
    if (!configurado()) { fijarMsg('aj-msg2', 'Primero configura la conexión.'); return; }
    fijarMsg('aj-msg2', 'Cargando...');
    pedirDatos().then(function (d) {
      var n = fusionar(d);
      fijarMsg('aj-msg2', 'Hecho. Fincas nuevas: ' + n + '. Plagas: ' + plagas.length + '. Estados fenológicos: ' + fenologias.length + '.');
    }).catch(function (e) { fijarMsg('aj-msg2', textoErrorConexion(e)); });
  }

  function lineas(id) {
    return unicos($(id).value.split('\n').map(limpiarNombre).filter(Boolean));
  }

  function guardarListas() {
    cultivos = lineas('aj-cultivos');
    var nf = lineas('aj-fen');
    fenologias = nf.map(function (n) { var viejo = buscarFen(n); return { nombre: n, usos: viejo ? viejo.usos : 0 }; });
    var np = lineas('aj-plagas');
    plagas = np.map(function (n) { var vieja = buscarPlaga(n); return { nombre: n, usos: vieja ? vieja.usos : {} }; });
    salvar();
    fijarMsg('aj-msg3', 'Listas guardadas.');
  }

  // ------------------------------------------------------------ copia de seguridad (la usa el panel de Tratamientos)

  function exportar() {
    return { fincas: fincas, visitas: visitas, plagas: plagas, fenologias: fenologias, cultivos: cultivos };
  }

  function importar(d) {
    var res = { fincas: 0, visitas: 0, plagas: 0, fenologias: 0 };
    if (!d) return res;
    (d.fincas || []).forEach(function (f) {
      if (!f || !f.nombre) return;
      var loc = buscarFinca(f.nombre);
      if (!loc) { fincas.push(f); res.fincas++; }
      else if (f.ultimaVisita && (!loc.ultimaVisita || f.ultimaVisita > loc.ultimaVisita)) loc.ultimaVisita = f.ultimaVisita;
    });
    var nuevasSinEnviar = [];
    (d.visitas || []).forEach(function (v) {
      if (!v || !v.id || visitas.some(function (x) { return x.id === v.id; })) return;
      visitas.push(v); res.visitas++;
      if (v.enviada === false) nuevasSinEnviar.push(v);
    });
    (d.plagas || []).forEach(function (p) {
      if (!p || !p.nombre) return;
      var loc = buscarPlaga(p.nombre);
      if (!loc) { plagas.push(p); res.plagas++; }
    });
    (d.fenologias || []).forEach(function (f) {
      if (!f || !f.nombre) return;
      if (!buscarFen(f.nombre)) { fenologias.push(f); res.fenologias++; }
    });
    cultivos = unicos(cultivos.concat(d.cultivos || []));
    salvar();
    if (nuevasSinEnviar.length) {
      var filas = nuevasSinEnviar.map(function (v) {
        var r = {}; Object.keys(v).forEach(function (k) { if (k !== 'nFotos' && k !== 'enviada') r[k] = v[k]; });
        r.fotos = [];
        return r;
      });
      var fincasPayload = unicos(filas.map(function (r) { return r.finca; })).map(function (n) {
        var f = buscarFinca(n) || { nombre: n, cliente: '', cultivos: [] };
        return { nombre: f.nombre, cliente: f.cliente || '', cultivos: f.cultivos || [] };
      });
      colaAdd({ qid: uuid(), creado: Date.now(), tipo: 'visitas', payload: { accion: 'guardarVisitas', fincas: fincasPayload, visitas: filas } })
        .then(function () { sincronizar(); });
    }
    pintarTodo();
    return res;
  }

  // ------------------------------------------------------------ arranque

  function iniciar() {
    iniciarTabs();
    pintarTodo();
    refrescarEstado();
    window.addEventListener('online', function () { sincronizar(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) sincronizar(); });
    if (configurado()) {
      sincronizar();
      if (!fincas.length) pedirDatos().then(fusionar).catch(function () { /* se podrá cargar luego desde Ajustes */ });
    }
  }

  window.VisitasApp = {
    exportar: exportar, importar: importar, sincronizar: sincronizar,
    _test: {
      estado: function () { return { fincas: fincas, visitas: visitas, plagas: plagas, fenologias: fenologias, cultivos: cultivos, ajustes: ajustes, form: form }; },
      añadirFotoFalsa: function (b64) { if (form) form.fotos.push({ mime: 'image/jpeg', base64: b64, preview: 'data:image/jpeg;base64,' + b64 }); },
      cola: colaTodos
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
