/* Wspólny moduł danych: wczytuje rodzina.sqlite (sql.js) i buduje model drzewa dla wszystkich stron. */
(function () {
  "use strict";

  function rows(db, sql) {
    const result = db.exec(sql);
    if (!result.length) return [];
    const { columns, values } = result[0];
    return values.map(row => Object.fromEntries(columns.map((column, index) => [column, row[index]])));
  }

  function compareIds(a, b) { return a.id - b.id; }

  /* Krótka nazwa do grafów: pierwsze imię + nazwisko rodowe (jeśli jest) albo nazwisko. */
  function shortName(person) {
    const surname = person.maiden || person.surname;
    return surname ? `${person.given} ${surname}` : person.given;
  }

  /* Nazwa rodziny, np. 'Leon Kuropka i Otylia Zimna'; nazwisko małżonka pomijane, gdy jest takie samo jak pierwszego. */
  function unionTitle(partners) {
    const [first, second] = partners;
    if (!second) return first ? shortName(first) : "";
    const sameSurname = !second.maiden && second.surname && second.surname === first.surname;
    return `${shortName(first)} i ${sameSurname ? second.given : shortName(second)}`;
  }

  /* Pełna nazwa, np. 'Jan / Johann Kuropka', 'Jadwiga / Hedwig Tira (Tyrra)'. */
  function fullName(row) {
    return [
      row.imie,
      row.drugie_imie,
      row.warianty_imienia && `/ ${row.warianty_imienia}`,
      row.nazwisko,
      row.warianty_nazwiska && `(${row.warianty_nazwiska})`
    ].filter(Boolean).join(" ");
  }

  function buildModel(personRows, unionRows, settingRows) {
    const people = new Map();
    personRows.forEach(row => {
      people.set(row.id, {
        id: row.id,
        name: fullName(row),
        given: row.imie,
        secondName: row.drugie_imie || undefined,
        surname: row.nazwisko || undefined,
        givenVariants: row.warianty_imienia || undefined,
        surnameVariants: row.warianty_nazwiska || undefined,
        maiden: row.nazwisko_rodowe || undefined,
        sex: row.plec === "M" ? "male" : row.plec === "K" ? "female" : "",
        birth: row.data_urodzenia || undefined,
        birthPlace: row.miejsce_urodzenia || undefined,
        death: row.data_zgonu || undefined,
        deathPlace: row.miejsce_zgonu || undefined,
        burial: row.miejsce_pochowku || undefined,
        parentUnionId: row.rodzice_zwiazek_id || null,
        childOrder: row.kolejnosc_dziecka,
        parentsNote: row.rodzice_opis || undefined,
        note: row.uwagi || undefined,
        unions: []
      });
    });

    const unions = new Map();
    unionRows.sort(compareIds).forEach(row => {
      const union = {
        id: row.id,
        partnerIds: [row.osoba1_id, row.osoba2_id].filter(id => people.has(id)),
        title: row.nazwa || "",
        marriageDate: row.data_slubu || "",
        marriagePlace: row.miejsce_slubu || "",
        note: row.uwagi || undefined,
        childIds: []
      };
      unions.set(row.id, union);
      union.partnerIds.forEach(id => people.get(id).unions.push(union.id));
    });

    people.forEach(person => {
      const union = unions.get(person.parentUnionId);
      if (union) union.childIds.push(person.id);
      else person.parentUnionId = null;
    });
    unions.forEach(union => {
      union.childIds.sort((a, b) => {
        const pa = people.get(a), pb = people.get(b);
        return (pa.childOrder ?? 1e9) - (pb.childOrder ?? 1e9) || a - b;
      });
      if (!union.title) union.title = unionTitle(union.partnerIds.map(id => people.get(id)));
    });

    people.forEach(person => {
      const parentUnion = unions.get(person.parentUnionId);
      if (parentUnion) person.parents = parentUnion.partnerIds.map(id => people.get(id).name);
      else if (person.parentsNote) person.parents = [person.parentsNote];
    });

    const settings = Object.fromEntries(settingRows.map(row => [row.klucz, row.wartosc]));
    return { people, unions, settings, shortName: person => shortName(person) };
  }

  /* Zagnieżdżona struktura rodzin (rodzina -> dzieci -> ich rodziny), używana przez widoki stron. */
  function buildFamilies(model) {
    const { people, unions } = model;
    const families = new Map();
    const attached = new Set();

    function makeFamily(union, bloodPerson) {
      attached.add(union.id);
      const partnerIds = bloodPerson
        ? [bloodPerson.id, ...union.partnerIds.filter(id => id !== bloodPerson.id)]
        : union.partnerIds;
      const family = {
        unionId: union.id,
        name: union.title,
        marriage: union.marriageDate ? `ślub ${union.marriageDate}` : undefined,
        marriagePlace: union.marriagePlace || undefined,
        partners: partnerIds.map(id => people.get(id)),
        children: union.childIds.map(id => people.get(id))
      };
      families.set(union.id, family);
      family.children.forEach(child => {
        const childUnions = child.unions.map(id => unions.get(id)).filter(u => !attached.has(u.id));
        const childFamilies = childUnions.map(u => makeFamily(u, child));
        if (childFamilies.length) {
          child.family = childFamilies[0];
          child.otherFamilies = childFamilies.slice(1);
        }
      });
      return family;
    }

    const roots = [];
    unions.forEach(union => {
      const isRoot = union.partnerIds.every(id => !people.get(id).parentUnionId);
      if (isRoot && !attached.has(union.id)) roots.push(makeFamily(union, null));
    });
    unions.forEach(union => {
      if (!attached.has(union.id)) roots.push(makeFamily(union, null));
    });
    return { families: roots, byUnionId: families };
  }

  /* Linia przodków od wskazanej osoby w górę; każde pokolenie: główny związek i ewentualne inne związki. */
  function buildAncestorLine(model) {
    const { people, unions, settings } = model;
    const start = people.get(Number(settings.linia_przodkow_od_osoby_id));
    if (!start) return [];
    const generations = [];
    let linePerson = start;
    let mainUnion = unions.get(start.unions[0]);
    if (!mainUnion) {
      mainUnion = unions.get(start.parentUnionId);
      linePerson = mainUnion ? people.get(mainUnion.partnerIds.find(id => people.get(id).parentUnionId) || mainUnion.partnerIds[0]) : null;
    }
    const visited = new Set();
    while (mainUnion && linePerson && !visited.has(mainUnion.id)) {
      visited.add(mainUnion.id);
      const spouseId = mainUnion.partnerIds.find(id => id !== linePerson.id);
      generations.push({
        union: mainUnion,
        person: linePerson,
        spouse: spouseId ? people.get(spouseId) : null,
        otherUnions: linePerson.unions.filter(id => id !== mainUnion.id).map(id => unions.get(id))
      });
      mainUnion = unions.get(linePerson.parentUnionId);
      if (!mainUnion) break;
      const nextId = mainUnion.partnerIds.find(id => people.get(id).parentUnionId) || mainUnion.partnerIds[0];
      linePerson = people.get(nextId);
    }
    return generations;
  }

  async function load(options = {}) {
    const dbUrl = options.dbUrl || "./rodzina.sqlite";
    const libPath = options.libPath || "./lib/";
    if (typeof initSqlJs !== "function") throw new Error("Nie załadowano biblioteki sql.js.");
    const [SQL, response] = await Promise.all([
      initSqlJs({ locateFile: file => libPath + file }),
      fetch(dbUrl, { cache: "no-store" })
    ]);
    if (!response.ok) throw new Error(`Nie można pobrać bazy danych (${response.status}).`);
    const db = new SQL.Database(new Uint8Array(await response.arrayBuffer()));
    try {
      const model = buildModel(
        rows(db, "SELECT * FROM osoby"),
        rows(db, "SELECT * FROM zwiazki"),
        rows(db, "SELECT klucz, wartosc FROM ustawienia")
      );
      const tree = buildFamilies(model);
      model.families = tree.families;
      model.familyByUnionId = tree.byUnionId;
      model.ancestorLine = buildAncestorLine(model);
      return model;
    } finally {
      db.close();
    }
  }

  window.DrzewoDB = { load, shortName };
})();
