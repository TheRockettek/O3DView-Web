import { enhanceDropdowns, syncDropdown } from "../src/dropdowns.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const wait = () => new Promise((resolve) => setTimeout(resolve, 0));
const key = (element, value) =>
  element.dispatchEvent(
    new KeyboardEvent("keydown", { key: value, bubbles: true }),
  );
const input = (element, value) => {
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
};

async function check() {
  enhanceDropdowns();
  enhanceDropdowns();
  const select = document.getElementById("choices");
  const wrapper = select.parentElement;
  const button = wrapper.querySelector("button");
  const search = wrapper.querySelector(".dropdown-search");
  const panel = wrapper.querySelector(".dropdown-panel");
  const options = () => [...wrapper.querySelectorAll("[role=option]")];
  assert(
    select.hidden && wrapper.querySelectorAll(".dropdown-button").length === 1,
    "select enhancement or idempotence",
  );
  assert(
    select.labels.length === 0 &&
      document.querySelector("label[for=choices]") === null,
    "label was not transferred",
  );
  assert(
    document.querySelector("label").control === button,
    "button has no associated label",
  );
  assert(
    button.getAttribute("aria-labelledby").includes("dropdown-"),
    "missing accessible label",
  );
  assert(button.textContent === "First entry", "initial selection");
  let changes = 0,
    inputs = 0;
  select.addEventListener("change", () => changes++);
  select.addEventListener("input", () => inputs++);
  button.click();
  assert(
    !panel.hidden && document.activeElement === search,
    "opening focuses search",
  );
  assert(
    button.getAttribute("aria-expanded") === "true" &&
      search.getAttribute("aria-expanded") === "true",
    "expanded state",
  );
  input(search, "SECOND");
  assert(
    options().length === 1 && options()[0].textContent === "Second entry",
    "case-insensitive filtering",
  );
  key(search, "Enter");
  assert(
    select.selectedIndex === 1 &&
      select.value === "same" &&
      changes === 1 &&
      inputs === 1,
    "duplicate values and change events",
  );
  assert(
    button.textContent === "Second entry" &&
      panel.hidden &&
      document.activeElement === button,
    "selection closes and restores focus",
  );
  button.click();
  key(search, "ArrowDown");
  key(search, "Enter");
  assert(
    select.value === "last" && changes === 2,
    "keyboard skips disabled options and groups",
  );
  button.click();
  input(search, "disabled");
  assert(
    options().length === 2 &&
      options().every(
        (option) => option.getAttribute("aria-disabled") === "true",
      ),
    "disabled results",
  );
  options()[0].click();
  key(search, "Enter");
  assert(
    select.value === "last" && !panel.hidden && changes === 2,
    "disabled options cannot be selected",
  );
  input(search, "not found");
  assert(
    options().length === 0 && !wrapper.querySelector(".dropdown-empty").hidden,
    "empty result",
  );
  const enter = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
  });
  search.dispatchEvent(enter);
  assert(
    enter.defaultPrevented && !panel.hidden,
    "Enter with no results must not submit a form",
  );
  key(search, "Escape");
  assert(
    panel.hidden && document.activeElement === button,
    "Escape returns focus",
  );
  select.value = "same";
  syncDropdown(select);
  assert(button.textContent === "First entry", "programmatic selection sync");
  select.replaceChildren(
    ...Array.from({ length: 1200 }, (_, i) => {
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = `Option ${i}`;
      return option;
    }),
  );
  await wait();
  assert(button.textContent === "Option 0", "dynamic option update");
  button.click();
  input(search, "option 1199");
  assert(
    options().length === 1 && options()[0].textContent === "Option 1199",
    "search covers all options",
  );
  key(search, "Enter");
  assert(select.value === "1199" && changes === 3, "dynamic option selection");
  select.disabled = true;
  await wait();
  assert(button.disabled, "disabled select");
  select.disabled = false;
  await wait();
  assert(!button.disabled, "enabled select");
  const other = document.getElementById("other");
  const otherButton = other.parentElement.querySelector("button");
  document.getElementById("fieldset").disabled = true;
  await wait();
  assert(otherButton.matches(":disabled"), "disabled fieldset");
  document.getElementById("fieldset").disabled = false;
  await wait();
  assert(
    !otherButton.disabled && !otherButton.matches(":disabled"),
    "enabled fieldset",
  );
  button.click();
  document.getElementById("outside").focus();
  assert(panel.hidden, "focus leaving closes list");
  button.click();
  const style = getComputedStyle(options()[0]);
  const panelStyle = getComputedStyle(panel);
  assert(
    style.color !== panelStyle.backgroundColor,
    "dropdown text and background are identical",
  );
  assert(
    style.color === "rgb(225, 233, 242)" &&
      panelStyle.backgroundColor === "rgb(16, 27, 40)",
    "dropdown colors",
  );

  const frame = document.createElement("iframe");
  frame.src = "../index.html";
  document.body.append(frame);
  await new Promise((resolve, reject) => {
    frame.onload = resolve;
    frame.onerror = () => reject(new Error("application frame failed to load"));
  });
  const app = frame.contentDocument;
  assert(
    app.querySelectorAll("select").length ===
      app.querySelectorAll(".dropdown-button").length,
    "every app dropdown must be enhanced",
  );
  const entry = app.getElementById("entry");
  const files = new DataTransfer();
  files.items.add(new File(["v 0 0 0"], "alpha.obj"));
  files.items.add(new File(["[mesh]\nalpha.obj"], "bravo.cfg"));
  const fileInput = app.getElementById("model-files");
  fileInput.files = files.files;
  fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  await wait();
  const entryButton = entry.parentElement.querySelector("button");
  assert(
    !entryButton.disabled && entryButton.textContent === "alpha.obj",
    "app updates dropdown after file selection",
  );
  entryButton.click();
  const entrySearch = entry.parentElement.querySelector(".dropdown-search");
  input(entrySearch, "BRAVO");
  key(entrySearch, "Enter");
  assert(
    entry.value === "bravo.cfg" && entryButton.textContent === "bravo.cfg",
    "app entry search selects file",
  );
}

try {
  await check();
  await fetch("/test-result", { method: "POST", body: "PASS" });
} catch (error) {
  await fetch("/test-result", {
    method: "POST",
    body: `FAIL ${error.stack || error.message}`,
  });
}
