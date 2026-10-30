/* Wspólny układ grafu rodziny: pokolenia z góry na dół, kompaktowe karty osób.
   Użycie: DrzewoUklad.render(svg, [{ person, branches }], { branchesOf, onPerson, onUnion, childrenUnderPerson, compact, cardWidth, maidenLine }).
   compact: tylko pierwsze imię, bez nazwiska rodowego i tylko pierwszy rok przy datach alternatywnych.
   maidenLine: nazwisko rodowe w osobnej linii pod nazwiskiem (karty są wtedy wyższe). */
(function () {
  "use strict";

  const svgNamespace = "http://www.w3.org/2000/svg";
  const defaultCardWidth = 112;
  let cardWidth = defaultCardWidth;
  let compact = false;
  const defaultCardHeight = 52;
  const maidenLineHeight = 13;
  let cardHeight = defaultCardHeight;
  let showMaiden = false;
  const coupleGap = 30;
  const siblingGap = 14;
  const rootGap = 48;
  const levelGap = 62;
  let rowHeight = cardHeight + levelGap;
  const padding = 24;

  function makeSvgElement(name, attributes) {
    const element = document.createElementNS(svgNamespace, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  }

  function yearText(value, firstOnly = compact) {
    const raw = String(value || "");
    const years = [...new Set(raw.match(/\d{4}/g) || [])];
    if (!years.length) return "";
    return `${/ok\.|\?/.test(raw) ? "~" : ""}${firstOnly ? years[0] : years.join("–")}`;
  }

  /* Dwie linie karty: imię (w trybie kompaktowym tylko pierwsze) oraz nazwisko z ewentualnym nazwiskiem rodowym. */
  function nameLines(person) {
    const given = compact || !person.secondName ? person.given : `${person.given} ${person.secondName}`;
    const surname = person.surname;
    if (!surname) return [given, person.givenVariants ? `(${person.givenVariants})` : ""];
    if (compact) return [given, surname];
    const maiden = person.maiden && !surname.includes(person.maiden) ? ` z d. ${person.maiden}` : "";
    return [given, surname + maiden];
  }

  function fitText(text, maxWidth) {
    if (text.getComputedTextLength() > maxWidth) {
      text.setAttribute("textLength", maxWidth);
      text.setAttribute("lengthAdjust", "spacingAndGlyphs");
    }
  }

  /* Kontur poddrzewa: dla każdego poziomu skrajne x (lewe i prawe) zajęte przez karty i linie. */
  function extendContour(contour, level, min, max) {
    const current = contour.get(level);
    contour.set(level, current
      ? [Math.min(current[0], min), Math.max(current[1], max)]
      : [min, max]);
  }

  function mergeContour(target, source, shift) {
    source.forEach(([min, max], level) => extendContour(target, level, min + shift, max + shift));
  }

  /* Najmniejsze przesunięcie, przy którym kontur source leży na prawo od target na każdym wspólnym poziomie. */
  function minimalShift(target, source, gap) {
    let shift = -Infinity;
    source.forEach(([min], level) => {
      const placed = target.get(level);
      if (placed) shift = Math.max(shift, placed[1] + gap - min);
    });
    return shift;
  }

  function defaultBranchesOf(person) {
    return [person.family, ...(person.otherFamilies || [])].filter(Boolean);
  }

  /* Układ względny: osoba na x = 0, pierwszy małżonek po prawej, drugi po lewej, kolejni dalej po prawej.
     Dzieci każdego związku tworzą blok pod kropką ślubu; poddrzewa są dosuwane do siebie poziomami. */
  function layoutUnit(person, branches, level, branchesOf, underPerson) {
    const step = cardWidth + coupleGap;
    const unions = branches.map((family, index) => {
      const spouseX = index === 1 ? -step : index === 0 ? step : step * index;
      const dotX = spouseX > 0 ? spouseX - coupleGap / 2 : -coupleGap / 2;
      return {
        family,
        index,
        spouse: (family.partners || []).find(partner => partner !== person),
        spouseX,
        dotX,
        farAway: index >= 2,
        children: (family.children || []).map(child => ({
          sub: layoutUnit(child, branchesOf(child), level + 1, branchesOf, underPerson)
        }))
      };
    }).sort((a, b) => a.dotX - b.dotX);

    const contour = new Map();
    extendContour(contour, level, 0, cardWidth);
    unions.forEach(union => extendContour(contour, level, union.spouseX, union.spouseX + cardWidth));
    const below = new Map();
    unions.forEach((union, order) => {
      union.order = order;
      if (!union.children.length) return;
      const block = new Map();
      union.children.forEach(child => {
        const shift = minimalShift(block, child.sub.contour, siblingGap);
        child.shift = Number.isFinite(shift) ? shift : 0;
        mergeContour(block, child.sub.contour, child.shift);
      });
      const first = union.children[0].shift;
      const last = union.children[union.children.length - 1].shift + cardWidth;
      const anchor = underPerson && union.index === 0 ? cardWidth / 2 : union.dotX;
      const offset = Math.max(anchor - (first + last) / 2, minimalShift(below, block, siblingGap));
      union.children.forEach(child => { child.shift += offset; });
      mergeContour(below, block, offset);
      extendContour(below, level + 1, union.dotX, union.dotX);
    });
    mergeContour(contour, below, 0);
    return { person, level, unions, contour };
  }

  function render(svg, roots, options = {}) {
    const branchesOf = options.branchesOf || defaultBranchesOf;
    compact = Boolean(options.compact);
    cardWidth = options.cardWidth || defaultCardWidth;
    showMaiden = Boolean(options.maidenLine);
    cardHeight = defaultCardHeight + (showMaiden ? maidenLineHeight : 0);
    rowHeight = cardHeight + levelGap;
    let maxRight = 0;
    let maxBottom = 0;

    function edge(d, cls = "edge") {
      svg.appendChild(makeSvgElement("path", { d, class: cls }));
    }

    function drawPerson(person, x, y, family) {
      const group = makeSvgElement("g", { class: "person-node" });
      const title = makeSvgElement("title", {});
      title.textContent = [
        person.name + (person.maiden ? ` (z d. ${person.maiden})` : ""),
        person.birth ? `ur. ${person.birth}${person.birthPlace ? `, ${person.birthPlace}` : ""}` : "",
        person.death ? `zm. ${person.death}${person.deathPlace ? `, ${person.deathPlace}` : ""}` : ""
      ].filter(Boolean).join(" · ");
      group.appendChild(title);
      group.appendChild(makeSvgElement("rect", { x, y, width: cardWidth, height: cardHeight, rx: 9 }));
      svg.appendChild(group);

      const centerX = x + cardWidth / 2;
      const [given, surname] = nameLines(person);
      const years = [];
      if (person.birth) years.push(`* ${yearText(person.birth)}`);
      if (person.death) years.push(`† ${yearText(person.death)}`);
      // Tylko istniejące linie, ułożone jedna pod drugą i wyśrodkowane w pionie karty.
      const maiden = showMaiden && person.maiden && person.maiden !== person.surname ? person.maiden : "";
      const lines = [
        [given, 0, "person-name"],
        [surname, 14, "person-name"],
        [maiden && `z d. ${maiden}`, maidenLineHeight, "person-maiden"],
        [years.join(compact ? " " : "  "), 15, "person-year"]
      ].filter(([content]) => content);
      let offset = 0;
      const placed = lines.map(([content, gap, cls], index) => {
        if (index) offset += gap;
        return [content, offset, cls];
      });
      const top = cardHeight / 2 + 4.5 - offset / 2;
      placed.forEach(([content, lineOffset, cls]) => {
        const dy = top + lineOffset;
        const text = makeSvgElement("text", { x: centerX, y: y + dy, class: cls });
        text.textContent = content;
        group.appendChild(text);
        fitText(text, cardWidth - 10);
      });
      maxRight = Math.max(maxRight, x + cardWidth);
      maxBottom = Math.max(maxBottom, y + cardHeight);
      if (options.onPerson) options.onPerson(group, person, family);
    }

    function drawUnion(family, x, y) {
      const year = family.marriage?.match(/\d{4}/)?.[0] || "";
      const node = makeSvgElement("g", { class: "union-node" });
      const title = makeSvgElement("title", {});
      title.textContent = `${family.name || "Małżeństwo"}${family.marriage ? ` · ${family.marriage}` : ""}`;
      node.appendChild(title);
      node.appendChild(makeSvgElement("circle", { cx: x, cy: y, r: 6 }));
      svg.appendChild(node);
      if (year) {
        const label = makeSvgElement("text", { x: x + 5, y: y + cardHeight / 2 + 13, class: "marriage-year" });
        label.textContent = `∞ ${year}`;
        svg.appendChild(label);
      }
      if (options.onUnion) options.onUnion(node, family);
    }

    function drawUnit(unit, offsetX, top) {
      const y = top + unit.level * rowHeight;
      const centerY = y + cardHeight / 2;
      const ownFamily = unit.unions.find(union => union.index === 0)?.family;
      drawPerson(unit.person, offsetX, y, ownFamily);
      unit.unions.forEach(union => {
        const dotX = offsetX + union.dotX;
        if (union.spouse) drawPerson(union.spouse, offsetX + union.spouseX, y, union.family);
        if (union.farAway) {
          edge(`M ${offsetX + cardWidth - 14} ${y} V ${y - 8} H ${dotX} V ${centerY - 6}`, "marriage-edge");
          edge(`M ${dotX} ${centerY} H ${dotX + coupleGap / 2}`, "marriage-edge");
        } else {
          edge(`M ${dotX - coupleGap / 2} ${centerY} H ${dotX + coupleGap / 2}`, "marriage-edge");
        }
        drawUnion(union.family, dotX, centerY);
        if (!union.children.length) return;

        const childTop = y + rowHeight;
        const busY = childTop - 16 - 8 * union.order;
        const childCenters = union.children.map(child => offsetX + child.shift + cardWidth / 2);
        const left = Math.min(dotX, ...childCenters);
        const right = Math.max(dotX, ...childCenters);
        edge(`M ${dotX} ${centerY + 6} V ${busY} M ${left} ${busY} H ${right}`);
        childCenters.forEach(x => edge(`M ${x} ${busY} V ${childTop}`));
        union.children.forEach(child => drawUnit(child.sub, offsetX + child.shift, top));
      });
    }

    svg.replaceChildren();
    const placed = new Map();
    const units = roots.map(root => layoutUnit(root.person, root.branches, 0, branchesOf, options.childrenUnderPerson));
    units.forEach(unit => {
      const shift = minimalShift(placed, unit.contour, rootGap);
      unit.shift = Number.isFinite(shift) ? shift : 0;
      mergeContour(placed, unit.contour, unit.shift);
    });
    const leftEdge = Math.min(...[...placed.values()].map(([min]) => min));
    let firstRootCenter = 0;
    units.forEach((unit, index) => {
      const offsetX = unit.shift - leftEdge + padding;
      if (index === 0) firstRootCenter = offsetX + cardWidth;
      drawUnit(unit, offsetX, padding + 8);
    });
    const width = maxRight + padding;
    const height = maxBottom + padding;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    return { width, height, firstRootCenter };
  }

  /* Przesuwanie grafu na komputerze: przeciąganie myszą (poziomo kontener, pionowo strona) i strzałki ←/→. */
  function enablePan(frame) {
    let drag = null;
    let suppressClick = false;
    frame.classList.add("pannable");
    frame.addEventListener("pointerdown", event => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    });
    frame.addEventListener("pointermove", event => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      if (!drag.moved) {
        drag.moved = true;
        frame.setPointerCapture(drag.id);
        frame.classList.add("dragging");
      }
      frame.scrollLeft -= dx;
      window.scrollBy(0, -dy);
      drag.x = event.clientX;
      drag.y = event.clientY;
      event.preventDefault();
    });
    function endDrag(event) {
      if (!drag || event.pointerId !== drag.id) return;
      suppressClick = drag.moved;
      frame.classList.remove("dragging");
      drag = null;
    }
    frame.addEventListener("pointerup", endDrag);
    frame.addEventListener("pointercancel", endDrag);
    frame.addEventListener("click", event => {
      if (!suppressClick) return;
      suppressClick = false;
      event.stopPropagation();
      event.preventDefault();
    }, true);
    frame.addEventListener("dragstart", event => event.preventDefault());
    document.addEventListener("keydown", event => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.target.closest?.("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      frame.scrollBy({ left: event.key === "ArrowLeft" ? -80 : 80 });
    });
  }

  window.DrzewoUklad = { render, nameLines, yearText, enablePan };
})();
