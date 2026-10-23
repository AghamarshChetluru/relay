/* Recording fake of the Android JavascriptInterface for browser tests ONLY. It serves REAL snapshots produced by the Kotlin engine
   (android/app/build/fixtures/ui_fixtures.js). It simulates nothing about radios or peers. */
(function () {
  var q = new URLSearchParams(location.search); var FIX = window.__FIX;
  window.__cur = q.get('fx') || 'empty_new_phone'; window.__radioFx = q.get('radio') || null; window.__calls = []; window.__nextResult = null;
  window.__fx = function (name) { window.__cur = name; };
  function snap() { var s = JSON.parse(JSON.stringify(FIX.snapshots[window.__cur])); if (window.__radioFx) s.radio = JSON.parse(JSON.stringify(FIX.snapshots[window.__radioFx])).radio; return JSON.stringify(s); }
  function rec(n, a) { window.__calls.push([n].concat([].slice.call(a))); }
  function res(def) { return JSON.stringify(window.__nextResult || def); }
  var okR = { ok: true, error: null, caseId: 'c'.repeat(32), packetId: 'f'.repeat(32) };
  window.RelayAndroid = {
    snapshot: function () { return snap(); },
    createRequest: function (j) { rec('createRequest', arguments); return res(okR); }, renewRequest: function (c, j) { rec('renewRequest', arguments); return res(okR); },
    createReply: function (c, k, n, a) { rec('createReply', arguments); return res(okR); }, createAck: function (r) { rec('createAck', arguments); return res(okR); },
    createResolve: function (c) { rec('createResolve', arguments); return res(okR); }, createBroadcast: function (j) { rec('createBroadcast', arguments); return res(okR); },
    shareAddress: function (r) { rec('shareAddress', arguments); return res(okR); }, setHood: function (i, n) { rec('setHood', arguments); return res(okR); },
    confirmHood: function () { rec('confirmHood', arguments); return res(okR); }, hide: function (c) { rec('hide', arguments); return res(okR); }, notRelevant: function (p) { rec('notRelevant', arguments); return res(okR); },
    attachment: function (id) { rec('attachment', arguments); return window.__drawnImage || FIX.attachments[id] || ''; },
    requestPermissions: function () { rec('requestPermissions', arguments); }, requestEnableBluetooth: function () { rec('requestEnableBluetooth', arguments); },
    openAppSettings: function () { rec('openAppSettings', arguments); }, startRelay: function () { rec('startRelay', arguments); }, stopRelay: function () { rec('stopRelay', arguments); },
    shareDiagnostics: function () { rec("shareDiagnostics", arguments); return JSON.stringify({ ok: true, error: null }); },
    shareApp: function () { rec('shareApp', arguments); return JSON.stringify({ ok: true, sha256: 'ab'.repeat(32), bytes: 3271955, error: null }); }
  };
})();
