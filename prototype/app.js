/* Relay v2.2 – mobile-first app UI. Every list/status reads the selected phone's own inbox via Mesh. */
(function () {
  'use strict';
  var M = window.Mesh, UI = window.RelayUI = {};
  var NATIVE = !!window.RELAY_NATIVE, NB = window.RelayNative || {};   // NATIVE: running inside the Android app (real radio, real storage, no simulation)
  var ui = UI.ui = { screen: 'home', seg: 'requests', viewer: null, done: null, form: null, filter: { cat: 'All', area: 'All', help: {} },
    sheet: null, lastFocus: null, onboard: false, snooze: {}, earlierOpen: false, toolsOpen: false, auto: true };

  /* ---------- helpers ---------- */
  var ICONS = {
    home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10', plus: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8v8M8 12h8',
    heart: 'M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z', list: 'M5 4h14v16H5zM8 9h8M8 13h8M8 17h5',
    signal: 'M12 12h.01M8.5 8.5a5 5 0 000 7M15.5 8.5a5 5 0 010 7M5.5 5.5a9 9 0 000 13M18.5 5.5a9 9 0 010 13',
    alert: 'M12 3v2M5 13a7 7 0 0114 0v4H5zM3 20h18', userplus: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 0112 0v1M19 8v6M16 11h6',
    pin: 'M12 21s-7-6-7-11a7 7 0 0114 0c0 5-7 11-7 11zM12 12a2 2 0 100-4 2 2 0 000 4z',
    info: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v5M12 8h.01', next: 'M9 6l6 6-6 6', x: 'M6 6l12 12M18 6L6 18', check: 'M5 12l5 5 9-10',
    reset: 'M4 4v6h6M5 14a8 8 0 108-8', mega: 'M3 11v2l12 5V6zM15 8a4 4 0 010 8', image: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M9 9h.01',
    clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2', refresh: 'M20 12a8 8 0 01-14 5M4 12a8 8 0 0114-5M18 3v4h-4M6 21v-4h4'
  };
  function icon(n, cls) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'icon' + (cls ? ' ' + cls : '')); s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICONS[n]); s.appendChild(p);
    return s;
  }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') el.className = v;
      else if (k === 'on') Object.keys(v).forEach(function (e) { el.addEventListener(e, v[e]); });
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
      else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }
  function $(id) { return document.getElementById(id); }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function S() { return M.state(); }
  function age(t) { var d = S().tick - t; return d <= 0 ? 'just now' : d < 60 ? d + ' min ago' : Math.floor(d / 60) + ' h ago'; }
  function span(mins) { return mins < 60 ? mins + ' min' : (mins % 60 ? Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min' : mins / 60 + ' h'); }
  function pill(text, cls) { return h('span', { class: 'pill ' + (cls || 'neutral') }, text); }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function load(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  UI.h = h; UI.icon = icon; UI.toast = toast; UI.age = age; UI.pill = pill; UI.clear = clear;

  /* ---------- sheets ---------- */
  function openSheet(title, build) {
    ui.sheet = { title: title, build: build };
    ui.lastFocus = document.activeElement;
    $('sheet-title').textContent = title; $('sheetroot').hidden = false; refreshSheet();
    $('sheet').focus();
  }
  function refreshSheet() {
    if (!ui.sheet) return;
    var b = $('sheetbody'), top = b.scrollTop; clear(b); b.appendChild(ui.sheet.build()); b.scrollTop = top;
  }
  function closeSheet() {
    ui.sheet = null; $('sheetroot').hidden = true;
    if (ui.lastFocus && ui.lastFocus.focus) { try { ui.lastFocus.focus(); } catch (e) {} }
  }
  UI.openSheet = openSheet; UI.refreshSheet = refreshSheet; UI.closeSheet = closeSheet;

  /* ---------- neighbourhood helpers ---------- */
  function hoodName(id) { var n = M.NEIGHBORHOODS.filter(function (x) { return x.id === id; })[0]; return n ? n.name : ''; }
  function hoodSelect(id, value, onChange, otherLabel) {
    var s = h('select', { id: id, on: { change: function (e) { onChange(e.target.value); } } },
      M.NEIGHBORHOODS.map(function (n) { return h('option', { value: n.id }, n.name); }), h('option', { value: 'other' }, otherLabel || 'Somewhere else'));
    s.value = value || (M.NEIGHBORHOODS[0].id); return s;
  }
  function viewerNode() { return S().nodes[ui.viewer]; }
  function myHood() { var hs = M.hoodState(ui.viewer); return hs; }

  /* ---------- case helpers (one case = one card, even if several packets arrived) ---------- */
  function info(c) {
    var pl = c.payload, st = c.state;
    return { id: c.id, r: c.r, pl: pl, st: st, title: pl.title, desc: pl.description, area: pl.area, hoodId: pl.areaHood, hoodName: pl.areaHoodName || '',
      kind: pl.kind, category: pl.category, urgent: pl.urgent, expired: st.expired, resolved: st.resolved, active: !st.expired && !st.resolved,
      left: st.minutesLeft, renewed: st.renewed, hasPhoto: !!pl.attachmentId, hasPrivate: pl.hasPrivate };
  }
  function catLabel(i) { return i.kind === 'missing' ? 'Missing person' : (i.urgent ? 'Urgent · ' : '') + i.category; }
  function reqFilterCat(i) { return i.kind === 'missing' ? 'Missing' : i.category; }
  function casesFor(v) {
    return M.receivedCases(v).filter(function (c) { return !S().local[v].hidden[c.id]; }).map(info);
  }
  function receivedUpdates(v) { return M.receivedBroadcasts(v).filter(function (p) { return !M.isExpired(p); }); }
  function nearbyLabel(i) {
    var vh = myHood().id;
    if (!vh || !i.hoodId) return null;
    return M.nearby(vh, i.hoodId) ? 'Nearby' : 'Further away';
  }
  function whereText(area, hood) { area = area || ''; hood = hood || ''; if (!area) return hood || 'Area not given'; if (!hood || area.toLowerCase().indexOf(hood.toLowerCase()) >= 0) return area; return area + ' · ' + hood; }
  function validityPill(i) {
    if (i.resolved) return pill('Resolved', 'good');
    if (i.expired) return pill('Expired', 'warn');
    return pill('Active · ' + span(i.left) + ' left', i.left <= 10 ? 'warn' : 'neutral');
  }
  function sortCases(list) {
    var vh = myHood().id;
    return list.slice().sort(function (a, b) {
      function score(i) { return (i.urgent ? 4 : 0) + (vh && i.hoodId && M.nearby(vh, i.hoodId) ? 2 : 0) + (ui.filter.help[i.category] ? 1 : 0); }
      return score(b) - score(a) || b.st.packet.createdTick - a.st.packet.createdTick || (+b.id.slice(1)) - (+a.id.slice(1));
    });
  }

  function requestCard(i, opts) {
    opts = opts || {};
    var v = ui.viewer, view = M.requestView(v, i.id), own = view.author, photo = i.hasPhoto ? M.photoOf(v, i.id) : null, nb = nearbyLabel(i);
    var action = own ? 'View in activity' : (i.kind === 'missing' ? 'Share a lead' : 'I can help');
    var thumb = photo && photo.ready ? h('img', { class: 'thumb', src: photo.dataUrl, alt: 'Photo attached to this request' }) : null;
    var card = h('article', { class: 'card' + (own ? ' mine' : '') + (i.active ? '' : ' past'), 'data-rid': i.id, 'data-state': i.resolved ? 'resolved' : i.expired ? 'expired' : 'active' },
      h('div', { class: 'cardtop' }, h('div', { class: 'row' }, pill(catLabel(i), i.urgent ? 'urgent' : 'info'), i.renewed ? pill('Renewed', 'info') : null,
        (!own && i.active && ui.filter.help[i.category]) ? pill('Matches your skills', 'good') : null), h('span', { class: 'meta' }, age(i.r.createdTick))),
      h('div', { class: 'cardbody' }, thumb, h('div', { class: 'grow' }, h('h3', {}, i.title), i.desc ? h('p', { class: 'muted clamp' }, i.desc) : null)),
      h('div', { class: 'loc' }, icon('pin', 'sm'), h('span', {}, whereText(i.area, i.hoodName)), nb ? h('span', { class: 'pill ' + (nb === 'Nearby' ? 'good' : 'neutral') }, nb) : null),
      h('div', { class: 'row tags' }, validityPill(i),
        i.hasPhoto ? pill(photo && photo.ready ? 'Photo' : 'Photo on the way', 'neutral') : null, (i.hasPrivate && !own) ? pill('Exact address on request', 'neutral') : null,
        i.kind === 'missing' ? pill('Sighting reports unverified', 'neutral') : null),
      h('div', { class: 'meta small' }, own ? 'Your request' : 'Self-reported · Not verified'),
      h('div', { class: 'cardfoot' }, pill(view.label, view.tone === 'ok' ? 'good' : view.tone === 'warn' ? 'warn' : view.tone === 'info' ? 'info' : 'neutral'),
        (i.active || own) ? h('button', { class: 'link', 'aria-label': action + ': ' + i.title, on: { click: function (e) { e.stopPropagation(); if (own) { go('activity'); } else openRequest(i.id); } } }, action, icon('next', 'sm')) : null));
    card.addEventListener('click', function () { openRequest(i.id); });
    return card;
  }
  function updateCard(p) {
    var v = ui.viewer, own = p.originNodeId === v, pl = p.payload, left = Math.max(0, p.expiresTick - S().tick);
    var status = own ? (M.sentObserved(v, p.id) ? 'Shared with a nearby phone' : 'Saved on this phone') : null, nb = updateNearby(p);
    return h('article', { class: 'card' + (own ? ' mine' : ''), 'data-pid': p.id },
      h('div', { class: 'cardtop' }, pill(pl.category, 'info'), h('span', { class: 'meta' }, age(p.createdTick))),
      h('p', { style: 'margin:10px 0' }, pl.text),
      h('div', { class: 'loc' }, icon('pin', 'sm'), h('span', {}, whereText(pl.area, pl.hoodName)), nb ? h('span', { class: 'pill ' + (nb === 'Nearby' ? 'good' : 'neutral') }, nb) : null),
      h('div', { class: 'meta small' }, pl.category === 'Check-in' ? 'Self-reported' : 'Unverified community post', ' · relevant for ', span(left), ' more'),
      status ? h('div', { class: 'cardfoot' }, pill(status, 'info')) : null);
  }
  function updateNearby(p) {
    var vh = myHood().id, ph = p.payload.hood; if (!vh || !ph) return null;
    return M.nearby(vh, ph) ? 'Nearby' : 'Further away';
  }

  /* ---------- declared neighbourhood: onboarding, area sheet, gentle reminder ---------- */
  function persistArea() {
    if (NATIVE || ui.viewer !== S().keys.A) return;
    var n = viewerNode(); store('relay.area', { id: n.hood, name: n.hoodName });
  }
  function applyArea(id, custom) {
    M.setHood(ui.viewer, id === 'other' ? null : id, custom); persistArea(); ui.snooze[ui.viewer] = 0;
  }
  function screenOnboarding() {
    var st = { pick: null, other: '', err: '' };
    var el = h('div', { id: 'onboarding' });
    function draw() {
      clear(el);
      el.appendChild(h('h1', {}, 'Where are you right now?'));
      el.appendChild(h('p', { class: 'sub' }, 'No GPS needed. Pick your neighbourhood so nearby requests can find you and your requests can find help. You can change it any time.'));
      el.appendChild(h('div', { class: 'chips', role: 'group', 'aria-label': 'Neighbourhood', style: 'margin-bottom:12px' },
        M.NEIGHBORHOODS.map(function (n) { return h('button', { type: 'button', class: 'chip', 'data-hood': n.id, 'aria-pressed': String(st.pick === n.id), on: { click: function () { st.pick = n.id; st.err = ''; draw(); } } }, n.name); }),
        h('button', { type: 'button', class: 'chip', 'data-hood': 'other', 'aria-pressed': String(st.pick === 'other'), on: { click: function () { st.pick = 'other'; draw(); } } }, 'Somewhere else')));
      if (st.pick === 'other') {
        var inp = h('input', { id: 'ob-other', type: 'text', maxlength: '60', value: st.other, placeholder: 'Type your area or nearest landmark', 'aria-label': 'Your area' });
        inp.addEventListener('input', function () { st.other = inp.value; });
        el.appendChild(h('div', { class: 'field' }, inp, h('div', { class: 'help' }, 'Areas outside our short list still work for local feeds, but cannot help steer missing-person messages.')));
      }
      if (st.err) el.appendChild(h('div', { class: 'err', role: 'alert' }, st.err));
      el.appendChild(h('button', { class: 'btn primary block', id: 'ob-continue', on: { click: function () {
        if (!st.pick) { st.err = 'Choose where you are to continue.'; draw(); return; }
        if (st.pick === 'other' && !st.other.trim()) { st.err = 'Type your area, or pick one from the list.'; draw(); return; }
        applyArea(st.pick, st.other); ui.onboard = false; ui.screen = 'home'; render(true); toast('Area saved. Tap the area button at the top to change it.');
      } } }, 'Continue'));
      el.appendChild(h('p', { class: 'muted small', style: 'margin-top:14px' }, 'Your area stays on this phone. It is shared only as the area you choose to post from.'));
    }
    draw(); return el;
  }
  function openArea() {
    var st = { pick: null, other: '' };
    openSheet('Your area', function () {
      var hs = M.hoodState(ui.viewer), el = h('div', {});
      el.appendChild(h('p', {}, 'Currently: ', h('strong', {}, hs.name), ' · last confirmed ' + (hs.age <= 0 ? 'just now' : age(S().tick - hs.age))));
      if (!hs.reliable) el.appendChild(h('div', { class: 'note warn' }, 'This area may be out of date, so Relay treats it as unknown when steering missing-person messages. Confirm it or update it.'));
      el.appendChild(h('button', { class: 'btn primary block', id: 'area-confirm', on: { click: function () { M.confirmHood(ui.viewer); ui.snooze[ui.viewer] = 0; closeSheet(); render(); toast('Thanks. Area confirmed.'); } } }, 'Yes, I’m still in ' + hs.name));
      el.appendChild(h('div', { class: 'label', style: 'margin-top:16px' }, 'I’ve moved to…'));
      el.appendChild(h('div', { class: 'chips', role: 'group', 'aria-label': 'New area' },
        M.NEIGHBORHOODS.map(function (n) { return h('button', { type: 'button', class: 'chip', 'data-area': n.id, 'aria-pressed': String(st.pick === n.id), on: { click: function () { st.pick = n.id; refreshSheet(); } } }, n.name); }),
        h('button', { type: 'button', class: 'chip', 'data-area': 'other', 'aria-pressed': String(st.pick === 'other'), on: { click: function () { st.pick = 'other'; refreshSheet(); } } }, 'Somewhere else')));
      if (st.pick === 'other') { var inp = h('input', { id: 'area-other', type: 'text', maxlength: '60', value: st.other, placeholder: 'Type your area', style: 'margin-top:10px', 'aria-label': 'Your area' }); inp.addEventListener('input', function () { st.other = inp.value; }); el.appendChild(inp); }
      el.appendChild(h('button', { class: 'btn block', id: 'area-save', style: 'margin-top:12px', disabled: !st.pick, on: { click: function () {
        if (!st.pick || (st.pick === 'other' && !st.other.trim())) return; applyArea(st.pick, st.other); closeSheet(); render(); toast('Area updated.'); } } }, 'Update my area'));
      return el;
    });
  }
  function draftDirty() {
    var f = ui.form; if (!f) return false;
    return !!(f.text || f.where || f.who || f.desc || f.lastWhere || f.note || f.building || f.directions || f.photo || f.photoBusy);
  }
  function locationPrompt() {
    var v = ui.viewer, hs = M.hoodState(v);
    if (ui.onboard || ui.screen === 'request' || ui.done || ui.sheet || draftDirty()) return null;     // never interrupt someone making a request
    if (!hs.due || S().tick < (ui.snooze[v] || 0)) return null;
    return h('div', { class: 'locprompt', id: 'loc-prompt', role: 'group', 'aria-label': 'Confirm your area' },
      h('strong', {}, 'Are you still in ' + hs.name + '?'), h('span', { class: 'muted small' }, 'Confirming helps requests reach the right people.'),
      h('div', { class: 'stack' },
        h('button', { class: 'btn primary block', id: 'loc-yes', on: { click: function () { M.confirmHood(v); render(); toast('Thanks. Area confirmed.'); } } }, 'Yes, still here'),
        h('button', { class: 'btn block', id: 'loc-moved', on: { click: openArea } }, 'I’ve moved — Update area'),
        h('button', { class: 'btn block', id: 'loc-later', on: { click: function () { ui.snooze[v] = S().tick + 10; render(); } } }, 'Not now')));
  }

  /* ---------- Home ---------- */
  function screenHome() {
    var v = ui.viewer, peers = M.peers(v), el = h('div', {}), lp = locationPrompt();
    if (lp) el.appendChild(lp);
    el.appendChild(h('h1', {}, 'We’re here for each other.'));
    el.appendChild(h('p', { class: 'sub' }, 'No cellular signal? You can still reach participating people nearby as messages travel phone to phone.'));
    el.appendChild(NATIVE ? radioCard() : peers ? h('div', { class: 'relaycard' }, icon('signal'), h('div', {}, h('strong', {}, 'Local relay available'),
      h('span', {}, peers + ' nearby ' + (peers === 1 ? 'phone has' : 'phones have') + ' Relay. Your posts are saved on this phone first; delivery beyond nearby peers may take time.')))
      : h('div', { class: 'relaycard warn' }, icon('signal'), h('div', {}, h('strong', {}, 'No nearby Relay phones right now'),
        h('span', {}, 'Posts are saved on this phone and will move on when a phone with Relay comes within range.'))));
    el.appendChild(h('div', { class: 'ctas' },
      h('button', { class: 'cta blue', id: 'cta-request', on: { click: function () { go('request'); } } }, icon('alert', 'lg'), h('strong', {}, 'Request help'), h('span', { class: 'd' }, 'Find someone or request urgent assistance.')),
      h('button', { class: 'cta light', id: 'cta-help', on: { click: function () { ui.seg = 'requests'; go('feed'); } } }, icon('heart', 'lg'), h('strong', {}, 'Help others'), h('span', { class: 'd' }, 'See requests that reached your phone.'))));
    var cs = sortCases(casesFor(v).filter(function (i) { return i.active; }));
    var items = cs.map(function (i) { return { t: 'r', o: i, c: i.st.packet.createdTick, u: i.urgent }; })
      .concat(receivedUpdates(v).map(function (p) { return { t: 'u', o: p, c: p.createdTick, u: false }; }))
      .sort(function (a, b) { return (b.u - a.u) || b.c - a.c; }).slice(0, 3);
    el.appendChild(h('div', { class: 'sect' }, h('h2', {}, 'Received on this phone'), items.length ? h('button', { class: 'link', on: { click: function () { go('feed'); } } }, 'See feed', icon('next', 'sm')) : null));
    if (!items.length) el.appendChild(h('div', { class: 'empty' }, h('strong', {}, 'Nothing has reached this phone yet'),
      'Requests and updates appear here only after they travel from phone to phone to reach you.'));
    items.forEach(function (it) { el.appendChild(it.t === 'r' ? requestCard(it.o) : updateCard(it.o)); });
    el.appendChild(h('button', { class: 'btn block soft', id: 'btn-share', style: 'margin-top:6px', on: { click: openComposer } }, icon('mega'), 'Share an update with people nearby'));
    el.appendChild(h('p', { class: 'muted small', style: 'margin:18px 2px 0;text-align:center' }, NATIVE ? 'Messages move only when another phone with Relay is nearby. Nothing is guaranteed to arrive.' : 'Prototype: nearby phones and their messages are simulated.'));
    return el;
  }

  /* ---------- Photo: compressed entirely on this phone (canvas + JPEG) ---------- */
  var PHOTO = { target: 15000, dims: [360, 320, 288, 256, 224], quals: [0.72, 0.62, 0.52, 0.44] };
  function readAsDataUrl(blob) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = function () { rej(new Error('read')); }; fr.readAsDataURL(blob); }); }
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file could not be read as a picture.')); };
      img.onload = function () {
        URL.revokeObjectURL(url);
        var attempts = []; PHOTO.dims.forEach(function (d) { PHOTO.quals.forEach(function (q) { attempts.push([d, q]); }); });
        var last = null;
        function encode(i) {
          var d = attempts[i][0], q = attempts[i][1], sc = Math.min(1, d / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
          var w = Math.max(1, Math.round((img.naturalWidth || img.width) * sc)), hh = Math.max(1, Math.round((img.naturalHeight || img.height) * sc));
          var cv = document.createElement('canvas'); cv.width = w; cv.height = hh; var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, hh); cx.drawImage(img, 0, 0, w, hh);
          cv.toBlob(function (b) {
            if (!b) { reject(new Error('This browser could not compress the picture.')); return; }
            last = { blob: b, w: w, h: hh, q: q };
            if (b.size <= PHOTO.target || i === attempts.length - 1) {
              readAsDataUrl(b).then(function (u) { resolve({ dataUrl: u, bytes: b.size, w: w, h: hh, mime: 'image/jpeg', overTarget: b.size > PHOTO.target }); }, reject);
            } else encode(i + 1);
          }, 'image/jpeg', q);
        }
        encode(0);
      };
      img.src = url;
    });
  }
  UI.compressImage = compressImage;
  function kb(n) { return (n / 1024).toFixed(1) + ' KB'; }
  function photoField(f) {
    var box = h('div', { class: 'field', id: 'photo-field' }, h('span', { class: 'label' }, 'Photo (optional)'));
    var input = h('input', { type: 'file', id: 'photo-input', accept: 'image/*', class: 'sr', tabindex: '-1', 'aria-label': 'Choose a photo' });
    input.addEventListener('change', function () {
      var file = input.files && input.files[0]; if (!file) return;
      f.photoBusy = true; f.photoErr = ''; render();
      compressImage(file).then(function (p) { f.photo = p; f.photoBusy = false; render(); }, function (e) { f.photoBusy = false; f.photoErr = e.message; render(); });
    });
    box.appendChild(input);
    if (f.photoBusy) box.appendChild(h('div', { class: 'muted', id: 'photo-busy', role: 'status' }, 'Compressing on this phone…'));
    else if (f.photo) {
      box.appendChild(h('div', { class: 'photobox', id: 'photo-preview' }, h('img', { src: f.photo.dataUrl, alt: 'Selected photo preview' }),
        h('div', {}, h('strong', { id: 'photo-size' }, kb(f.photo.bytes)), h('div', { class: 'muted small' }, f.photo.w + '×' + f.photo.h + ' · compressed on this phone'),
          f.photo.overTarget ? h('div', { class: 'help' }, 'Kept a little over 15 KB so faces stay recognisable.') : null,
          h('div', { class: 'row', style: 'margin-top:8px' },
            h('button', { type: 'button', class: 'btn sm', id: 'photo-replace', on: { click: function () { input.click(); } } }, 'Replace'),
            h('button', { type: 'button', class: 'btn sm', id: 'photo-remove', on: { click: function () { f.photo = null; render(); } } }, 'Remove')))));
    } else box.appendChild(h('button', { type: 'button', class: 'btn block', id: 'photo-btn', on: { click: function () { input.click(); } } }, icon('image'), 'Add a photo'));
    box.appendChild(h('div', { class: 'help' }, 'Shrunk to about 10–15 KB on this phone so it can travel. It is sent after the text, and only if the network has room.'));
    if (f.photoErr) box.appendChild(h('div', { class: 'err', role: 'alert' }, f.photoErr));
    return box;
  }

  /* ---------- Request ---------- */
  function defaultHood() { var hs = myHood(); return hs.id || 'other'; }
  function newForm() {
    var d = defaultHood();
    return { mode: 'urgent', cat: 'Medical', text: '', hood: d, hoodOther: '', where: '', building: '', directions: '', addrOpen: false, urgency: 'urgent', validity: M.VALIDITY.urgentDefault,
      who: '', desc: '', lastHood: d, lastHoodOther: '', lastWhere: '', lastContact: 'Not sure', note: '', photo: null, photoBusy: false, photoErr: '', errors: {} };
  }
  function field(label, input, id, extra, err) {
    return h('div', { class: 'field' + (err ? ' bad' : '') }, h('label', { for: id }, label), input, extra ? h('div', { class: 'help' }, extra) : null,
      err ? h('div', { class: 'err', role: 'alert' }, err) : null);
  }
  function bind(el, key) { el.addEventListener('input', function () { ui.form[key] = el.value; }); return el; }
  function chipGroup(label, id, items, current, onPick, attr) {
    return h('div', { class: 'field' }, h('span', { class: 'label', id: id }, label),
      h('div', { class: 'chips', role: 'group', 'aria-labelledby': id }, items.map(function (it) {
        var a = { type: 'button', class: 'chip', 'aria-pressed': String(current === it[0]), on: { click: function () { onPick(it[0]); render(); } } }; a[attr] = it[0];
        return h('button', a, it[1]); })));
  }
  function screenRequest() {
    var f = ui.form, el = h('div', {});
    if (ui.done) return screenDone();
    el.appendChild(h('h1', {}, 'What do you need?'));
    el.appendChild(h('p', { class: 'sub' }, 'Tell people enough to help. You can add details later if someone responds.'));
    el.appendChild(h('div', { class: 'seg', role: 'group', 'aria-label': 'Request type' },
      h('button', { id: 'mode-urgent', 'aria-pressed': String(f.mode === 'urgent'), on: { click: function () { f.mode = 'urgent'; f.errors = {}; render(); } } }, icon('alert', 'sm'), 'Urgent assistance'),
      h('button', { id: 'mode-missing', 'aria-pressed': String(f.mode === 'missing'), on: { click: function () { f.mode = 'missing'; f.errors = {}; render(); } } }, icon('userplus', 'sm'), 'Find someone')));
    var form = h('form', { id: 'req-form', novalidate: true, on: { submit: submitRequest } });
    if (f.mode === 'urgent') {
      form.appendChild(chipGroup('Type of help', 'lbl-cat', [['Medical', 'Medical'], ['Rescue', 'Rescue'], ['Food & water', 'Food & water'], ['Shelter', 'Shelter'], ['Other', 'Other']], f.cat, function (c) { f.cat = c; }, 'data-cat'));
      form.appendChild(field('What is happening?', bind(h('textarea', { id: 'f-text', name: 'text', maxlength: '240', placeholder: 'Describe the situation in your own words. No diagnosis required.' }, f.text), 'text'), 'f-text', 'Short and specific is best.', f.errors.text));
      form.appendChild(h('div', { class: 'group' }, h('h2', { class: 'gh' }, 'Where is help needed?'),
        field('Neighbourhood', hoodSelect('f-hood', f.hood, function (v) { f.hood = v; render(); }, 'Somewhere else'), 'f-hood', null, f.errors.hood),
        f.hood === 'other' ? field('Which area?', bind(h('input', { id: 'f-hood-other', type: 'text', maxlength: '60', value: f.hoodOther, placeholder: 'Type the area' }), 'hoodOther'), 'f-hood-other', null, null) : null,
        field('Street or landmark', bind(h('input', { id: 'f-where', name: 'where', type: 'text', maxlength: '80', value: f.where, placeholder: 'e.g. Near the market gate, 2nd lane' }), 'where'), 'f-where', 'Used so volunteers can find the request. Shown to anyone who receives it.', f.errors.where),
        (function () {
          var d = h('details', { class: 'addr', id: 'addr-details' }, h('summary', {}, icon('pin', 'sm'), ' Exact address (kept private)'),
            h('div', { class: 'addr-body' },
              field('Building or apartment number', bind(h('input', { id: 'f-building', type: 'text', maxlength: '80', value: f.building, placeholder: 'e.g. Flat 4B, Block C' }), 'building'), 'f-building', null, null),
              field('Additional directions', bind(h('textarea', { id: 'f-directions', maxlength: '160', rows: '2', placeholder: 'e.g. Blue gate, 2nd floor, ring the bell twice' }, f.directions), 'directions'), 'f-directions', 'Not sent to everyone. You choose whether to share it with a volunteer who offers help.', null)));
          if (f.addrOpen) d.setAttribute('open', ''); d.addEventListener('toggle', function () { f.addrOpen = d.open; }); return d;
        })()));
      form.appendChild(chipGroup('Urgency', 'lbl-urg', [['urgent', 'Urgent'], ['general', 'General help']], f.urgency, function (u) { f.urgency = u; }, 'data-urg'));
      if (f.urgency === 'urgent') {
        form.appendChild(chipGroup('Keep this request active for', 'lbl-val', M.VALIDITY.urgentOptions.map(function (m) { return [m, m === 60 ? '1 hour' : m < 60 ? m + ' minutes' : (m / 60) + ' hours']; }), f.validity, function (m) { f.validity = m; }, 'data-validity'));
        form.appendChild(h('div', { class: 'help', style: 'margin:-8px 0 14px' }, 'After this it stops being passed along, so old emergencies don’t keep circulating. You can renew it from My activity.'));
      } else form.appendChild(h('div', { class: 'help', style: 'margin:-6px 0 14px' }, 'General help stays active for 6 hours. You can renew it from My activity.'));
    } else {
      form.appendChild(field('Who are you looking for?', bind(h('input', { id: 'f-who', name: 'who', type: 'text', maxlength: '80', value: f.who, placeholder: 'Name, and who they are to you' }), 'who'), 'f-who', null, f.errors.who));
      form.appendChild(field('Description or identifying details', bind(h('textarea', { id: 'f-desc', maxlength: '200', rows: '2', placeholder: 'Age, height, clothing, anything that helps someone recognise them' }, f.desc), 'desc'), 'f-desc', null, null));
      form.appendChild(h('div', { class: 'group' }, h('h2', { class: 'gh' }, 'Last known location'),
        field('Neighbourhood', hoodSelect('f-lasthood', f.lastHood, function (v) { f.lastHood = v; render(); }, 'Not sure / somewhere else'), 'f-lasthood', 'Used to steer your request toward that area.', null),
        f.lastHood === 'other' ? field('Which area?', bind(h('input', { id: 'f-lasthood-other', type: 'text', maxlength: '60', value: f.lastHoodOther, placeholder: 'Type the area, if you know it' }), 'lastHoodOther'), 'f-lasthood-other', null, null) : null,
        field('Street or landmark', bind(h('input', { id: 'f-lastwhere', name: 'lastWhere', type: 'text', maxlength: '80', value: f.lastWhere, placeholder: 'e.g. Station Road bus stop' }), 'lastWhere'), 'f-lastwhere', null, f.errors.lastWhere)));
      form.appendChild(field('Approximate last contact (optional)', (function () {
        var s = h('select', { id: 'f-contact', on: { change: function (e) { f.lastContact = e.target.value; } } }, ['Not sure', 'Within the last hour', 'Earlier today', 'Yesterday', 'More than a day ago'].map(function (o) { return h('option', { value: o }, o); })); s.value = f.lastContact; return s; })(), 'f-contact', null, null));
      form.appendChild(field('Short note (optional)', bind(h('textarea', { id: 'f-note', name: 'note', maxlength: '200', rows: '2', placeholder: 'Anything else that could help' }, f.note), 'note'), 'f-note', null, null));
      form.appendChild(photoField(f));
      form.appendChild(h('div', { class: 'help', style: 'margin:-6px 0 14px' }, 'Missing-person requests stay active for 24 hours. You can renew them or widen the search area from My activity.'));
    }
    form.appendChild(h('div', { class: 'note' }, 'Your request is saved on this phone first, then passed to nearby phones that have Relay. Saving is not the same as delivery, and nobody is dispatched automatically.'));
    form.appendChild(h('button', { class: 'btn primary block', id: 'req-submit', type: 'submit' }, 'Save request on this phone'));
    el.appendChild(form);
    if (!NATIVE) el.appendChild(h('button', { class: 'link', id: 'btn-example', style: 'margin-top:10px', on: { click: function () {
      if (f.mode === 'urgent') { f.cat = 'Medical'; f.text = 'My mother needs medical assistance. She is having trouble breathing.'; f.where = 'Near the market gate, 2nd lane'; f.urgency = 'urgent'; f.validity = 60; }
      else { f.who = 'Meera, my daughter, 8'; f.desc = 'Red school bag, blue uniform, short black hair.'; f.lastHood = 'CP'; f.lastWhere = 'Connaught Place, near the metro gate'; f.lastContact = 'Earlier today'; f.note = 'She was with her school group.'; }
      f.errors = {}; render(); } } }, 'Use a demo example'));
    return el;
  }
  function submitRequest(e) {
    e.preventDefault();
    var f = ui.form, er = {}, v = ui.viewer, res;
    function t(x) { return String(x || '').trim(); }
    if (f.mode === 'urgent') {
      if (t(f.text).length < 5) er.text = 'Please describe what is happening (at least a few words).';
      if (!t(f.where)) er.where = 'Add a street or landmark so someone can find you.';
      if (f.hood === 'other' && !t(f.hoodOther)) er.hood = 'Type the area, or pick one from the list.';
    } else {
      if (!t(f.who)) er.who = 'Tell us who you are looking for.';
      if (!t(f.lastWhere)) er.lastWhere = 'Add a street or landmark where they were last known to be.';
    }
    f.errors = er;
    if (Object.keys(er).length) { render(); var first = document.querySelector('.field.bad input, .field.bad textarea, .field.bad select'); if (first) first.focus(); return; }
    if (f.photoBusy) { toast('Hold on, the photo is still being compressed.'); return; }
    if (f.mode === 'urgent') {
      var d = t(f.text), w = t(f.where), ah = f.hood === 'other' ? null : f.hood, an = ah ? hoodName(ah) : t(f.hoodOther);
      var ttl = { Medical: 'Medical help needed', Rescue: 'Rescue needed', 'Food & water': 'Food and water needed', Shelter: 'Shelter needed', Other: 'Help needed' }[f.cat] + ' near ' + (w.length > 36 ? w.slice(0, 36) + '…' : w);
      var urgent = f.urgency === 'urgent';
      res = M.createRequest(v, { kind: 'urgent', category: f.cat, title: ttl, description: d, area: w, areaHood: ah, areaHoodName: an, urgent: urgent,
        validity: urgent ? f.validity : M.VALIDITY.general, privateAddress: (t(f.building) || t(f.directions)) ? { building: t(f.building), directions: t(f.directions) } : null });
    } else {
      var lh = f.lastHood === 'other' ? null : f.lastHood, ln = lh ? hoodName(lh) : t(f.lastHoodOther), lw = t(f.lastWhere);
      res = M.createRequest(v, { kind: 'missing', category: 'Missing', title: 'Looking for ' + t(f.who), description: t(f.desc), area: lw, areaHood: lh, areaHoodName: ln,
        lastKnown: lw + (ln ? ', ' + ln : ''), lastContact: f.lastContact === 'Not sure' ? '' : f.lastContact, note: t(f.note), urgent: false, validity: M.VALIDITY.missing, photo: f.photo || null });
    }
    if (!res.ok) { f.errors = { text: res.error }; render(); return; }
    ui.done = { rid: res.requestId, pid: res.packetId }; ui.form = newForm(); render();
  }
  function screenDone() {
    var cs = M.caseState(ui.viewer, ui.done.rid);   // may be missing for a moment if the state refresh has not landed yet: never crash on it
    return h('div', { class: 'donescreen' }, h('div', { class: 'ring' }, icon('check', 'lg')), h('h1', {}, 'Saved on this phone'),
      cs ? h('p', { class: 'sub' }, '“' + cs.payload.title + '”') : null,
      h('div', { class: 'note', style: 'text-align:left' }, 'Relay will pass it to nearby phones that have Relay. That can take time, and it may not reach everyone. ' + (cs ? 'It stays active for ' + span(cs.minutesLeft) + ', then stops being passed along. ' : '') + 'You can renew it from My activity.'),
      h('div', { class: 'stack' },
        h('button', { class: 'btn primary block', id: 'done-activity', on: { click: function () { ui.done = null; go('activity'); } } }, 'View in My activity'),
        h('button', { class: 'btn block', on: { click: function () { ui.done = null; render(); } } }, 'Make another request')));
  }

  /* ---------- Feed ---------- */
  function screenFeed() {
    var v = ui.viewer, el = h('div', {}), reqs = ui.seg === 'requests', lp = locationPrompt();
    if (lp) el.appendChild(lp);
    el.appendChild(h('h1', {}, reqs ? 'Help others' : 'Community updates'));
    el.appendChild(h('p', { class: 'sub' }, reqs ? 'Requests your phone has actually received. Respond where your time and abilities can make a difference.'
      : 'Short local updates received on this phone. Messages travel through the same offline relay network.'));
    el.appendChild(h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Feed' },
      h('button', { id: 'seg-requests', role: 'tab', 'aria-selected': String(reqs), on: { click: function () { ui.seg = 'requests'; render(); } } }, 'Help requests'),
      h('button', { id: 'seg-updates', role: 'tab', 'aria-selected': String(!reqs), on: { click: function () { ui.seg = 'updates'; render(); } } }, 'Community updates')));
    if (reqs) feedRequests(el, v); else feedUpdates(el, v);
    return el;
  }
  function feedRequests(el, v) {
    var all = casesFor(v), fl = ui.filter;
    el.appendChild(h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by type', style: 'margin-bottom:10px' },
      ['All', 'Medical', 'Rescue', 'Missing', 'Food & water', 'Shelter'].map(function (c) {
        return h('button', { class: 'chip', 'data-filter': c, 'aria-pressed': String(fl.cat === c), on: { click: function () { fl.cat = c; render(); } } }, c); })));
    var skills = Object.keys(fl.help).filter(function (k) { return fl.help[k]; });
    var det = h('details', { class: 'card', style: 'padding:0 14px' }, h('summary', { style: 'min-height:44px;display:flex;align-items:center;font-weight:700;cursor:pointer' }, 'Neighbourhood and abilities' + (fl.area !== 'All' || skills.length ? ' · active' : '')),
      h('div', { style: 'padding-bottom:12px' },
        h('div', { class: 'field' }, h('label', { for: 'f-area' }, 'Reported neighbourhood'), (function () {
          var s = h('select', { id: 'f-area', on: { change: function (e) { fl.area = e.target.value; render(); } } }, h('option', { value: 'All' }, 'All neighbourhoods'),
            M.NEIGHBORHOODS.map(function (n) { return h('option', { value: n.id }, n.name); })); s.value = fl.area; return s; })(),
          h('div', { class: 'help' }, 'Filters only change what you see here. Your phone still passes requests along, whatever you filter.')),
        h('div', { class: 'field', style: 'margin-bottom:0' }, h('span', { class: 'label', id: 'lbl-help' }, 'I can help with (optional)'),
          h('div', { class: 'chips', role: 'group', 'aria-labelledby': 'lbl-help' }, ['Medical', 'Rescue', 'Food & water', 'Shelter'].map(function (c) {
            return h('button', { class: 'chip', 'data-help': c, 'aria-pressed': String(!!fl.help[c]), on: { click: function () { fl.help[c] = !fl.help[c]; render(); } } }, c); })),
          h('div', { class: 'help' }, 'Self-described. Matching requests are listed first; nothing is verified.'))));
    if (fl.area !== 'All' || skills.length) det.setAttribute('open', '');
    el.appendChild(det);
    var fil = all.filter(function (i) { return (fl.cat === 'All' || reqFilterCat(i) === fl.cat) && (fl.area === 'All' || i.hoodId === fl.area); });
    var act = sortCases(fil.filter(function (i) { return i.active; })), past = fil.filter(function (i) { return !i.active; }).sort(function (a, b) { return b.st.packet.createdTick - a.st.packet.createdTick; });
    if (!all.length) el.appendChild(h('div', { class: 'empty', id: 'empty-requests' }, h('strong', {}, 'No requests received yet'),
      'Requests show up here only after they travel from phone to phone to reach you. Nothing is shown from phones you are not connected to.',
      h('div', { class: 'stack' }, h('button', { class: 'btn primary block', on: { click: function () { go('request'); } } }, 'Request help'))));
    else if (!fil.length) el.appendChild(h('div', { class: 'empty' }, h('strong', {}, 'No requests match these filters'),
      h('button', { class: 'btn', on: { click: function () { fl.cat = 'All'; fl.area = 'All'; fl.help = {}; render(); } } }, 'Clear filters')));
    else if (!act.length) el.appendChild(h('div', { class: 'empty', id: 'empty-active' }, h('strong', {}, 'No active requests right now'), 'Earlier requests are listed below.'));
    act.forEach(function (i) { el.appendChild(requestCard(i)); });
    if (past.length) {
      var d = h('details', { class: 'earlier', id: 'earlier' }, h('summary', {}, 'Expired or resolved (' + past.length + ')'));
      if (ui.earlierOpen) d.setAttribute('open', ''); d.addEventListener('toggle', function () { ui.earlierOpen = d.open; });
      past.forEach(function (i) { d.appendChild(requestCard(i)); }); el.appendChild(d);
    }
  }
  function feedUpdates(el, v) {
    el.appendChild(h('div', { class: 'card', style: 'background:#fafcff' }, h('div', { class: 'row' }, h('span', { class: 'mark', style: 'width:32px;height:32px;flex-basis:32px;border-radius:50%;font-size:12px;font-weight:800' }, 'ME'), h('strong', {}, 'Share with nearby people')),
      h('p', { class: 'muted', style: 'margin:8px 0' }, 'Text only, up to ' + M.MAX_BROADCAST + ' characters. Not a help request.'),
      h('button', { class: 'btn primary block', id: 'btn-post', on: { click: openComposer } }, icon('mega'), 'Post an update')));
    el.appendChild(h('div', { class: 'sect' }, h('h2', {}, 'Local timeline'), h('span', { class: 'meta' }, 'Recent and nearby first')));
    var vh = myHood().id, ups = receivedUpdates(v).sort(function (a, b) {
      function sc(p) { return vh && p.payload.hood && M.nearby(vh, p.payload.hood) ? 1 : 0; }
      return sc(b) - sc(a) || b.createdTick - a.createdTick || (+b.id.slice(1)) - (+a.id.slice(1));
    });
    if (!ups.length) el.appendChild(h('div', { class: 'empty', id: 'empty-updates' }, h('strong', {}, 'No community updates received yet'), 'Updates appear only after they travel to this phone. Urgent requests are always passed along first, and updates fade after 45 minutes.'));
    ups.forEach(function (p) { el.appendChild(updateCard(p)); });
  }
  function openComposer() {
    var st = { text: '', cat: 'Community', area: '', err: '' };
    openSheet('Post an update', function () {
      var ta = h('textarea', { id: 'c-text', maxlength: String(M.MAX_BROADCAST + 40), placeholder: 'e.g. Water collection point open near the market' }, st.text);
      var cnt = h('div', { class: 'counter', id: 'c-count' }, st.text.length + ' / ' + M.MAX_BROADCAST);
      ta.addEventListener('input', function () { st.text = ta.value; cnt.textContent = ta.value.length + ' / ' + M.MAX_BROADCAST; cnt.className = 'counter' + (ta.value.length > M.MAX_BROADCAST ? ' over' : ''); });
      var area = h('input', { id: 'c-area', type: 'text', maxlength: '60', value: st.area, placeholder: 'Street or landmark (optional)' });
      area.addEventListener('input', function () { st.area = area.value; });
      return h('form', { id: 'c-form', novalidate: true, on: { submit: function (e) {
        e.preventDefault();
        var res = M.createBroadcast(ui.viewer, { text: st.text, category: st.cat, area: st.area.trim() });
        if (!res.ok) { st.err = res.error; refreshSheet(); return; }
        closeSheet(); ui.screen = 'feed'; ui.seg = 'updates'; render(); toast('Saved on this phone. It reaches others only as it travels.');
      } } },
        h('div', { class: 'field' }, h('label', { for: 'c-text' }, 'What would you like to share?'), ta, cnt, st.err ? h('div', { class: 'err', role: 'alert' }, st.err) : null),
        h('div', { class: 'field' }, h('span', { class: 'label', id: 'lbl-bc' }, 'Category'), h('div', { class: 'chips', role: 'group', 'aria-labelledby': 'lbl-bc' },
          ['Community', 'Safety information', 'Resources', 'Check-in'].map(function (c) {
            return h('button', { type: 'button', class: 'chip', 'data-bc': c, 'aria-pressed': String(st.cat === c), on: { click: function () { st.cat = c; refreshSheet(); } } }, c); }))),
        h('div', { class: 'field' }, h('label', { for: 'c-area' }, 'Where in ' + (myHood().name || 'your area') + '?'), area),
        h('div', { class: 'note' }, 'Updates are unverified and may not reach everyone. They fade after 45 minutes, and urgent help requests always go first.'),
        h('button', { class: 'btn primary block', id: 'c-submit', type: 'submit' }, 'Save and share nearby'));
    });
  }

  /* ---------- Activity ---------- */
  function screenActivity() {
    var v = ui.viewer, el = h('div', {}), lp = locationPrompt();
    if (lp) el.appendChild(lp);
    el.appendChild(h('h1', {}, 'My activity'));
    el.appendChild(h('p', { class: 'sub' }, 'Updates depend on messages that have actually reached your phone.'));
    var cs = casesFor(v), mine = cs.filter(function (i) { return i.r.authorNodeId === v; }).sort(function (a, b) { return b.r.createdTick - a.r.createdTick || (+b.id.slice(1)) - (+a.id.slice(1)); });
    var sent = cs.filter(function (i) { return i.r.authorNodeId !== v && M.myReplies(v, i.id).length; }).reverse();
    var posts = M.receivedBroadcasts(v).filter(function (p) { return p.originNodeId === v; }).reverse();
    if (!mine.length && !sent.length && !posts.length) el.appendChild(h('div', { class: 'empty', id: 'empty-activity' }, h('strong', {}, 'No activity yet'), 'Requests, offers and updates you create on this phone appear here.',
      h('div', { class: 'stack' }, h('button', { class: 'btn primary block', on: { click: function () { go('request'); } } }, 'Request help'), h('button', { class: 'btn block', on: { click: function () { ui.seg = 'requests'; go('feed'); } } }, 'Help others'))));
    if (mine.length) el.appendChild(h('div', { class: 'sect' }, h('h2', {}, 'My requests')));
    mine.forEach(function (i) {
      var view = M.requestView(v, i.id), reps = M.repliesAt(v, i.id), shared = M.sentObserved(v, i.st.packet.id), res = i.resolved;
      var acked = reps.filter(function (p) { return M.ackedBy(v, p.id); }).length, canRenew = i.expired && !res;
      var steps = h('ul', { class: 'steps' },
        h('li', { class: 'done' }, h('span', { class: 'dot' }, ''), h('div', {}, 'Saved on your phone')),
        h('li', { class: shared ? 'done' : '' }, h('span', { class: 'dot' }, ''), h('div', {}, shared ? 'Shared with a nearby phone' : 'Not yet shared with a nearby phone', h('small', {}, shared ? 'Your phone handed it to a neighbour.' : (M.peers(v) ? 'Waiting for the next step.' : 'No nearby phone with Relay right now.')))),
        h('li', { class: reps.length ? 'done' : '' }, h('span', { class: 'dot' }, ''), h('div', {}, reps.length ? (reps.length === 1 ? 'An offer has arrived' : reps.length + ' offers have arrived') : 'No offer has reached this phone yet', reps.length ? h('small', {}, 'Unverified. Review it before acting.') : null)),
        reps.length ? h('li', { class: acked ? 'done' : '' }, h('span', { class: 'dot' }, ''), h('div', {}, acked ? 'You acknowledged an offer' : 'Not acknowledged yet')) : null,
        i.expired ? h('li', { class: 'done' }, h('span', { class: 'dot' }, ''), h('div', {}, 'Stopped being passed along', h('small', {}, 'Your original request stays here.'))) : null,
        i.renewed ? h('li', { class: 'done' }, h('span', { class: 'dot' }, ''), h('div', {}, 'Renewed ' + i.st.version + (i.st.version === 1 ? ' time' : ' times'), h('small', {}, 'Same case, updated details.'))) : null,
        res ? h('li', { class: 'done' }, h('span', { class: 'dot' }, ''), h('div', {}, 'Marked resolved on this phone')) : null);
      el.appendChild(h('article', { class: 'card' + (i.active ? '' : ' past'), 'data-rid': i.id }, h('div', { class: 'cardtop' }, pill(catLabel(i), i.urgent ? 'urgent' : 'info'), pill(view.label, view.tone === 'ok' ? 'good' : view.tone === 'warn' ? 'warn' : 'info')),
        h('h3', {}, i.title), h('div', { class: 'meta' }, icon('pin', 'sm'), h('span', {}, (i.area ? i.area + ' · ' : '') + i.hoodName + ' · Created ' + age(i.r.createdTick))),
        h('div', { class: 'row tags' }, validityPill(i)), steps,
        view.note ? h('div', { class: 'help', style: 'margin:0 0 8px' }, view.note) : null,
        h('div', { class: 'stack' },
          canRenew ? h('button', { class: 'btn primary block', 'data-act': 'renew', on: { click: function () { openRenew(i.id); } } }, icon('refresh', 'sm'), 'Renew request') : null,
          h('button', { class: 'btn ' + (reps.length && !acked ? 'primary' : 'soft') + ' block', on: { click: function () { openRequest(i.id); } } }, reps.length && !acked ? 'Review offer' : 'Open request'))));
    });
    if (sent.length) el.appendChild(h('div', { class: 'sect' }, h('h2', {}, 'Offers I sent')));
    sent.forEach(function (i) {
      var view = M.requestView(v, i.id);
      el.appendChild(h('article', { class: 'card' + (i.active ? '' : ' past'), 'data-rid': i.id }, h('div', { class: 'cardtop' }, pill(catLabel(i), i.urgent ? 'urgent' : 'info'), pill(view.label, view.tone === 'ok' ? 'good' : 'info')),
        h('h3', {}, i.title), h('div', { class: 'row tags' }, validityPill(i)), view.note ? h('div', { class: 'help' }, view.note) : null,
        h('button', { class: 'btn soft block', style: 'margin-top:10px', on: { click: function () { openRequest(i.id); } } }, 'Open request')));
    });
    if (posts.length) el.appendChild(h('div', { class: 'sect' }, h('h2', {}, 'My updates')));
    posts.forEach(function (p) { el.appendChild(updateCard(p)); });
    el.appendChild(h('div', { class: 'note' }, 'An offer is not proof that help has arrived, and a message marked as sent is not proof it was received.'));
    return el;
  }

  /* ---------- Request detail sheet ---------- */
  function openRequest(rid) {
    var r = S().requests[rid];
    openSheet(r.kind === 'missing' ? 'Missing person' : 'Request for help', function () { return requestSheet(rid); });
  }
  function drow(label, value) { return h('div', { class: 'drow' }, h('span', { class: 'dl' }, label), h('span', { class: 'dv' }, value)); }
  function requestSheet(rid) {
    var r = S().requests[rid], v = ui.viewer, cs = M.caseState(v, rid), el = h('div', {});
    if (!cs) return h('div', { class: 'empty' }, 'This request has not reached this phone.');
    var i = info({ id: rid, r: r, pkt: cs.packet, payload: cs.payload, state: cs }), view = M.requestView(v, rid), pl = cs.payload, resolved = cs.resolved;
    el.appendChild(h('div', { class: 'row' }, pill(catLabel(i), i.urgent ? 'urgent' : 'info'), validityPill(i), i.renewed ? pill('Renewed', 'info') : null, h('span', { class: 'meta' }, age(r.createdTick))));
    el.appendChild(h('h3', { style: 'font-size:19px' }, i.title));
    if (i.desc) el.appendChild(h('p', {}, i.desc));
    var photo = i.hasPhoto ? M.photoOf(v, rid) : null;
    if (photo && photo.ready) el.appendChild(h('figure', { class: 'bigphoto' }, h('img', { src: photo.dataUrl, alt: 'Photo shared with this request' }), h('figcaption', { class: 'muted small' }, 'Photo from the requester · ' + kb(photo.bytes) + ' · not verified')));
    else if (photo) el.appendChild(h('div', { class: 'note' }, 'A photo was attached. It travels after the text and has not reached this phone yet.'));
    var det = h('div', { class: 'details' });
    if (i.kind === 'missing') {
      det.appendChild(drow('Last known location', pl.lastKnown || ((i.area || '') + (i.hoodName ? ', ' + i.hoodName : ''))));
      det.appendChild(drow('Last contact', pl.lastContact || 'Not given'));
      det.appendChild(drow('Search area', pl.targets && pl.targets.length ? pl.targets.map(hoodName).join(', ') : 'Not specified (only a short search nearby)'));
      if (pl.note) det.appendChild(drow('Note', pl.note));
    } else {
      det.appendChild(drow('Where', whereText(i.area, i.hoodName)));
      var own = M.ownAddress(v, rid), shared = M.sharedAddressAt(v, rid);
      if (own) det.appendChild(drow('Exact address', 'Saved on this phone only. Share it with a volunteer from their offer below.'));
      else if (shared) det.appendChild(h('div', { class: 'addrbox' }, h('strong', {}, 'Exact address (shared with you by the requester)'), h('div', {}, shared.building || '—'), shared.directions ? h('div', { class: 'muted' }, shared.directions) : null, h('div', { class: 'help' }, 'Shared with you only. Please keep it private.')));
      else if (pl.hasPrivate) det.appendChild(drow('Exact address', 'Available. The requester can share it with a volunteer who offers help.'));
    }
    det.appendChild(drow('Posted', age(r.createdTick) + (i.renewed ? ' · renewed ' + age(cs.packet.createdTick) : '')));
    det.appendChild(drow('Status', i.resolved ? 'Resolved' : i.expired ? 'Expired. It is no longer being passed along.' : 'Active for ' + span(i.left) + ' more'));
    el.appendChild(det);
    el.appendChild(h('div', { class: 'meta small', style: 'margin:6px 0 12px' }, view.author ? 'Your request' : 'Self-reported · Not verified'));
    if (view.note) el.appendChild(h('div', { class: 'note' }, view.note));
    if (view.author) {
      var reps = M.repliesAt(v, rid);
      el.appendChild(h('h2', { style: 'margin-top:8px' }, reps.length ? 'Responses that reached this phone' : 'Responses'));
      if (!reps.length) el.appendChild(h('p', { class: 'muted' }, 'None yet. Responses appear only after they travel back to this phone.'));
      reps.forEach(function (p) {
        var pp = p.payload, acked = M.ackedBy(v, p.id), nr = S().local[v].notRelevant[p.id], hasAddr = !!M.ownAddress(v, rid), sharedAddr = M.addressSharedFor(v, p.id);
        var box = h('div', { class: 'offer', 'data-pid': p.id }, h('strong', {}, pp.kind === 'sighting' ? 'Possible sighting · Unverified' : 'Offer of help · Unverified'),
          h('p', { style: 'margin:6px 0' }, pp.note), pp.area ? h('div', { class: 'meta' }, icon('pin', 'sm'), h('span', {}, pp.area)) : null,
          h('div', { class: 'help' }, 'From a nearby volunteer' + (pp.fromHood ? ' in ' + pp.fromHood : '') + '; what they say about themselves is not verified. A response is not proof of safety or that help has arrived.'));
        if (acked) box.appendChild(h('div', { class: 'row', style: 'margin-top:8px' }, pill('Acknowledged on this phone', 'good'), h('span', { class: 'help', style: 'margin:0' }, 'The volunteer learns this only when it reaches their phone.')));
        else if (nr) box.appendChild(h('div', { class: 'help' }, 'Marked not relevant.'));
        else if (!resolved) box.appendChild(h('div', { class: 'row', style: 'margin-top:10px' },
          h('button', { class: 'btn primary sm', 'data-act': 'ack', on: { click: function () { var x = M.createAck(v, p.id); toast(x.ok ? 'Acknowledgment saved on this phone. It travels back when a path exists.' : x.error); render(); refreshSheet(); } } }, 'Acknowledge offer'),
          h('button', { class: 'btn sm', 'data-act': 'irrelevant', on: { click: function () { M.setNotRelevant(v, p.id); refreshSheet(); } } }, 'Not relevant')));
        if (hasAddr && !nr && pp.kind === 'offer') {
          if (sharedAddr) box.appendChild(h('div', { class: 'help', style: 'margin-top:8px' }, 'Exact address sent to this volunteer only. It travels back like any message.'));
          else box.appendChild(h('button', { class: 'btn soft block', style: 'margin-top:8px', 'data-act': 'share-address', on: { click: function () { var x = M.shareAddress(v, p.id); toast(x.ok ? 'Exact address shared with this volunteer only.' : x.error); refreshSheet(); } } }, 'Share my exact address with this volunteer'));
        }
        el.appendChild(box);
      });
      var stack = h('div', { class: 'stack', style: 'margin-top:14px' });
      if (!resolved) stack.appendChild(h('button', { class: 'btn ' + (i.expired ? 'primary' : '') + ' block', id: 'btn-renew', on: { click: function () { openRenew(rid); } } }, icon('refresh', 'sm'), i.expired ? 'Renew request' : (i.kind === 'missing' ? 'Update or widen search' : 'Update or renew')));
      if (!resolved) stack.appendChild(h('button', { class: 'btn block', id: 'btn-resolve', on: { click: function () { var x = M.createResolve(v, rid); toast(x.ok ? 'Marked resolved here. Other phones learn of it as the notice reaches them.' : x.error); render(); refreshSheet(); } } }, 'Mark as resolved'));
      el.appendChild(stack); if (!resolved) el.appendChild(h('div', { class: 'help' }, 'Only you can renew or resolve your request.'));
    } else {
      M.myReplies(v, rid).forEach(function (p) {
        var acks = M.acksAt(v, p.id);
        el.appendChild(h('div', { class: 'offer mine' }, h('strong', {}, p.payload.kind === 'sighting' ? 'Your possible sighting · Unverified' : 'Your offer · Unverified'), h('p', { style: 'margin:6px 0' }, p.payload.note),
          h('div', { class: 'help' }, acks.length ? 'The requester acknowledged this. That does not confirm anyone was helped.' : 'You will only be told if the requester acknowledges it.')));
      });
      if (!resolved && !i.expired) el.appendChild(replyForm(r, v));
      else if (resolved) el.appendChild(h('div', { class: 'note' }, 'The requester marked this resolved, so responses are closed.'));
      else el.appendChild(h('div', { class: 'note warn' }, 'This request has expired, so responses are closed. If the requester renews it, it will appear again.'));
      el.appendChild(h('button', { class: 'btn block', style: 'margin-top:10px', on: { click: function () { M.setHidden(v, rid); closeSheet(); render(); } } }, 'Hide this request'));
    }
    return el;
  }
  function replyForm(r, v) {
    var sight = r.kind === 'missing', st = replyForm.st && replyForm.st.rid === r.id && replyForm.st.v === v ? replyForm.st : (replyForm.st = { rid: r.id, v: v, note: '', area: '', err: '' });
    var ta = h('textarea', { id: 'r-note', maxlength: '240', placeholder: sight ? 'What did you see?' : 'e.g. I can walk you to the clinic gate in 10 minutes.' }, st.note);
    ta.addEventListener('input', function () { st.note = ta.value; });
    var ar = h('input', { id: 'r-area', type: 'text', maxlength: '80', value: st.area, placeholder: sight ? 'Where and when, roughly' : 'Suggested public meeting point (optional)' });
    ar.addEventListener('input', function () { st.area = ar.value; });
    return h('form', { id: 'r-form', novalidate: true, style: 'margin-top:14px', on: { submit: function (e) {
      e.preventDefault();
      var x = M.createReply(v, r.id, { kind: sight ? 'sighting' : 'offer', note: st.note, area: st.area });
      if (!x.ok) { st.err = x.error; refreshSheet(); return; }
      replyForm.st = null; toast('Saved on this phone. It travels back when a path exists.'); render(); refreshSheet();
    } } }, h('h2', {}, sight ? 'Share a possible sighting' : 'What can you actually offer?'),
      h('div', { class: 'field', style: 'margin-top:8px' }, h('label', { for: 'r-note', class: 'sr' }, sight ? 'What did you see?' : 'Your offer'), ta, st.err ? h('div', { class: 'err', role: 'alert' }, st.err) : null),
      h('div', { class: 'field' }, h('label', { for: 'r-area' }, sight ? 'Where and when' : 'Meeting point'), ar),
      h('div', { class: 'note' }, sight ? 'This is shared as a possible sighting, not confirmation. Relay never says someone is found or safe.' : 'Self-reported. Relay does not verify skills or identity, and nobody is dispatched automatically. Only offer what you can really do.'),
      h('button', { class: 'btn primary block', id: 'r-submit', type: 'submit' }, sight ? 'Share possible sighting' : 'Send offer'));
  }

  /* ---------- Renew / update ---------- */
  function openRenew(rid) {
    var r = S().requests[rid], cs = M.caseState(ui.viewer, rid), pl = cs.payload, missing = r.kind === 'missing';
    var st = { desc: pl.description || '', validity: pl.validity, targets: (pl.targets || []).slice(), err: '' };
    if (!M.VALIDITY.urgentOptions.some(function (m) { return m === st.validity; })) st.validity = M.VALIDITY.urgentDefault;
    openSheet(missing ? 'Update missing-person request' : 'Renew request', function () {
      var el = h('div', {});
      el.appendChild(h('p', { class: 'muted' }, 'This sends an updated version of the same request. Phones that already have it will show one card, not two.'));
      var ta = h('textarea', { id: 'rn-desc', maxlength: '240', rows: '3' }, st.desc); ta.addEventListener('input', function () { st.desc = ta.value; });
      el.appendChild(h('div', { class: 'field' }, h('label', { for: 'rn-desc' }, missing ? 'Description or new details' : 'What is happening now?'), ta));
      if (missing) {
        el.appendChild(h('div', { class: 'field' }, h('span', { class: 'label', id: 'lbl-rn' }, 'Search these neighbourhoods'),
          h('div', { class: 'chips', role: 'group', 'aria-labelledby': 'lbl-rn' }, M.NEIGHBORHOODS.map(function (n) {
            var on = st.targets.indexOf(n.id) >= 0;
            return h('button', { type: 'button', class: 'chip', 'data-target': n.id, 'aria-pressed': String(on), on: { click: function () { var k = st.targets.indexOf(n.id); if (k >= 0) st.targets.splice(k, 1); else st.targets.push(n.id); refreshSheet(); } } }, n.name); })),
          h('div', { class: 'help' }, 'Add places they might have gone. Your request is steered toward these areas first. Stays active for 24 hours from now.')));
      } else if (r.urgent) {
        el.appendChild(h('div', { class: 'field' }, h('span', { class: 'label', id: 'lbl-rnv' }, 'Keep active for'),
          h('div', { class: 'chips', role: 'group', 'aria-labelledby': 'lbl-rnv' }, M.VALIDITY.urgentOptions.map(function (m) {
            return h('button', { type: 'button', class: 'chip', 'data-validity': m, 'aria-pressed': String(st.validity === m), on: { click: function () { st.validity = m; refreshSheet(); } } }, m === 60 ? '1 hour' : m < 60 ? m + ' minutes' : (m / 60) + ' hours'); }))));
      } else el.appendChild(h('div', { class: 'help' }, 'General help stays active for 6 hours from now.'));
      if (st.err) el.appendChild(h('div', { class: 'err', role: 'alert' }, st.err));
      el.appendChild(h('button', { class: 'btn primary block', id: 'rn-submit', style: 'margin-top:12px', on: { click: function () {
        var patch = { description: st.desc.trim() || pl.description, validity: missing ? M.VALIDITY.missing : (r.urgent ? st.validity : M.VALIDITY.general) };
        if (missing) { patch.targets = st.targets; }
        var x = M.renewRequest(ui.viewer, rid, patch);
        if (!x.ok) { st.err = x.error; refreshSheet(); return; }
        closeSheet(); render(); toast('Renewed. It is going out again as an update to the same request.');
      } } }, missing ? 'Send updated request' : 'Renew request'));
      return el;
    });
  }

  /* ---------- Android: honest radio status (never simulated) ---------- */
  function radioState() {
    var r = NB.radio || {};
    if (r.bluetoothSupported === false) return { tone: 'warn', short: 'No Bluetooth LE', head: 'This phone cannot use Bluetooth LE', body: 'Relay cannot exchange messages on this phone. You can still write and read posts here.', action: null };
    if (!r.permissionsGranted) return { tone: 'warn', short: 'Relay radio off · tap', head: 'Relay radio is off', body: 'Allow nearby-device (Bluetooth) access so Relay can find phones around you. No internet, GPS or location is used.', action: ['Allow Bluetooth access', function () { NB.requestPermissions(); }] };
    if (!r.bluetoothEnabled) return { tone: 'warn', short: 'Bluetooth is off · tap', head: 'Bluetooth is off', body: 'Turn Bluetooth on so Relay can talk to phones nearby.', action: ['Turn on Bluetooth', function () { NB.enableBluetooth(); }] };
    if (!r.serviceRunning) return { tone: 'warn', short: 'Relay paused · tap', head: 'Relay is paused', body: 'Start Relay to look for nearby phones.', action: ['Start Relay', function () { NB.startRelay(); }] };
    var n = (r.recentPeers || []).length;
    if (n) return { tone: 'good', short: 'Phones seen nearby · ' + n, head: 'Phones with Relay seen nearby', body: n + ' seen in the last 2 minutes. Messages move only when a phone connects, and nothing is guaranteed to arrive.', action: null };
    return { tone: 'info', short: 'Looking for phones…', head: 'Looking for nearby phones', body: 'Your posts are saved on this phone and are passed on when another phone with Relay comes within range.' + (r.canAdvertise === false ? ' This phone can look for others but cannot be found by them.' : ''), action: null };
  }
  function radioChip() {
    var s = radioState();
    if (s.action) return h('button', { class: 'chipstat ' + s.tone, style: 'min-height:44px;border:0;cursor:pointer', on: { click: s.action[1] } }, icon('signal', 'sm'), s.short);
    return h('span', { class: 'chipstat ' + s.tone }, icon('signal', 'sm'), s.short);
  }
  function radioCard() {
    var s = radioState();
    return h('div', { class: 'relaycard' + (s.tone === 'good' ? '' : s.tone === 'info' ? '' : ' warn'), id: 'radio-card' }, icon('signal'), h('div', {}, h('strong', {}, s.head), h('span', {}, s.body),
      s.action ? h('button', { class: 'btn primary sm', id: 'radio-action', style: 'margin-top:8px', on: { click: s.action[1] } }, s.action[0]) : null));
  }
  function openAboutNative() {
    var shared = null;
    openSheet('About Relay', function () {
      var r = NB.radio || {}, el = h('div', {}), s = radioState();
      el.appendChild(h('p', {}, 'Relay helps neighbours ask for and offer help when cellular networks are down. Phones pass short messages directly to nearby phones that have Relay, over Bluetooth LE.'));
      el.appendChild(h('div', { class: 'note' }, h('strong', {}, 'No internet is used.'), ' This app has no internet permission. Messages are stored on this phone and passed on only when another phone with Relay is nearby. Delivery is never guaranteed.'));
      el.appendChild(h('div', { class: 'details', id: 'radio-details' },
        drow('Radio', s.head), drow('Bluetooth', r.bluetoothEnabled ? 'On' : 'Off'), drow('Permission', r.permissionsGranted ? 'Allowed' : 'Not allowed'),
        drow('Can be found by others', r.canAdvertise ? 'Yes' : 'No (can only look for others)'), drow('Phones seen (2 min)', String((r.recentPeers || []).length)),
        drow('Last exchange', r.lastContactMs ? age(Math.floor(r.lastContactMs / 60000)) : 'None yet'), drow('This phone', NB.me ? NB.me.slice(0, 8) : ''),
        r.lastError ? drow('Last problem', r.lastError) : null));
      var stack = h('div', { class: 'stack', style: 'margin-top:10px' });
      if (s.action) stack.appendChild(h('button', { class: 'btn primary block', id: 'about-action', on: { click: s.action[1] } }, s.action[0]));
      if (r.serviceRunning) stack.appendChild(h('button', { class: 'btn block', id: 'about-stop', on: { click: function () { NB.stopRelay(); } } }, 'Stop Relay'));
      stack.appendChild(h('button', { class: 'btn block', id: 'about-settings', on: { click: function () { NB.openSettings(); } } }, 'Open Android settings for Relay'));
      stack.appendChild(h('button', { class: 'btn soft block', id: 'about-share', on: { click: function () { shared = NB.shareApp(); refreshSheet(); } } }, 'Share this app with a nearby person'));
      el.appendChild(stack);
      if (shared) el.appendChild(h('div', { class: 'help', id: 'share-result' }, shared.ok ? 'Sharing opened. File check code (SHA-256): ' + shared.sha256 : (shared.error || 'Could not share')));
      el.appendChild(h('ul', { class: 'muted small', style: 'margin-top:14px' },
        h('li', {}, 'Offers, sightings and community updates are unverified.'),
        h('li', {}, 'Exact addresses are encrypted to the volunteer you choose; phones that carry the message cannot read them. This has not had an independent security review.'),
        h('li', {}, 'Relay may slow down or stop when the phone saves battery. Keep Relay on and the notification visible for best results.'),
        h('li', {}, 'Requests stay active for the time you choose; missing-person requests 24 hours; community updates 45 minutes.')));
      return el;
    });
  }

  /* ---------- About + prototype tools ---------- */
  var PERSONA_NAMES = { A: 'You (requester)', M: 'Volunteer · Green Park', S: 'Neighbour · Lajpat Nagar', L: 'Neighbour · Vasant Vihar', C: 'Volunteer · Safdarjung Enclave', E: 'Volunteer · Lodhi Colony' };
  function personaList() {
    var K = S().keys;
    return ['A', 'M', 'S', 'L', 'C', 'E'].map(function (k) { return { key: k, id: K[k], label: PERSONA_NAMES[k], area: S().nodes[K[k]].hoodName }; });
  }
  function setViewer(id) { ui.viewer = id; ui.done = null; ui.form = newForm(); lastSig = signature(); lastCounts = { v: id, c: counts(id) }; render(true); }
  function skipMinutes(n) { for (var i = 0; i < n; i++) M.step(); toast('Skipped ahead ' + n + ' minutes.'); afterTick(true); }
  function openAbout(showTools) {
    if (NATIVE) { openAboutNative(); return; }
    openSheet('About Relay', function () {
      var el = h('div', {});
      el.appendChild(h('p', {}, 'Relay helps neighbours ask for and offer help when cellular networks are down. Phones pass short messages to nearby phones that have Relay.'));
      el.appendChild(h('div', { class: 'note warn' }, h('strong', {}, 'This is a prototype.'), ' The nearby phones and their messages are simulated. Nothing here is sent over Bluetooth or reaches real emergency services. There is no GPS: you tell Relay your neighbourhood.'));
      el.appendChild(h('ul', { class: 'muted' }, h('li', {}, 'Emergency requests are passed in every direction, because we cannot know where a doctor or helper is.'),
        h('li', {}, 'Missing-person requests are steered toward the last known neighbourhood, with detours if the direct way is blocked.'),
        h('li', {}, 'Offers, sightings and community updates are unverified.'), h('li', {}, 'Saved is not shared, and shared is not received.'),
        h('li', {}, 'Urgent requests stay active for the time you choose (30 min, 1 h or 2 h); missing-person requests for 24 h; community updates for 45 min. You can renew a request.')));
      var det = h('details', { class: 'card', id: 'demo-tools', style: 'padding:0 14px' }, h('summary', { style: 'min-height:48px;display:flex;align-items:center;font-weight:700;cursor:pointer' }, 'Prototype tools (for reviewers)'),
        h('div', { style: 'padding-bottom:14px' },
          h('p', { class: 'muted small' }, 'Try the app as different people. Each phone only sees messages that have reached it.'),
          h('div', { class: 'label' }, 'Use the app as'),
          personaList().map(function (p) {
            return h('button', { class: 'persona', 'data-persona': p.key, 'aria-pressed': String(ui.viewer === p.id), on: { click: function () { setViewer(p.id); closeSheet(); } } },
              h('span', {}, h('strong', {}, p.label), h('small', {}, 'Declared area: ' + p.area)), ui.viewer === p.id ? icon('check') : null); }),
          h('div', { class: 'label', style: 'margin-top:12px' }, 'Time and nearby phones'),
          h('div', { class: 'stack' },
            h('button', { class: 'btn block', id: 'tool-auto', 'aria-pressed': String(ui.auto), on: { click: function () { ui.auto = !ui.auto; syncTimer(); refreshSheet(); } } }, ui.auto ? 'Pause message exchange' : 'Resume message exchange'),
            h('button', { class: 'btn block', id: 'tool-skip', on: { click: function () { skipMinutes(10); } } }, 'Skip ahead 10 minutes'),
            h('button', { class: 'btn block', id: 'tool-skip30', on: { click: function () { skipMinutes(30); } } }, 'Skip ahead 30 minutes'),
            h('button', { class: 'btn block', id: 'demo-reset', on: { click: function () { closeSheet(); resetDemo(); } } }, icon('reset'), 'Reset demo')),
          h('p', { class: 'muted small', style: 'margin-top:12px' }, 'Evaluators: the network behind this app is explained on a separate page, ', h('a', { href: 'simulator.html', id: 'sim-link' }, 'simulator.html'), ' (best on a laptop).')));
      if (showTools || ui.toolsOpen) det.setAttribute('open', '');
      det.addEventListener('toggle', function () { ui.toolsOpen = det.open; });
      el.appendChild(det);
      return el;
    });
  }

  /* ---------- seeded demo world + quiet transport ---------- */
  function samplePhoto() {
    try {
      var cv = document.createElement('canvas'); cv.width = 240; cv.height = 300; var c = cv.getContext('2d');
      var g = c.createLinearGradient(0, 0, 0, 300); g.addColorStop(0, '#dfe9f5'); g.addColorStop(1, '#b7c9de'); c.fillStyle = g; c.fillRect(0, 0, 240, 300);
      c.fillStyle = '#5b7391'; c.beginPath(); c.arc(120, 110, 52, 0, 7); c.fill(); c.beginPath(); c.ellipse(120, 270, 98, 90, 0, 0, 7); c.fill();
      var u = cv.toDataURL('image/jpeg', 0.6), bytes = Math.round((u.length - 23) * 0.75);
      return { dataUrl: u, bytes: bytes, w: 240, h: 300, mime: 'image/jpeg' };
    } catch (e) { return null; }
  }
  function seedWorld() {
    var K = S().keys; S().opts.evictExpired = true; S().opts.storageCap = 50;
    M.join(K.D, M.sharers(K.D)[0]);            // in this demo world the crossroads phone already runs Relay
    M.createRequest(K.S, { kind: 'urgent', category: 'Shelter', title: 'Shelter needed near Lajpat Nagar market', description: 'A family of four needs somewhere safe to stay tonight. Two small children.', area: 'Lajpat Nagar Central Market', areaHood: 'LN', urgent: false, validity: M.VALIDITY.general });
    M.createBroadcast(K.M, { text: 'Water is reportedly available near the Green Park market entrance. Bring containers if you can.', category: 'Resources', area: 'Green Park market' });
    M.createBroadcast(K.C, { text: 'People are gathering at the community hall in Safdarjung Enclave to share information and check on neighbours.', category: 'Community', area: 'Community hall' });
    M.createRequest(K.L, { kind: 'missing', category: 'Missing', title: 'Looking for Arjun, grey jacket', description: '34, glasses, grey jacket. Last heard from this morning.', area: 'Connaught Place, Block F', areaHood: 'CP',
      lastKnown: 'Connaught Place, Block F', lastContact: 'Earlier today', urgent: false, validity: M.VALIDITY.missing, photo: samplePhoto() });
    M.createBroadcast(K.E, { text: 'A temporary medical assistance point has been set up near the Lodhi Colony clinic gate.', category: 'Safety information', area: 'Clinic gate' });
    for (var i = 0; i < 16; i++) M.step();
    lastSig = signature();
  }
  var lastSig = '', pendingRender = false, timer = null, lastCounts = null;
  function signature() {
    var v = ui.viewer; if (!v) return '';
    var cs = casesFor(v);
    return [NATIVE ? Math.floor(S().tick / 3) : 0, Object.keys(S().inbox[v]).length, Object.keys(S().outbox[v]).length, M.hoodState(v).due ? 1 : 0, M.hoodState(v).reliable ? 1 : 0,
      cs.filter(function (i) { return i.expired; }).length, cs.filter(function (i) { return i.resolved; }).length, cs.filter(function (i) { return i.renewed; }).length].join(':');
  }
  function counts(v) {
    var o = { req: 0, bc: 0, rep: 0, ack: 0, res: 0, ownExp: 0 };
    Object.keys(S().inbox[v]).forEach(function (k) {
      var p = S().packets[k]; if (!p || p.originNodeId === v) return;
      if (p.type === 'request') o.req++; else if (p.type === 'broadcast') o.bc++; else if (p.type === 'reply') o.rep++; else if (p.type === 'ack') o.ack++; else if (p.type === 'resolve') o.res++;
    });
    casesFor(v).forEach(function (i) { if (i.r.authorNodeId === v && i.expired && !i.resolved) o.ownExp++; });
    return o;
  }
  function afterTick(force) {
    var sig = signature(), c = counts(ui.viewer);
    if (lastCounts && ui.viewer === lastCounts.v) {
      var p = lastCounts.c, msg = c.rep > p.rep ? 'A response reached your phone.' : c.ack > p.ack ? 'The requester acknowledged your offer.' : c.res > p.res ? 'A request you responded to was marked resolved.' :
        c.ownExp > p.ownExp ? 'Your request has expired. Renew it from My activity if you still need help.' : c.req > p.req ? 'A new request reached your phone.' : c.bc > p.bc ? 'A new community update reached your phone.' : '';
      if (msg) toast(msg);
    }
    lastCounts = { v: ui.viewer, c: c };
    if (force || sig !== lastSig) {
      lastSig = sig;
      var ae = document.activeElement;
      if (!force && ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) { pendingRender = true; return; }
      render();
    }
  }
  function scheduleTick(delay) {
    clearTimeout(timer); timer = null;
    if (!ui.auto || /[?&]manual/.test(location.search)) return;
    timer = setTimeout(function () { if (document.hidden) { scheduleTick(2000); return; } var moved = M.step(); afterTick(false); scheduleTick(moved > 0 ? 1500 : 8000); }, delay);   // quiet clock slows while nothing is moving
  }
  function syncTimer() { scheduleTick(1500); }
  document.addEventListener('focusout', function () { if (pendingRender) { pendingRender = false; setTimeout(function () { var ae = document.activeElement; if (!ae || !/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) render(); }, 0); } });

  /* ---------- navigation / shell ---------- */
  function go(screen) { ui.screen = screen; ui.done = null; render(true); }
  function applyStoredArea() {
    var st = load('relay.area'), A = S().keys.A;
    if (st) { M.setHood(A, st.id, st.name); return true; }
    return false;
  }
  function resetDemo() {
    var keepArea = load('relay.area');
    M.reset(); ui.viewer = S().keys.A; ui.done = null; ui.form = newForm(); ui.filter = { cat: 'All', area: 'All', help: {} }; ui.screen = 'home'; ui.seg = 'requests'; ui.snooze = {}; ui.earlierOpen = false; replyForm.st = null;
    seedWorld(); if (keepArea) applyStoredArea(); ui.form = newForm(); lastCounts = null; render(true); toast('Demo reset.');
  }
  UI.go = go; UI.resetDemo = resetDemo; UI.step = function (n) { for (var i = 0; i < (n || 1); i++) M.step(); afterTick(true); };

  function renderTop() {
    var v = ui.viewer, peers = M.peers(v), sr = $('statusrow'); clear(sr);
    sr.appendChild(h('span', { class: 'chipstat bad' }, 'Cellular unavailable'));
    if (NATIVE) sr.appendChild(radioChip()); else sr.appendChild(peers ? h('span', { class: 'chipstat good' }, icon('signal', 'sm'), 'Local relay · ' + peers + ' nearby') : h('span', { class: 'chipstat warn' }, icon('signal', 'sm'), 'No nearby Relay phones'));
    var hs = M.hoodState(v), ab = $('area-chip'); clear(ab);
    ab.appendChild(icon('pin', 'sm')); ab.appendChild(h('span', { class: 'an' }, hs.name)); if (!hs.reliable) ab.appendChild(h('span', { class: 'dotwarn', title: 'Area may be out of date' }, '!'));
    ab.setAttribute('aria-label', 'Your area: ' + hs.name + (hs.reliable ? '' : ', may be out of date') + '. Tap to confirm or change.'); ab.className = 'areabtn' + (hs.reliable ? '' : ' stale');
    var vw = $('viewing'), vn = viewerNode();
    vw.hidden = ui.viewer === S().keys.A; clear(vw);
    if (!vw.hidden) vw.appendChild(document.createTextNode('Prototype · using the app as ' + PERSONA_NAMES[vn.key] + ' · tap to change'));
  }
  function renderNav() {
    var defs = [['home', 'Home', 'home'], ['request', 'Request', 'plus'], ['feed', 'Feed', 'heart'], ['activity', 'My activity', 'list']];
    document.querySelectorAll('[data-nav]').forEach(function (b) {
      var d = defs.filter(function (x) { return x[0] === b.getAttribute('data-nav'); })[0]; clear(b);
      b.appendChild(icon(d[2])); b.appendChild(document.createTextNode(d[1]));
      if (ui.screen === d[0]) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }
  var lastScreen = null;
  function render(scrollTop) {
    document.body.classList.toggle('onboarding', !!ui.onboard);
    renderTop(); renderNav();
    var sc = $('screen'), y = sc.scrollTop, key = (ui.onboard ? 'ob' : ui.screen + ui.seg);
    clear(sc);
    sc.appendChild(ui.onboard ? screenOnboarding() : { home: screenHome, request: screenRequest, feed: screenFeed, activity: screenActivity }[ui.screen]());
    sc.scrollTop = (scrollTop || key !== lastScreen) ? 0 : y; lastScreen = key;
    if (ui.sheet) refreshSheet();
  }
  UI.render = render;

  UI.start = function () {
    if (NATIVE) { NB.refresh(); ui.viewer = S().keys.A; ui.onboard = !NB.hoodSet; ui.form = newForm(); ui.auto = false; }
    else { ui.viewer = S().keys.A; seedWorld(); ui.onboard = !applyStoredArea(); ui.form = newForm(); ui.auto = true; }
    $('btn-info').appendChild(icon('info')); $('sheet-close').appendChild(icon('x'));
    document.querySelector('.mark').appendChild(icon('signal'));
    $('btn-info').addEventListener('click', function () { openAbout(false); }); $('viewing').addEventListener('click', function () { openAbout(true); });
    $('area-chip').addEventListener('click', function () { if (!ui.onboard) openArea(); });
    $('sheet-close').addEventListener('click', closeSheet); $('backdrop').addEventListener('click', closeSheet);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ui.sheet) closeSheet(); });
    document.querySelectorAll('[data-nav]').forEach(function (b) { b.addEventListener('click', function () { go(b.getAttribute('data-nav')); }); });
    lastCounts = { v: ui.viewer, c: counts(ui.viewer) };
    render(true);
    if (NATIVE) setInterval(function () { if (window.__relayChanged) window.__relayChanged(); }, 30000); else syncTimer();
  };
  UI.nativeChanged = function () { afterTick(false); };
})();
