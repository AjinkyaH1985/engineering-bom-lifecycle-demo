(function (app) {
  app.components = app.components || {};

  var openMenu = null;
  var MOBILE = "(max-width: 900px)";

  function escape(value) {
    return app.utils ? app.utils.escapeHtml(String(value == null ? "" : value)) : String(value == null ? "" : value);
  }

  function isMobile() {
    return typeof window !== "undefined" && window.matchMedia && window.matchMedia(MOBILE).matches;
  }

  function iconMarkup(name) {
    var paths = {
      view: '<circle cx="7" cy="14" r="3.5"/><circle cx="17" cy="14" r="3.5"/><path d="M10.5 14h3M7 10.5L9 5M17 10.5L15 5"/>',
      edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
      doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      check: '<path d="M20 6L9 17l-5-5"/>',
      close: '<path d="M6 6l12 12M18 6L6 18"/>',
      flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
      list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'
    };
    if (!paths[name]) return '<span class="fi-menu-icon"></span>';
    return '<span class="fi-menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      paths[name] + '</svg></span>';
  }

  function renderItems(items, path) {
    return items.map(function (item, index) {
      if (item.separator) return '<li class="fi-menu-sep" role="separator"></li>';
      var id = path.concat(index).join("-");
      var hasChildren = item.children && item.children.length;
      return '<li class="fi-menu-li">' +
        '<button type="button" class="fi-menu-item' + (item.disabled ? ' is-disabled' : '') + '" role="menuitem" data-menu-path="' + id + '"' +
        (item.disabled ? ' disabled' : '') + (hasChildren ? ' aria-haspopup="true" aria-expanded="false"' : '') + '>' +
        iconMarkup(item.icon) + '<span class="fi-menu-label">' + escape(item.label) + '</span>' +
        (hasChildren ? '<span class="fi-menu-chevron" aria-hidden="true"></span>' : '') +
        '</button>' +
        (hasChildren ? '<ul class="fi-menu fi-submenu" role="menu" hidden>' + renderItems(item.children, path.concat(index)) + '</ul>' : '') +
        '</li>';
    }).join("");
  }

  function findItem(items, pathString) {
    var parts = pathString.split("-").map(Number);
    var current = { children: items };
    for (var i = 0; i < parts.length; i += 1) {
      current = (current.children || [])[parts[i]];
      if (!current) return null;
    }
    return current;
  }

  function close() {
    if (!openMenu) return;
    var menu = openMenu;
    openMenu = null;
    if (menu.element && menu.element.parentNode) menu.element.parentNode.removeChild(menu.element);
    document.removeEventListener("mousedown", menu.onOutside, true);
    document.removeEventListener("keydown", menu.onKey, true);
    window.removeEventListener("resize", close);
    window.removeEventListener("scroll", menu.onScroll, true);
    if (menu.anchor && menu.anchor.setAttribute) menu.anchor.setAttribute("aria-expanded", "false");
  }

  function place(element, anchor) {
    var rect = anchor.getBoundingClientRect();
    var width = element.offsetWidth;
    var height = element.offsetHeight;
    var left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    var top = rect.bottom + 4;
    if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 4);
    element.style.left = left + "px";
    element.style.top = top + "px";
  }

  function openSub(button, submenu) {
    var parent = button.closest(".fi-menu");
    [].forEach.call(parent.querySelectorAll(":scope > .fi-menu-li > .fi-submenu"), function (other) {
      if (other !== submenu) {
        other.hidden = true;
        var otherButton = other.previousElementSibling;
        if (otherButton) otherButton.setAttribute("aria-expanded", "false");
      }
    });
    var show = submenu.hidden;
    submenu.hidden = !show;
    button.setAttribute("aria-expanded", show ? "true" : "false");
    if (show && !isMobile()) {
      submenu.style.left = "";
      submenu.style.right = "";
      var rect = submenu.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) {
        submenu.style.left = "auto";
        submenu.style.right = "100%";
      }
      var overflow = rect.bottom - (window.innerHeight - 8);
      if (overflow > 0) submenu.style.top = (-overflow - 4) + "px";
    }
  }

  function open(options) {
    close();
    var anchor = options.anchor;
    var items = options.items || [];
    var element = document.createElement("div");
    element.className = "fi-menu-layer";
    element.innerHTML = '<ul class="fi-menu fi-menu-root" role="menu">' + renderItems(items, []) + '</ul>';
    document.body.appendChild(element);
    place(element, anchor);

    function onSelect(event) {
      var button = event.target.closest(".fi-menu-item");
      if (!button || button.disabled) return;
      var item = findItem(items, button.getAttribute("data-menu-path"));
      if (!item) return;
      if (item.children && item.children.length) {
        openSub(button, button.nextElementSibling);
        return;
      }
      close();
      if (typeof item.onSelect === "function") item.onSelect(item);
    }

    element.addEventListener("click", onSelect);
    element.addEventListener("mouseover", function (event) {
      if (isMobile()) return;
      var button = event.target.closest(".fi-menu-item");
      if (!button || button.disabled) return;
      var sub = button.nextElementSibling;
      if (sub && sub.classList.contains("fi-submenu") && sub.hidden) openSub(button, sub);
    });

    openMenu = {
      element: element,
      anchor: anchor,
      onOutside: function (event) {
        if (!element.contains(event.target) && !(anchor && anchor.contains && anchor.contains(event.target))) close();
      },
      onKey: function (event) {
        if (event.key === "Escape") { close(); if (anchor && anchor.focus) anchor.focus(); }
      },
      onScroll: function (event) {
        if (!element.contains(event.target)) close();
      }
    };
    document.addEventListener("mousedown", openMenu.onOutside, true);
    document.addEventListener("keydown", openMenu.onKey, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", openMenu.onScroll, true);
    if (anchor && anchor.setAttribute) anchor.setAttribute("aria-expanded", "true");
    var first = element.querySelector(".fi-menu-item:not([disabled])");
    if (first && options.focusFirst) first.focus();
    return element;
  }

  app.components.contextMenu = {
    open: open,
    close: close,
    isOpen: function () { return Boolean(openMenu); }
  };
})(window.DEP = window.DEP || {});
