/*! Clayform embed — https://github.com/claycovyn/clayform (MIT)
 *
 * Inline:  <div data-clayform="SLUG" style="height:560px"></div>
 * Popup:   <button data-clayform-popup="SLUG">Open form</button>
 * Options: data-clayform-hidden="name=Ada&plan=pro"   (hidden fields)
 * Events:  window.addEventListener("message", e => e.data.type === "clayform:submit")
 */
(function () {
  var script = document.currentScript;
  var origin = script ? new URL(script.src).origin : "";

  function src(slug, hidden) {
    return origin + "/f/" + encodeURIComponent(slug) + "?embed=1" + (hidden ? "&" + hidden : "");
  }

  function frame(slug, hidden) {
    var f = document.createElement("iframe");
    f.src = src(slug, hidden);
    f.title = "Form";
    f.allow = "clipboard-write";
    f.style.cssText = "border:0;width:100%;height:100%;display:block;border-radius:inherit";
    return f;
  }

  function inline() {
    var els = document.querySelectorAll("[data-clayform]:not([data-clayform-ready])");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      el.setAttribute("data-clayform-ready", "1");
      if (!el.style.height) el.style.height = "560px";
      el.appendChild(frame(el.getAttribute("data-clayform"), el.getAttribute("data-clayform-hidden")));
    }
  }

  function popup(slug, hidden) {
    var overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;background:rgba(20,16,14,.55);display:flex;align-items:center;justify-content:center;padding:16px";
    var box = document.createElement("div");
    box.style.cssText = "position:relative;width:min(900px,100%);height:min(680px,100%);border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.35)";
    var close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Close form");
    close.textContent = "×";
    close.style.cssText =
      "position:absolute;top:8px;right:8px;z-index:2;width:36px;height:36px;border:0;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;font-size:22px;cursor:pointer";
    function done() {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) {
      if (e.key === "Escape") done();
    }
    close.onclick = done;
    overlay.onclick = function (e) {
      if (e.target === overlay) done();
    };
    document.addEventListener("keydown", onKey);
    box.appendChild(close);
    box.appendChild(frame(slug, hidden));
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    close.focus();
  }

  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-clayform-popup]") : null;
    if (!t) return;
    e.preventDefault();
    popup(t.getAttribute("data-clayform-popup"), t.getAttribute("data-clayform-hidden"));
  });

  window.Clayform = { open: popup, mount: inline };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inline);
  else inline();
})();
