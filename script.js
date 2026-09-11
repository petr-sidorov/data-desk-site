(function () {
  "use strict";

  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Header shadow on scroll ---------- */
  var header = document.getElementById("site-header");

  function onScroll() {
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Mobile menu ---------- */
  var burger = document.getElementById("burger");
  var nav = document.getElementById("main-nav");

  function setMenu(open) {
    nav.classList.toggle("is-open", open);
    burger.classList.toggle("is-open", open);
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute("aria-label", open ? "Закрыть меню" : "Открыть меню");
  }

  burger.addEventListener("click", function () {
    setMenu(!nav.classList.contains("is-open"));
  });

  nav.addEventListener("click", function (e) {
    if (e.target.closest("a")) setMenu(false);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && nav.classList.contains("is-open")) {
      setMenu(false);
      burger.focus();
    }
  });

  document.addEventListener("click", function (e) {
    if (nav.classList.contains("is-open") && !e.target.closest(".site-header")) {
      setMenu(false);
    }
  });

  /* ---------- Scrollspy ---------- */
  var navLinks = Array.prototype.slice.call(document.querySelectorAll(".main-nav__link"));
  var sections = navLinks
    .map(function (link) {
      return document.querySelector(link.getAttribute("href"));
    })
    .filter(Boolean);

  if ("IntersectionObserver" in window && sections.length) {
    var spy = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          navLinks.forEach(function (link) {
            link.classList.toggle(
              "is-active",
              link.getAttribute("href") === "#" + entry.target.id
            );
          });
        });
      },
      { rootMargin: "-40% 0px -55% 0px" }
    );
    sections.forEach(function (s) {
      spy.observe(s);
    });
  }

  /* ---------- Reveal on scroll ---------- */
  var revealEls = Array.prototype.slice.call(document.querySelectorAll("[data-reveal]"));

  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) {
      el.classList.add("is-revealed");
    });
  } else {
    revealEls.forEach(function (el) {
      var parent = el.parentElement;
      if (!parent) return;
      var siblings = Array.prototype.slice.call(
        parent.querySelectorAll(":scope > [data-reveal]")
      );
      var idx = siblings.indexOf(el);
      if (idx > 0) el.style.setProperty("--reveal-delay", Math.min(idx * 0.08, 0.4) + "s");
    });

    var revealer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-revealed");
            revealer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
    );

    revealEls.forEach(function (el) {
      revealer.observe(el);
    });
  }

  /* ---------- Footer year ---------- */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ---------- Contact form ---------- */
  var form = document.getElementById("contact-form");

  if (form) {
    var tsField = document.getElementById("cf-ts");
    var statusEl = document.getElementById("cf-status");
    var submitBtn = document.getElementById("cf-submit");

    if (tsField) tsField.value = String(Date.now());

    function setStatus(type, text) {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.classList.toggle("is-success", type === "success");
      statusEl.classList.toggle("is-error", type === "error");
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var contact = (form.elements.contact.value || "").trim();
      var message = (form.elements.message.value || "").trim();

      if (!contact || !message) {
        setStatus("error", "Заполните обязательные поля: контакт для ответа и описание задачи.");
        return;
      }

      var payload = {
        name: (form.elements.name.value || "").trim(),
        company: (form.elements.company.value || "").trim(),
        contact: contact,
        message: message,
        website: form.elements.website.value || "",
        ts: tsField ? Number(tsField.value) : 0
      };

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Отправка…";
      }
      setStatus("", "");

      fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          return res.json()
            .catch(function () { return {}; })
            .then(function (data) { return { ok: res.ok, data: data }; });
        })
        .then(function (result) {
          if (result.ok && result.data.ok) {
            setStatus("success", result.data.message || "Заявка отправлена. Спасибо!");
            form.reset();
            if (tsField) tsField.value = String(Date.now());
          } else {
            setStatus("error", result.data.error || "Не удалось отправить заявку. Попробуйте ещё раз.");
          }
        })
        .catch(function () {
          setStatus("error", "Не удалось отправить заявку. Попробуйте ещё раз.");
        })
        .then(function () {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Отправить заявку";
          }
        });
    });
  }
})();


