/**
 * Animations des pages publiques. Tout est décoratif : sans ce script la page est complète et lisible, et rien ne
 * bouge quand le visiteur a demandé moins de mouvement. Aucune dépendance, aucun script en ligne (politique de
 * sécurité du contenu).
 */
(function () {
  "use strict";
  var root = document.documentElement;
  var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var canObserve = "IntersectionObserver" in window;
  root.classList.add("has-motion");

  function all(selector, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(selector)); }
  function inViewport(element) { return element.getBoundingClientRect().top < window.innerHeight * 0.92; }

  /* ---- Barre d'action mobile : seulement une fois le haut de page dépassé ; ombre de l'en-tête au défilement ---- */
  var stickyCta = document.querySelector(".sticky-cta");
  var header = document.querySelector(".top");
  var hero = document.querySelector(".hero");
  var ticking = false;
  function onScroll() {
    ticking = false;
    var y = window.scrollY || window.pageYOffset;
    if (header) header.classList.toggle("is-scrolled", y > 24);
    if (stickyCta) stickyCta.classList.toggle("is-visible", !hero || y > hero.offsetHeight * 0.55);
  }
  window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  onScroll();

  /* ---- Lien du menu correspondant à la section affichée ---- */
  var navLinks = all('.top-links a[href^="#"]');
  if (canObserve && navLinks.length) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        navLinks.forEach(function (link) { link.classList.toggle("is-active", link.getAttribute("href") === "#" + entry.target.id); });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    navLinks.forEach(function (link) {
      var section = document.getElementById(link.getAttribute("href").slice(1));
      if (section) spy.observe(section);
    });
  }

  if (reducedMotion || !canObserve) return;

  /* ---- Apparition au défilement ----
     Seuls les éléments encore hors écran sont masqués : ce qui est déjà visible ne clignote jamais. */
  var revealSelector = [
    "main .head", "main section > .wrap > .kicker", "main section > .wrap > h2", "main section > .wrap > .sub",
    ".stat", ".pain", ".pain-solution", ".step", ".tabs", ".benefit-cards .card", ".feature-details > summary",
    ".help-note", ".marquee", ".plan", ".note", ".faq-side", ".faq details", ".final", ".foot > *",
  ].join(",");
  var revealer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("rv-in");
      revealer.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  all(revealSelector).forEach(function (element) {
    if (element.closest(".tab-panel") || inViewport(element)) return;
    // Les éléments d'un même groupe (cartes, étapes, questions) arrivent en léger décalage.
    var siblings = element.parentElement ? Array.prototype.filter.call(element.parentElement.children, function (child) { return child.matches(revealSelector); }) : [];
    var index = Math.max(0, siblings.indexOf(element));
    element.style.setProperty("--d", Math.min(index, 6) * 80 + "ms");
    element.classList.add("rv");
    revealer.observe(element);
  });

  /* ---- Éléments qui s'animent eux-mêmes une fois à l'écran (trait des étapes, écran du tableau de bord) ---- */
  var watcher = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("in");
      watcher.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -18% 0px", threshold: 0.15 });
  all(".steps--line, .shots").forEach(function (element) {
    if (inViewport(element) && element.getBoundingClientRect().bottom < window.innerHeight) return;
    element.classList.add("watch");
    watcher.observe(element);
  });

  /* ---- Compteurs : le nombre monte jusqu'à sa valeur quand il devient visible ---- */
  var counters = all("[data-count]");
  if (counters.length) {
    var counterObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        counterObserver.unobserve(entry.target);
        var target = parseInt(entry.target.getAttribute("data-count"), 10);
        if (!target) return;
        var startedAt = null;
        var duration = 1100;
        entry.target.textContent = "0";
        requestAnimationFrame(function step(now) {
          if (startedAt === null) startedAt = now;
          var progress = Math.min(1, (now - startedAt) / duration);
          var eased = 1 - Math.pow(1 - progress, 3);
          entry.target.textContent = String(Math.round(target * eased));
          if (progress < 1) requestAnimationFrame(step);
        });
      });
    }, { threshold: 0.6 });
    counters.forEach(function (counter) { counterObserver.observe(counter); });
  }

  /* ---- Conversation du haut de page : jouée en boucle, avec « en train d'écrire… » avant chaque réponse ---- */
  all("[data-chat-loop]").forEach(function (phone) {
    var chat = phone.querySelector(".chat");
    if (!chat) return;
    var items = Array.prototype.slice.call(chat.children);
    var timers = [];
    var visible = false;
    var running = false;
    // La hauteur est figée pour que le téléphone ne change pas de taille pendant que les bulles arrivent.
    chat.style.minHeight = chat.offsetHeight + "px";
    phone.classList.add("chat-live");

    function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
    function reset() {
      all(".typing", chat).forEach(function (dots) { dots.remove(); });
      items.forEach(function (item) { item.classList.remove("is-shown"); item.classList.add("is-waiting"); });
      chat.classList.remove("is-clearing");
    }
    function show(item) { item.classList.remove("is-waiting"); item.classList.add("is-shown"); }
    function play() {
      if (!visible) { running = false; return; }
      running = true;
      reset();
      var at = 500;
      items.forEach(function (item) {
        if (item.classList.contains("out")) {
          // L'assistant « écrit » un instant avant que sa réponse apparaisse.
          later(function () {
            var dots = document.createElement("div");
            dots.className = "b out typing is-shown";
            dots.innerHTML = "<i></i><i></i><i></i>";
            chat.insertBefore(dots, item);
          }, at);
          at += 1300;
          later(function () { all(".typing", chat).forEach(function (dots) { dots.remove(); }); show(item); }, at);
          at += 1300;
        } else {
          later(function () { show(item); }, at);
          at += item.classList.contains("done") ? 900 : 1100;
        }
      });
      later(function () { chat.classList.add("is-clearing"); }, at + 4200);
      later(play, at + 4800);
    }
    function stop() { timers.forEach(clearTimeout); timers = []; running = false; }

    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible && !running) play();
      if (!visible && running) { stop(); items.forEach(show); chat.classList.remove("is-clearing"); all(".typing", chat).forEach(function (dots) { dots.remove(); }); }
    }, { threshold: 0.35 }).observe(phone);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop(); else if (visible && !running) play();
    });
  });

  /* ---- Bandeau défilant : la liste est répétée pour boucler sans raccord visible ---- */
  all("[data-marquee]").forEach(function (marquee) {
    var track = marquee.firstElementChild;
    if (!track || !track.children.length) return;
    var originals = Array.prototype.slice.call(track.children);
    marquee.classList.add("is-running");
    var setWidth = track.scrollWidth || 1;
    var repeats = Math.ceil(window.innerWidth / setWidth) + 1;
    function append(hidden) {
      originals.forEach(function (item) {
        var clone = item.cloneNode(true);
        if (hidden) clone.setAttribute("aria-hidden", "true");
        track.appendChild(clone);
      });
    }
    for (var i = 1; i < repeats; i += 1) append(true);
    for (var j = 0; j < repeats; j += 1) append(true);
    marquee.style.setProperty("--marquee-time", Math.round((setWidth * repeats) / 42) + "s");
  });

  /* ---- Halo qui suit le pointeur sur les cartes (souris uniquement) ---- */
  if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    document.addEventListener("pointermove", function (event) {
      var card = event.target.closest && event.target.closest(".card, .plan");
      if (!card) return;
      var box = card.getBoundingClientRect();
      card.style.setProperty("--mx", event.clientX - box.left + "px");
      card.style.setProperty("--my", event.clientY - box.top + "px");
    }, { passive: true });
  }
})();
