/* Label icons and other pictures, inlined as data-URIs so SVG/PNG export works. Two libraries are read together:
   the shared one — images/ at the site's root, offered to every map (images/index.json lists it) — and the map's own,
   maps/<id>/images/ (its optional index.json lists what is offered; any other file there still works by name). A map's
   own file wins over a shared one of the same name. A map made in the browser keeps its own pictures in localStorage
   instead (see maps.js). */
(function (TM) {
  TM.images = new Map();      // file -> data URI, both libraries
  TM.imageList = [];          // [{file, name}] — the shared library, offered in the main icon picker
  TM.mapImageList = [];       // [{file, name}] — the open map's own library, offered separately
  TM.ownImageFiles = new Set();   // the files of TM.images that belong to the map itself (what an export of it carries)

  TM.toDataURI = async (url, file) => {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(url + ' → ' + response.status);
    if (/\.svg$/i.test(file)) return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(await response.text());
    const blob = await response.blob();
    return new Promise((res, rej) => { const reader = new FileReader(); reader.onload = () => res(reader.result); reader.onerror = rej; reader.readAsDataURL(blob); });
  };

  /* A picture named in a label, annotation or legend: a file name, or a path inside the images/ folder of the shared
     library or of the map (an old "special/" prefix is dropped). */
  const SAFE = /^(?!.*\.\.)[\w\-. /]+\.(svg|png|jpe?g|gif|webp)$/i;
  TM.safeImagePath = (f) => SAFE.test(String(f || ''));
  TM.iconPath = (raw) => {
    const file = String(raw || '').trim().replace(/^\/+/, '').replace(/^(maps\/[^/]+\/)?(data\/)?images\//, '').replace(/^special\//, '');
    return SAFE.test(file) ? file : null;
  };
  const pending = new Map();
  /* by name: the map's own folder first, then the shared one */
  TM.loadImage = (file) => {
    if (TM.images.has(file)) return Promise.resolve(true);
    if (!SAFE.test(file)) return Promise.resolve(false);
    if (!pending.has(file)) {
      const own = TM.maps.isUser(TM.maps.current) ? Promise.reject(new Error('no folder')) : TM.toDataURI(TM.maps.dir() + 'images/' + file, file).then((u) => { TM.ownImageFiles.add(file); return u; });
      pending.set(file, own.catch(() => TM.toDataURI('images/' + file, file)).then((u) => { TM.images.set(file, u); return true; }).catch(() => false).finally(() => pending.delete(file)));
    }
    return pending.get(file);
  };
  /* A line's own picture (line.image): a file of the map's images/ folder, or a picture uploaded into the line itself
     (a data: URI). Returns its data URI, or null while it loads / when there is none. */
  TM.lineImage = (line) => {
    const image = line && line.image;
    if (!image) return null;
    if (/^data:image\//.test(image)) return image;
    if (TM.images.has(image)) return TM.images.get(image);
    TM.loadImage(image).then((ok) => { if (ok) TM.emit('display'); });
    return null;
  };
  /* width / height of a picture (data URI), once the browser has measured it — null until then (a redraw follows) */
  const aspects = new Map();
  TM.imageAspect = (uri) => {
    if (!uri) return null;
    if (aspects.has(uri)) return aspects.get(uri);
    aspects.set(uri, null);
    if (typeof Image !== 'undefined') { const img = new Image(); img.onload = () => { if (img.naturalWidth && img.naturalHeight) { aspects.set(uri, img.naturalWidth / img.naturalHeight); TM.emit('display'); } }; img.src = uri; }
    return null;
  };
  TM.isMapIcon = (file) => !TM.imageList.some((im) => im.file === file);
  /* every picture on offer, for pickers that take any: the shared library first, then the map's own, each in alphabetical order (both lists are kept sorted) */
  TM.imageChoices = () => [...TM.imageList, ...TM.mapImageList.filter((m) => !TM.imageList.some((c) => c.file === m.file))];   // the shared ones first, then the map's own, each by name

  /* Reads one index.json: { file, name }[] resolved against base, skipping any that fail to load. */
  const readIndex = async (base, indexUrl, prefix) => {
    const images = new Map(), list = [];
    try {
      const index = await TM.getJSON(indexUrl);
      await Promise.all((index.files || []).map(async (entry) => {
        const raw = typeof entry === 'string' ? { file: entry, name: entry.replace(/\.[^.]+$/, '') } : entry;
        const e = { file: prefix + raw.file, name: raw.name || raw.file.replace(/\.[^.]+$/, '') };
        try { images.set(e.file, await TM.toDataURI(base + raw.file, e.file)); list.push(e); } catch (err) { /* skip missing file */ }
      }));
      list.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) { /* this index is optional */ }
    return { images, list };
  };

  /* The own library of a published map folder (base = 'maps/<id>/images/'): { images: Map(file -> data URI), list } —
     list is its images/index.json. Pictures named by the given lines but not listed (typed in by hand) are included
     in images too, when the map has them. */
  TM.readImageLib = async (base, lines) => {
    const own = await readIndex(base, base + 'index.json', '');
    const wanted = new Set();
    (lines || []).forEach((l) => (l.path || []).forEach((it) => ((it && it.label && it.label.icons) || []).forEach((f) => wanted.add(f))));
    await Promise.all([...wanted].filter((f) => !own.images.has(f) && SAFE.test(f)).map(async (f) => { try { own.images.set(f, await TM.toDataURI(base + f, f)); } catch (e) { /* not the map's own */ } }));
    return { images: own.images, list: own.list };
  };

  TM.loadImages = async () => {
    const maps = TM.maps, meta = maps.current;
    TM.images.clear(); TM.imageList.length = 0; TM.mapImageList.length = 0; TM.ownImageFiles.clear();
    const common = await readIndex('images/', 'images/index.json', '');
    common.images.forEach((u, f) => TM.images.set(f, u));
    common.list.forEach((e) => TM.imageList.push(e));
    if (maps.isUser(meta)) {
      const own = maps.readImages(meta);
      Object.entries(own.files).forEach(([f, u]) => { TM.images.set(f, u); TM.ownImageFiles.add(f); });
      own.list.forEach((e) => TM.mapImageList.push(e));
    } else {
      const own = await TM.readImageLib(maps.dir(meta) + 'images/', [...TM.store.lines.values()]);
      own.images.forEach((u, f) => { TM.images.set(f, u); TM.ownImageFiles.add(f); });
      own.list.forEach((e) => TM.mapImageList.push(e));
      const wanted = new Set();   // named by hand and in neither index: the shared folder may have it
      TM.store.lines.forEach((l) => l.path.forEach((it) => ((it && it.label && it.label.icons) || []).forEach((f) => wanted.add(f))));
      await Promise.all([...wanted].map((f) => TM.loadImage(f)));
    }
    TM.imageList.sort((a, b) => a.name.localeCompare(b.name));
    TM.mapImageList.sort((a, b) => a.name.localeCompare(b.name));
  };
})(window.TM);
