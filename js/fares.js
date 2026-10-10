/* Fares: maps/<id>/fares.json — an independent file, decoupled from the map's own stations/lines/map.json. Front-end
   only reads it (navigator.html); it is edited only by the local dev server's fare editor (dev/fares-editor.js),
   never in the browser. Data is always Station–Station pairs, keyed by the two stations' representative ids
   (store.rep), sorted so "A|B" and "B|A" are the same entry; a per-line fare is just this editor's own shortcut for
   writing the same flat amount onto every pair of real stops on that line — never a distinct storage shape.

   Fare types (optional): a map can sell more than one kind of ticket — a token, a stored-value card, a concession —
   listed in "types", first one the default: [{ id, name, factor?, transferFee? }]. A pair's value is then either one
   number (the same fare for every type, times that type's factor if it has one) or an object of amounts by type id;
   a type missing from that object costs its factor times the first type's amount, or is unpriced if it has no
   factor. A type's own transferFee replaces its network's (or the map-wide) one.

   Networks (optional): lines run by different operators can be grouped — [{ id, name, lines: [line ids], types,
   transferFee? }] — each with its own fare types, and the traveller picks a type per network. A ride is priced with
   the type picked for its own line's network; lines in no network use the top-level "types" (or one implicit type).
   Type ids are unique across the whole file, so a pair's per-type object is never ambiguous.

   Services (optional): a service of services.json can have fares of its own — "servicePairs": { service id: { "A|B":
   value, … } }, the same pair keys and values as above. A ride on that service between two stations it has a fare for
   costs that, as one ticket of its own (priced with the types of its line's network); any other pair falls back to the
   ordinary fares above. */
