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
  let straightLine = false;
  let mainLineIds = new Set();

  /* Dziecko kontynuujące główną (pionową) linię — tylko osoby z listy mainLineIds. */
  function mainChildOf(children) {
    return children.find(child => mainLineIds.has(child.sub.person.id)) || null;
  }

  /* Największe przesunięcie, przy którym kontur source leży na lewo od target na każdym wspólnym poziomie. */
  function maximalShiftLeft(target, source, gap) {
    let shift = Infinity;
    source.forEach(([, max], level) => {
      const placed = target.get(level);
      if (placed) shift = Math.min(shift, placed[0] - gap - max);
    });
    return Number.isFinite(shift) ? shift : 0;
  }

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
      union.block = new Map();
      union.children.forEach(child => {
        const shift = minimalShift(union.block, child.sub.contour, siblingGap);
        child.shift = Number.isFinite(shift) ? shift : 0;
        mergeContour(union.block, child.sub.contour, child.shift);
      });
    });
    const place = (union, offset) => {
      union.children.forEach(child => { child.shift += offset; });
      mergeContour(below, union.block, offset);
      extendContour(below, level + 1, union.dotX, union.dotX);
    };
    const withChildren = unions.filter(union => union.children.length);
    const main = straightLine && mainLineIds.has(person.id) ? mainChildOf(withChildren.flatMap(union => union.children)) : null;
    if (main) {
      // Główna linia w pionie: wybrane dziecko dokładnie pod rodzicem (x = 0); pozostałe bloki dzieci po bokach.
      const mainUnion = withChildren.find(union => union.children.includes(main));
      const at = withChildren.indexOf(mainUnion);
      place(mainUnion, -main.shift);
      withChildren.slice(at + 1).forEach(union => place(union, minimalShift(below, union.block, siblingGap)));
      withChildren.slice(0, at).reverse().forEach(union => place(union, maximalShiftLeft(below, union.block, siblingGap)));
    } else {
      withChildren.forEach(union => {
        const first = union.children[0].shift;
        const last = union.children[union.children.length - 1].shift + cardWidth;
        const anchor = underPerson && union.index === 0 ? cardWidth / 2 : union.dotX;
        place(union, Math.max(anchor - (first + last) / 2, minimalShift(below, union.block, siblingGap)));
      });
    }
    mergeContour(contour, below, 0);
    return { person, level, unions, contour };
  }

  const busMargin = 12;

  /* Pozycje bezwzględne: unit.x to x osoby; zapamiętuje rodzica i związek, z którego pochodzi dziecko. */
  function assignPositions(unit, x, parentUnit, parentUnion, all) {
    unit.x = x;
    unit.parentUnit = parentUnit;
    unit.parentUnion = parentUnion;
    const spouseXs = unit.unions.map(union => union.spouseX);
    unit.rowMin = Math.min(0, ...spouseXs);
    unit.rowMax = Math.max(cardWidth, ...spouseXs.map(spouseX => spouseX + cardWidth));
    all.push(unit);
    unit.unions.forEach(union => union.children.forEach(child =>
      assignPositions(child.sub, x + child.shift, unit, union, all)));
  }

  /* Zakres poziomej linii związku (od kropki do skrajnych dzieci). */
  function busSpan(unit, union, delta = 0) {
    const dot = unit.x + union.dotX + delta;
    const centers = union.children.map(child => child.sub.x + cardWidth / 2);
    return [Math.min(dot, ...centers), Math.max(dot, ...centers)];
  }

  /* Dociąganie: każda rodzina przesuwa się w stronę kropki ślubu swoich rodziców, dopóki nie natrafi
     na sąsiednią kartę w tym samym rzędzie ani na poziomą linię innej rodziny pod sobą. */
  function compactLayout(all, fixedIds) {
    const byLevel = new Map();
    all.forEach(unit => {
      if (!byLevel.has(unit.level)) byLevel.set(unit.level, []);
      byLevel.get(unit.level).push(unit);
    });
    const levels = [...byLevel.keys()].sort((a, b) => a - b);

    function limitMove(unit, wanted) {
      let delta = wanted;
      const row = byLevel.get(unit.level).filter(other => other !== unit);
      const left = unit.x + unit.rowMin;
      const right = unit.x + unit.rowMax;
      row.forEach(other => {
        const otherLeft = other.x + other.rowMin;
        const otherRight = other.x + other.rowMax;
        if (delta < 0 && otherRight <= left) delta = Math.max(delta, otherRight + siblingGap - left);
        if (delta > 0 && otherLeft >= right) delta = Math.min(delta, otherLeft - siblingGap - right);
      });
      const otherSpans = row.flatMap(other => other.unions.filter(union => union.children.length)
        .map(union => busSpan(other, union)));
      unit.unions.filter(union => union.children.length).forEach(union => {
        const [start, end] = busSpan(unit, union);
        const dot = unit.x + union.dotX;
        otherSpans.forEach(([otherStart, otherEnd]) => {
          if (delta < 0 && otherEnd <= start) delta = Math.max(delta, Math.min(otherEnd + busMargin, start) - dot);
          if (delta > 0 && otherStart >= end) delta = Math.min(delta, Math.max(otherStart - busMargin, end) - dot);
        });
      });
      return Math.sign(delta) === Math.sign(wanted) ? delta : 0;
    }

    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      levels.forEach(level => {
        const families = new Map();
        byLevel.get(level).forEach(unit => {
          if (!unit.parentUnion || fixedIds.has(unit.person.id)) return;
          if (!families.has(unit.parentUnion)) families.set(unit.parentUnion, []);
          families.get(unit.parentUnion).push(unit);
        });
        families.forEach((kids, union) => {
          const dot = kids[0].parentUnit.x + union.dotX;
          const center = unit => unit.x + cardWidth / 2;
          const rightSide = kids.filter(unit => center(unit) > dot).sort((a, b) => a.x - b.x);
          const leftSide = kids.filter(unit => center(unit) < dot).sort((a, b) => b.x - a.x);
          [...rightSide, ...leftSide].forEach(unit => {
            const delta = limitMove(unit, dot - center(unit));
            if (Math.abs(delta) > 0.5) {
              unit.x += delta;
              changed = true;
            }
          });
        });
      });
      if (!changed) break;
    }
  }

  /* Wysokości poziomych linii do dzieci: jeśli linia jednego związku przechodzi pod kropką innego,
     linia tego drugiego biegnie wyżej — pionowa kreska od kropki nie przecina wtedy cudzej linii. */
  function busLevelsOf(unions) {
    const withChildren = unions.filter(union => union.children.length);
    const spans = new Map(withChildren.map(union => {
      const centers = union.children.map(child => child.shift + cardWidth / 2);
      return [union, [Math.min(union.dotX, ...centers), Math.max(union.dotX, ...centers)]];
    }));
    const levels = new Map(withChildren.map(union => [union, 0]));
    for (let pass = 0; pass < withChildren.length; pass++) {
      withChildren.forEach(a => withChildren.forEach(b => {
        if (a === b) return;
        const [left, right] = spans.get(a);
        const [bLeft, bRight] = spans.get(b);
        const inside = (x, l, r) => x > l && x < r;
        const overlap = bLeft < right && bRight > left;
        const above = inside(b.dotX, left, right)
          || (overlap && a.order < b.order && !inside(a.dotX, bLeft, bRight));
        if (above && levels.get(b) <= levels.get(a)) levels.set(b, levels.get(a) + 1);
      }));
    }
    return levels;
  }

  function render(svg, roots, options = {}) {
    const branchesOf = options.branchesOf || defaultBranchesOf;
    compact = Boolean(options.compact);
    straightLine = Boolean(options.straightLine);
    mainLineIds = new Set(options.mainLineIds || []);
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

    function drawUnit(unit, shiftX, top) {
      const offsetX = unit.x + shiftX;
      unit.unions.forEach(union => union.children.forEach(child => { child.shift = child.sub.x - unit.x; }));
      const y = top + unit.level * rowHeight;
      const centerY = y + cardHeight / 2;
      const ownFamily = unit.unions.find(union => union.index === 0)?.family;
      drawPerson(unit.person, offsetX, y, ownFamily);
      const busLevels = busLevelsOf(unit.unions);
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
        const busY = childTop - 16 - 8 * busLevels.get(union);
        const childCenters = union.children.map(child => offsetX + child.shift + cardWidth / 2);
        const left = Math.min(dotX, ...childCenters);
        const right = Math.max(dotX, ...childCenters);
        edge(`M ${dotX} ${centerY + 6} V ${busY} M ${left} ${busY} H ${right}`);
        childCenters.forEach(x => edge(`M ${x} ${busY} V ${childTop}`));
        union.children.forEach(child => drawUnit(child.sub, shiftX, top));
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
    const all = [];
    units.forEach(unit => assignPositions(unit, unit.shift, null, null, all));
    if (options.compactRows !== false && !options.childrenUnderPerson) compactLayout(all, straightLine ? mainLineIds : new Set());
    const leftEdge = Math.min(...all.map(unit => unit.x + unit.rowMin));
    let firstRootCenter = 0;
    units.forEach((unit, index) => {
      if (index === 0) firstRootCenter = unit.x - leftEdge + padding + cardWidth;
      drawUnit(unit, padding - leftEdge, padding + 8);
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
