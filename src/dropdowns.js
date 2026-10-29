const controllers = new WeakMap();
let sequence = 0;

export function syncDropdown(select) {
  controllers.get(select)?.sync();
}

export function enhanceDropdowns(root = document) {
  for (const select of root.querySelectorAll("select")) {
    if (controllers.has(select)) continue;
    const label = select.labels?.[0];
    if (!label || !select.id || select.multiple) continue;

    const id = `dropdown-${++sequence}`;
    if (!label.id) label.id = `${id}-label`;
    const wrapper = document.createElement("div");
    wrapper.className = "dropdown";
    const button = document.createElement("button");
    button.type = "button";
    button.id = `${id}-button`;
    button.className = "dropdown-button";
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", `${id}-list`);
    button.setAttribute("aria-labelledby", `${label.id} ${id}-value`);
    const value = document.createElement("span");
    value.id = `${id}-value`;
    value.className = "dropdown-value";
    button.append(value);
    const panel = document.createElement("div");
    panel.className = "dropdown-panel";
    panel.hidden = true;
    const search = document.createElement("input");
    search.type = "search";
    search.className = "dropdown-search";
    search.placeholder = "Search options";
    search.setAttribute("aria-label", `Search ${label.textContent.trim()}`);
    search.setAttribute("role", "combobox");
    search.setAttribute("aria-autocomplete", "list");
    search.setAttribute("aria-expanded", "false");
    search.setAttribute("aria-controls", `${id}-list`);
    const list = document.createElement("div");
    list.id = `${id}-list`;
    list.className = "dropdown-list";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-labelledby", label.id);
    const empty = document.createElement("p");
    empty.className = "dropdown-empty";
    empty.textContent = "No matching options.";
    empty.hidden = true;
    panel.append(search, list, empty);
    select.before(wrapper);
    wrapper.append(select, button, panel);
    select.hidden = true;
    label.htmlFor = button.id;

    let active = -1;
    let displayed = [];
    function setActive(index) {
      active = index;
      for (const item of displayed)
        item.element.classList.toggle("active", item.index === active);
      const current = displayed.find((item) => item.index === active);
      if (current) {
        search.setAttribute("aria-activedescendant", current.element.id);
        current.element.scrollIntoView({ block: "nearest" });
      } else search.removeAttribute("aria-activedescendant");
    }

    function render() {
      const query = search.value.trim().toLocaleLowerCase();
      displayed = [];
      const fragment = document.createDocumentFragment();
      for (const [index, option] of Array.from(select.options).entries()) {
        if (!option.textContent.toLocaleLowerCase().includes(query)) continue;
        const element = document.createElement("div");
        element.id = `${id}-option-${index}`;
        element.className = "dropdown-option";
        element.setAttribute("role", "option");
        element.setAttribute(
          "aria-selected",
          String(index === select.selectedIndex),
        );
        const disabled =
          option.disabled || option.parentElement?.disabled === true;
        if (disabled) element.setAttribute("aria-disabled", "true");
        element.textContent = option.textContent;
        element.addEventListener("pointerdown", (event) =>
          event.preventDefault(),
        );
        element.addEventListener("click", () => {
          if (!disabled) choose(index);
        });
        fragment.append(element);
        if (!disabled) displayed.push({ index, element });
      }
      list.replaceChildren(fragment);
      empty.hidden = list.childElementCount > 0;
      const selected = displayed.find(
        (item) => item.index === select.selectedIndex,
      );
      setActive(selected?.index ?? displayed[0]?.index ?? -1);
    }

    function sync() {
      const option = select.selectedOptions[0];
      value.textContent = option?.textContent ?? "No options";
      button.disabled = select.matches(":disabled");
      if (button.disabled && !panel.hidden) close(false);
      if (!panel.hidden) render();
    }

    function close(focus) {
      panel.hidden = true;
      button.setAttribute("aria-expanded", "false");
      search.setAttribute("aria-expanded", "false");
      search.removeAttribute("aria-activedescendant");
      if (focus && !button.disabled) button.focus();
    }

    function open() {
      if (select.matches(":disabled")) return;
      search.value = "";
      panel.hidden = false;
      button.setAttribute("aria-expanded", "true");
      search.setAttribute("aria-expanded", "true");
      render();
      search.focus();
    }

    function choose(index) {
      if (select.matches(":disabled")) return;
      const changed = index !== select.selectedIndex;
      select.selectedIndex = index;
      close(true);
      if (changed) {
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      sync();
      queueMicrotask(sync);
    }

    button.addEventListener("click", () =>
      panel.hidden ? open() : close(true),
    );
    button.addEventListener("keydown", (event) => {
      if (
        panel.hidden &&
        (event.key === "ArrowDown" || event.key === "ArrowUp")
      ) {
        event.preventDefault();
        open();
      }
    });
    search.addEventListener("input", render);
    search.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!displayed.length) return;
        const position = displayed.findIndex((item) => item.index === active);
        const next = event.key === "ArrowDown" ? position + 1 : position - 1;
        setActive(
          displayed[Math.max(0, Math.min(displayed.length - 1, next))].index,
        );
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (active !== -1) choose(active);
      }
    });
    document.addEventListener("pointerdown", (event) => {
      if (
        !panel.hidden &&
        !wrapper.contains(event.target) &&
        event.target !== label
      )
        close(false);
    });
    wrapper.addEventListener("focusout", (event) => {
      if (!panel.hidden && !wrapper.contains(event.relatedTarget)) close(false);
    });
    select.addEventListener("change", () => queueMicrotask(sync));
    const observer = new MutationObserver(sync);
    observer.observe(select, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    for (
      let ancestor = select.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      if (ancestor.tagName === "FIELDSET")
        observer.observe(ancestor, {
          attributes: true,
          attributeFilter: ["disabled"],
        });
    }
    controllers.set(select, { sync });
    sync();
  }
}