(function (TM) {
  const fares = (TM.fares = { data: null, loaded: false });
  const blank = () => ({ currency: '', transferMinutes: 0, transferFee: 0, networks: [], types: [], pairs: {}, servicePairs: {} });
  const round2dp = TM.round2dp;
  const amount = (v) => v !== null && v !== undefined && v !== '' && isFinite(v) && +v >= 0;
  const ID_OK = /^[a-z0-9][a-z0-9_-]{0,31}$/;
  const IMPLICIT = { id: 'standard', name: 'Standard' };

  fares.key = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  /* Every pair of real, non-fantasy stations a line calls at (its own rep ids) — used by the "whole line" way of
     entering a fare: pick a line and an amount, and this loop is what actually writes it, one Station–Station pair
     at a time, exactly as if each pair had been typed in on its own. Fantasy stops are left out, same as routing;
     a hidden (provisional / under-construction / abandoned / demolished) station can still be choose to display*/
  fares.pairsForLine = (line) => {
    const store = TM.store, reps = [];
    (line.path || []).forEach((item) => {
      if (!item.s || !store.stations.has(item.s)) return;
      const station = store.stations.get(item.s);
      if (station.status === 'fantasy') return;
      const leadId = store.rep(item.s);
      if (!reps.includes(leadId)) reps.push(leadId);
    });
    const out = [];
    for (let i = 0; i < reps.length; i++) for (let j = i + 1; j < reps.length; j++) out.push([reps[i], reps[j]]);
    return out;
  };

  fares.load = async (meta) => {
    fares.data = blank(); fares.loaded = false;
    if (!meta || meta.kind !== 'files') { fares.loaded = true; fares.sel = {}; return fares.data; }   // a browser-made map ships no files, so no fares either
    try {
      const j = await TM.getJSON(`maps/${meta.id}/fares.json`);
      if (j && typeof j === 'object') {
        const used = new Set();
        fares.data = {
          currency: typeof j.currency === 'string' ? j.currency : '',
          transferMinutes: isFinite(j.transferMinutes) && j.transferMinutes >= 0 ? +j.transferMinutes : 0,
          transferFee: isFinite(j.transferFee) && j.transferFee >= 0 ? +j.transferFee : 0,
          networks: fares.normNetworks(j.networks, used),
          types: fares.normTypes(j.types, used),
          pairs: fares.normPairs(j.pairs, used),
          servicePairs: {},
        };
        if (j.servicePairs && typeof j.servicePairs === 'object') Object.entries(j.servicePairs).forEach(([serviceId, table]) => {
          const pairs = fares.normPairs(table, used);
          if (Object.keys(pairs).length) fares.data.servicePairs[serviceId] = pairs;
        });
      }
    } catch (e) { /* no fares.json for this map — treated as empty */ }
    fares.loaded = true;
    fares.sel = {};
    return fares.data;
  };

  /* a table of pair fares as stored, cleaned: "A|B" → one amount, or amounts by fare type id (used: every type id of the file) */
  fares.normPairs = (raw, used) => {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.entries(raw).forEach(([pairKey, value]) => {
      if (!/^[^|]+\|[^|]+$/.test(pairKey)) return;
      if (typeof value === 'number') { if (amount(value)) out[pairKey] = round2dp(value); return; }
      if (!value || typeof value !== 'object') return;
      const amounts = {};
      Object.entries(value).forEach(([t, a]) => { if (used.has(t) && amount(a)) amounts[t] = round2dp(+a); });
      if (Object.keys(amounts).length) out[pairKey] = amounts;
    });
    return out;
  };

  /* used: type ids already taken elsewhere in the file (a repeat is dropped) */
  fares.normTypes = (raw, used) => {
    const out = [], seen = used || new Set();
    (Array.isArray(raw) ? raw : []).forEach((type) => {
      if (!type || !ID_OK.test(String(type.id)) || seen.has(type.id)) return;
      seen.add(type.id);
      const result = { id: String(type.id), name: String(type.name || type.id).slice(0, 40) };
      if (amount(type.factor)) result.factor = +type.factor;
      if (amount(type.transferFee)) result.transferFee = +type.transferFee;
      if (type.note && String(type.note).trim()) result.note = String(type.note).trim().slice(0, 160);   // shown under the type's name in the planner
      out.push(result);
    });
    return out;
  };
  fares.normNetworks = (raw, used) => {
    const out = [], seen = new Set(), taken = new Set();
    (Array.isArray(raw) ? raw : []).forEach((network) => {
      if (!network || !ID_OK.test(String(network.id)) || seen.has(network.id)) return;
      seen.add(network.id);
      const result = { id: String(network.id), name: String(network.name || network.id).slice(0, 40), lines: [], types: fares.normTypes(network.types, used) };
      (Array.isArray(network.lines) ? network.lines : []).forEach((l) => { if (typeof l === 'string' && !taken.has(l)) { taken.add(l); result.lines.push(l); } });   // a line belongs to one network
      if (amount(network.transferFee)) result.transferFee = +network.transferFee;
      out.push(result);
    });
    return out;
  };

  /* ---- networks ---- */
  /* every network, then the lines in none of them ('' — priced with the top-level types) */
  const OTHER = () => ({ id: '', name: 'Other lines', lines: null, types: fares.data ? fares.data.types : [] });
  fares.networks = () => [...(fares.data ? fares.data.networks : []), OTHER()];
  fares.network = (id) => fares.networks().find((n) => n.id === (id || '')) || OTHER();
  /* a branch ("CCL~db") is in its line's network */
  fares.networkOf = (lineId) => { const id = String(lineId).split('~')[0]; return (fares.data && fares.data.networks.find((n) => n.lines.includes(id))) || OTHER(); };
  /* the networks whose fare type a traveller can pick: those selling more than one, and only if some line uses them */
  fares.pickable = () => fares.networks().filter((n) => n.types.length > 1 && (n.id || TM.store && [...TM.store.lines.keys()].some((l) => !fares.data.networks.some((x) => x.lines.includes(l)))));

  /* ---- fare types, per network ---- */
  fares.sel = {};   // network id -> the type the traveller picked
  fares.types = (net) => { const types = fares.network(net).types; return types.length ? types : [IMPLICIT]; };
  fares.typeOf = (net, id) => fares.types(net).find((t) => t.id === id) || fares.types(net)[0];
  fares.selected = (net) => fares.typeOf(net, fares.sel[net || '']).id;
  fares.setType = (net, id) => { fares.sel[net || ''] = fares.typeOf(net, id).id; };
  const scaled = (v, t) => (t.factor == null ? v : round2dp(v * t.factor));
  /* one stored pair value, priced for one network's type (its picked one unless `type` is given) */
  fares.priceFor = (value, networkId, type) => {
    const fareType = fares.typeOf(networkId, type || fares.selected(networkId)), defaultType = fares.types(networkId)[0];
    if (typeof value === 'number') return scaled(value, fareType);
    if (!value || typeof value !== 'object') return null;
    if (amount(value[fareType.id])) return value[fareType.id];
    return fareType.factor != null && amount(value[defaultType.id]) ? scaled(value[defaultType.id], fareType) : null;
  };
  /* the transfer fee for boarding a ride of this network: its picked type's own, else the network's, else the map's */
  fares.transferFee = (networkId) => {
    const type = fares.typeOf(networkId, fares.selected(networkId)), network = fares.network(networkId);
    return type.transferFee != null ? type.transferFee : network.transferFee != null ? network.transferFee : (fares.data ? fares.data.transferFee : 0);
  };

  /* The fare for one ride, boarding at repA and alighting at repB (direction does not matter), on a line of network
     `net`, for the type picked there — or null when unpriced. */
  fares.get = (stationA, stationB, networkId) => {
    if (!fares.data) return null;   // a === b is a same-station in-out ("A|A")
    const value = fares.data.pairs[fares.key(stationA, stationB)];
    return value == null ? null : fares.priceFor(value, networkId);
  };
  /* the same on a service that has a fare of its own for that pair — null when it has none (the ordinary fare then applies) */
  fares.getOwn = (stationA, stationB, networkId, serviceId) => {
    const table = fares.data && fares.data.servicePairs[serviceId], value = table && table[fares.key(stationA, stationB)];
    return value == null ? null : fares.priceFor(value, networkId);
  };
  /* Every pair of the stations a service calls at (its own rep ids), for entering one fare for them all. */
  fares.pairsForService = (service) => {
    const store = TM.store, run = TM.route.runTimes(service), reps = [];
    (run ? run.fwd.rows : []).forEach((row) => { if (!row.calls) return; const leadId = store.rep(row.id); if (!reps.includes(leadId)) reps.push(leadId); });
    const out = [];
    for (let i = 0; i < reps.length; i++) for (let j = i + 1; j < reps.length; j++) out.push([reps[i], reps[j]]);
    return out;
  };
  /* does the map price anything at all, with the types picked? */
  fares.hasAny = () => !!fares.data && [...Object.values(fares.data.pairs), ...Object.values(fares.data.servicePairs).flatMap((t) => Object.values(t))].some((v) => fares.networks().some((n) => fares.priceFor(v, n.id) != null));
  fares.fmt = (v) => (v == null ? '—' : `${fares.data && fares.data.currency ? fares.data.currency + ' ' : ''}${v.toFixed(2)}`);
})(window.TM);
