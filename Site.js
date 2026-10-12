/**
 * site.js — musique continue + navigation sans rechargement + préchargement
 *
 * Principe : le document n'est jamais rechargé. On intercepte les clics sur les
 * liens internes, on récupère la page suivante (déjà en cache mémoire grâce au
 * préchargement), puis on remplace <body> et les <style>. L'objet Audio vit dans
 * ce script : il n'est donc jamais interrompu.
 */
(() => {
    'use strict';

    // Garde-fou : ne jamais s'initialiser deux fois dans le même document
    if (window.__siteLoaded) return;
    window.__siteLoaded = true;

    /* ------------------------------------------------------------------ *
     * Configuration
     * ------------------------------------------------------------------ */
    const MUSIC  = 'omerAdam.mp3';   // attention : la casse compte sur un hébergeur Linux
    const KEY    = 'musique-on';     // sessionStorage : '1' = active, '0' = coupée par l'invité
    const PAGES  = ['index.html', 'menu.html', 'mairie.html', 'soiree.html', 'formulaire.html'];
    const IMAGES = ['fond1.png', 'fond2.png', 'fond3.png'];

    /* ------------------------------------------------------------------ *
     * Musique
     * ------------------------------------------------------------------ */
    const audio = new Audio(MUSIC);
    audio.loop = true;
    audio.volume = 0.4;
    audio.preload = 'auto';

    const style = document.createElement('style');
    style.setAttribute('data-persist', ''); // jamais retiré lors d'un changement de page
    style.textContent = `
    .music-toggle{position:fixed;right:14px;bottom:14px;z-index:9999;width:44px;height:44px;
      border-radius:50%;border:1px solid rgba(255,255,255,.85);background:rgba(255,255,255,.65);
      backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);color:#C66A4A;font-size:20px;
      line-height:1;cursor:pointer;box-shadow:0 5px 18px rgba(198,106,74,.2)}
    .music-toggle.off{opacity:.7}
    .music-toggle.off::after{content:"";position:absolute;left:9px;top:21px;width:26px;height:2px;
      background:#C66A4A;transform:rotate(-45deg)}`;
    document.head.append(style);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'music-toggle off';
    btn.textContent = '♪';
    btn.setAttribute('aria-label', 'Activer ou couper la musique');
    btn.setAttribute('aria-pressed', 'false');

    const setUI = on => {
        btn.classList.toggle('off', !on);
        btn.setAttribute('aria-pressed', String(on));
    };

    const start = () => audio.play()
        .then(() => { sessionStorage.setItem(KEY, '1'); setUI(true); })
        .catch(() => setUI(false)); // autoplay refusé ou fichier introuvable : on reste en "off"

    const stop = () => {
        audio.pause();
        sessionStorage.setItem(KEY, '0');
        setUI(false);
    };

    btn.addEventListener('click', () => (audio.paused ? start() : stop()));

    /* ------------------------------------------------------------------ *
     * Cache des pages (HTML brut, en mémoire) + navigation
     * ------------------------------------------------------------------ */
    const cache = new Map();
    const keyOf = url => new URL(url, location.href).pathname;

    async function getHTML(url) {
        const k = keyOf(url);
        if (cache.has(k)) return cache.get(k);
        const res = await fetch(url, { headers: { Accept: 'text/html' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const html = await res.text();
        cache.set(k, html);
        return html;
    }

    function swap(doc) {
        document.title = doc.title;

        // Styles propres à la page : on ajoute les nouveaux AVANT de retirer les anciens (pas de flash)
        const oldStyles = [...document.head.querySelectorAll('style:not([data-persist])')];
        doc.head.querySelectorAll('style').forEach(s => document.head.append(s.cloneNode(true)));
        doc.head.querySelectorAll('link[rel="stylesheet"]').forEach(l => {
            const known = [...document.head.querySelectorAll('link[rel="stylesheet"]')]
                .some(x => x.href === l.href);
            if (!known) document.head.append(l.cloneNode(true));
        });
        oldStyles.forEach(s => s.remove());

        const body = document.adoptNode(doc.body);

        // Les <script> issus de DOMParser ne s'exécutent pas : on les recrée
        body.querySelectorAll('script').forEach(old => {
            const s = document.createElement('script');
            [...old.attributes].forEach(a => s.setAttribute(a.name, a.value));
            s.textContent = old.textContent;
            old.replaceWith(s);
        });

        document.body.replaceWith(body);
        document.body.append(btn);
    }

    async function go(url, push = true) {
        try {
            const html = await getHTML(url);
            swap(new DOMParser().parseFromString(html, 'text/html'));
            if (push) history.pushState({}, '', url);
            window.scrollTo(0, 0);
        } catch {
            location.href = url; // repli : navigation classique (la musique se coupe, mais le site marche)
        }
    }

    // Utilisable par les scripts de page (ex. redirection après l'envoi du formulaire)
    window.siteGo = url => go(new URL(url, location.href).href);

    document.addEventListener('click', e => {
        const a = e.target.closest('a[href]');
        if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

        const u = new URL(a.href, location.href);
        if (u.origin !== location.origin || !/\.html?$/.test(u.pathname) || a.target === '_blank') return;

        // Ce clic est un geste utilisateur : seul moment où le navigateur autorise play()
        if (sessionStorage.getItem(KEY) !== '0' && audio.paused) start();

        e.preventDefault();
        go(u.href);
    });

    addEventListener('popstate', () => go(location.href, false));

    /* ------------------------------------------------------------------ *
     * Préchargement (après le chargement initial, en tâche de fond)
     * ------------------------------------------------------------------ */
    const keep = []; // références conservées pour éviter que le cache d'images soit libéré

    function preloadImage(src) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = img.onerror = resolve;
            img.src = src;
            keep.push(img);
        });
    }

    async function preloadAll() {
        // Séquentiel et non bloquant : on ne concurrence pas le téléchargement de la musique
        for (const src of IMAGES) await preloadImage(src);
        for (const page of PAGES) {
            try { await getHTML(page); } catch { /* page absente : sans conséquence */ }
        }
    }

    const idle = window.requestIdleCallback || (fn => setTimeout(fn, 300));
    const kickoff = () => idle(preloadAll);
    if (document.readyState === 'complete') kickoff();
    else addEventListener('load', kickoff, { once: true });

    /* ------------------------------------------------------------------ *
     * Initialisation
     * ------------------------------------------------------------------ */
    document.body.append(btn);
    if (sessionStorage.getItem(KEY) === '1') start(); // rechargement : tentative de reprise
})();