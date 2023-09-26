class ClassPages extends Application {
  static MODULE = "class-pages";

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "class-pages",
      classes: ["class-pages-list"],
      tabs: [{
        group: "class",
        navSelector: "nav[data-group=subpage]",
        contentSelector: ".subpage"
      }, {
        group: "spells",
        navSelector: "nav[data-group=spells]",
        contentSelector: ".subsubpage"
      }],
      scrollY: [],
      title: "CLASS_PAGES.ClassPages",
      template: "modules/class-pages/templates/pages.hbs",
      resizable: true,
      height: 1000,
      width: 700
    });
  }

  /** @override */
  _restoreScrollPositions(html) {
    super._restoreScrollPositions(html);
    html[0].querySelector(".class-nav img.active")?.scrollIntoView({inline: "center"});
    if (this.options.subtab) this.activateTab(this.options.subtab);
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    html[0].querySelectorAll("[data-action='toggle-item']").forEach(n => {
      n.addEventListener("click", this._onToggleItem.bind(this));
    });
    html[0].querySelectorAll(".class-nav button[data-action]").forEach(n => {
      n.addEventListener("click", this._onClickDirection.bind(this));
    });
    html[0].querySelectorAll(".class-nav img[data-action]").forEach(n => {
      n.addEventListener("click", this._onClickClass.bind(this));
    });

    const debouncedScroll = foundry.utils.debounce(this._onGalleryScroll, 50);
    html[0].querySelector(".class-nav .gallery").addEventListener("wheel", debouncedScroll.bind(this));
  }

  /**
   * Handle the scroll event for the class icons gallery.
   * @param {WheelEvent} event      The scroll event.
   * @returns {Promise<ClassPages|null>}
   */
  async _onGalleryScroll(event) {
    const activeIcon = this.element[0].querySelector(".class-nav .gallery img.active");
    const direction = Math.sign(event.deltaY);
    const [first, last] = activeIcon.parentNode.querySelectorAll("img:first-child, img:last-child");
    let nextIcon = null;
    if (direction > 0) nextIcon = activeIcon.nextElementSibling || first;
    else nextIcon = activeIcon.previousElementSibling || last;
    return nextIcon ? this.renderPage(nextIcon.dataset.id) : null;
  }

  /**
   * Render the page based on the class identifier.
   * @param {string} classIdentifier      The identifier of the class to render.
   * @returns {Promise<ClassPages>}
   */
  async renderPage(classIdentifier) {
    return this.render(false, {classIdentifier});
  }

  /**
   * Handle clicking a specific class item in the top navigation.
   * @param {PointerEvent} event      The initiating click event.
   * @returns {Promise<ClassPages>}
   */
  _onClickClass(event) {
    return this.renderPage(event.currentTarget.dataset.id);
  }

  /**
   * Handle clicking a directional button on the main tab navigation.
   * @param {PointerEvent} event      The initiating click event.
   * @returns {ClassPages}
   */
  _onClickDirection(event) {
    const action = event.currentTarget.dataset.action;
    const nav = event.currentTarget.closest(".class-nav");
    const first = nav.querySelector("img:first-child");
    const last = nav.querySelector("img:last-child");
    const curr = nav.querySelector("img.active");
    let next;
    if (action === "left") {
      next = curr.previousElementSibling ?? last;
    } else {
      next = curr.nextElementSibling ?? first;
    }
    return this.renderPage(next.dataset.id);
  }

  /**
   * Toggle the description of an item.
   * @param {PointerEvent} event      The initiating click event.
   */
  async _onToggleItem(event) {
    const target = event.currentTarget;
    if (event.target.closest(".content-link, .item")) return;
    const uuid = target.dataset.uuid;
    if (target.classList.contains("expanded")) {
      const summary = target.parentNode.querySelector(".item-summary");
      if (summary) summary.remove();
    } else {
      const item = await fromUuid(uuid);
      const data = await item.getChatData();
      const div = document.createElement("DIV");
      div.innerHTML = await renderTemplate("systems/dnd5e/templates/items/parts/item-summary.hbs", data);
      div.firstElementChild.setAttribute("data-uuid", uuid);
      target.after(div.firstElementChild);
    }
    target.classList.toggle("expanded");
  }

  /** @override */
  async getData(options = {}) {
    const nameSort = (a, b) => a.name.localeCompare(b.name);

    // Find the current class and filter out any duplicate classes.
    const classPacks = game.settings.get(ClassPages.MODULE, "classes-packs") ?? [];
    let classes = await Promise.all(classPacks.map(p => game.packs.get(p)?.getIndex({
      fields: [
        "system.identifier", "data.identifier",
        "system.description.value", "data.description.value"
      ]
    }) ?? []));
    classes = classes.flatMap(c => Array.from(c)).reduce((acc, c) => {
      const id = c.system?.identifier ?? c.data?.identifier;
      if (!id || acc.set.has(id)) {
        console.warn(`Missing or duplicate class identifier found. The class '${c.name}' with uuid '${c.uuid}' was skipped.`);
        return acc;
      }
      acc.classes.push(c);
      acc.set.add(id);
      return acc;
    }, {set: new Set(), classes: []}).classes.sort(nameSort);
    const defaultIdentifier = classes[0]?.system.identifier ?? classes[0]?.data.identifier;
    const identifier = options.classIdentifier ?? defaultIdentifier;
    const cls = classes.find(c => (c.system?.identifier ?? c.data?.identifier) === identifier) ?? classes[0];

    if (!cls) return {};

    // Find all its subclasses.
    const subclassPacks = game.settings.get(ClassPages.MODULE, "subclasses-packs") ?? [];
    let subclasses = await Promise.all(subclassPacks.map(p => game.packs.get(p)?.getIndex({
      fields: [
        "system.classIdentifier", "data.classIdentifier",
        "system.description.value", "data.description.value"
      ]
    }) ?? []));
    subclasses = subclasses.flatMap(s => Array.from(s)).filter(s => (s.system?.classIdentifier ?? s.data?.classIdentifier) === identifier);
    subclasses.sort(nameSort);

    // Find all its spells.
    const spellPacks = game.settings.get(ClassPages.MODULE, "spells-packs") ?? [];
    let spells = await Promise.all(spellPacks.map(p => game.packs.get(p)?.getIndex({
      fields: [
        "system.school", "data.school",
        "system.level", "data.level"
      ]
    }) ?? []));
    const spellUuids = game.settings.get(ClassPages.MODULE, "spell-lists")?.[identifier] ?? [];
    spells = spells.flatMap(s => Array.from(s)).filter(s => spellUuids.includes(s.uuid));
    spells.sort(nameSort);

    // Construct data object.
    const data = {
      class: await this._enrichData(cls),
      identifier: identifier,
      subclasses: await Promise.all(subclasses.map(s => this._enrichData(s))),
      spells: await Promise.all(spells.map(s => this._enrichData(s, false))),
      classes: this.classes = classes // used by subapps
    };

    // Create spell lists for this class.
    data.spells = data.spells.reduce((acc, spell) => {
      const level = spell.system?.level ?? spell.data?.level;
      if (!Number.isNumeric(level)) return acc;
      if (!(level in CONFIG.DND5E.spellLevels)) return acc;
      acc[level] ??= {
        level: level,
        label: CONFIG.DND5E.spellLevels[level],
        spells: []
      };
      acc[level].spells.push(spell);
      return acc;
    }, {});
    data.spells = Object.values(data.spells).sort((a, b) => Number(a.level) - Number(b.level));

    // Get subclass label.
    const hasi18n = foundry.utils.getProperty(game.i18n.translations, `CLASS_PAGES.SubclassLabel${identifier.capitalize()}`);
    data.subclassLabel = hasi18n ? game.i18n.localize(hasi18n) : game.settings.get(ClassPages.MODULE, "subclass-labels")?.[identifier] ?? "Subclass";

    // Get backdrops for this class and all other classes.
    const backdrops = game.settings.get(ClassPages.MODULE, "class-backdrops") ?? {};
    data.backdrop = backdrops[identifier] ?? false;
    for (const c of classes) c.identifier = c.system?.identifier ?? c.data?.identifier;

    return data;
  }

  /**
   * Utility function to batch construct and enrich an index entry.
   * @param {object} idx                      One entry from a compendium's index.
   * @param {boolean} [description=true]      Enrich the description?
   * @returns {Promise<object>}               A different object with more data.
   */
  async _enrichData(idx, description = true) {
    const [_, scope, key] = idx.uuid.split(".");
    const pack = `${scope}.${key}`;
    const desc = description ? await TextEditor.enrichHTML(idx.system?.description?.value ?? idx.data?.description?.value ?? "", {async: true}) : null;
    return {...idx, id: idx._id, desc, pack};
  }

  /** @override */
  async render(force = false, options = {}) {
    this.options.classIdentifier ??= options.classIdentifier ?? null;
    this.options.subtab ??= options.subtab ?? null;
    return super.render(force, options);
  }

  /**
   * Render this application.
   * @param {string} [initial=null]     The initial tab to render.
   * @param {string} [subtab=null]      An initial subtab to render ('class', 'subclasses', 'spells').
   * @returns {Promise<ClassPages>}     The rendered application.
   */
  static async show(initial = null, subtab = null) {
    const active = Object.values(ui.windows).find(w => w instanceof ClassPages);
    if (active) return active.render(false, {classIdentifier: initial, subtab});
    return new ClassPages().render(true, {classIdentifier: initial, subtab});
  }

  /** @override */
  _getHeaderButtons() {
    const buttons = super._getHeaderButtons();
    if (game.user.isGM) {
      buttons.unshift({
        class: "class-pages-configuration",
        icon: "fa-solid fa-cog",
        onclick: () => new ClassPagesDialog(this.classes, this).render(true),
        label: "CLASS_PAGES.Settings"
      });
    }
    return buttons;
  }

  /** Initialize the module. */
  static init() {
    Hooks.on("getSceneControlButtons", (array) => {
      const token = array.find(a => a.name === "token");
      // Render the class page.
      token.tools.push({
        name: "class-page",
        title: "Class Pages",
        icon: "fa-solid fa-wand-magic-sparkles",
        button: true,
        visible: true,
        onClick: () => {
          const [initial] = Object.keys(game.user.character?.classes ?? {});
          return ClassPages.show(initial ?? null, null);
        }
      });
    });

    game.modules.get(ClassPages.MODULE).api = {
      show: ClassPages.show
    };

    for (const type of ["classes", "subclasses", "spells"]) {
      game.settings.register(ClassPages.MODULE, `${type}-packs`, {
        scope: "world", config: false, type: Array, default: []
      });
    }

    for (const s of ["spell-lists", "subclass-labels", "class-backdrops"]) {
      game.settings.register(ClassPages.MODULE, s, {
        scope: "world", config: false, type: Object, default: {}
      });
    }
  }
}

/* Utility dialog for rendering subapplications; spell list config, source config, art config, and download/upload. */
class ClassPagesDialog extends Application {

  constructor(classes, pages) {
    super();
    this.classes = classes;
    this.pages = pages;
  }

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "class-pages-dialog",
      width: 400,
      height: "auto",
      template: "modules/class-pages/templates/settings-prompt.hbs",
      title: "CLASS_PAGES.SettingsTitle",
      classes: ["class-pages-dialog"]
    });
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    html[0].querySelectorAll("[data-action]").forEach(n => {
      const action = n.dataset.action;
      if (action === "packs") n.addEventListener("click", this._onClickPacks.bind(this));
      else if (action === "art") n.addEventListener("click", this._onClickArt.bind(this));
      else if (action === "lists") n.addEventListener("click", this._onClickLists.bind(this));
      else if (action === "download") n.addEventListener("click", this._onClickDownload.bind(this));
      else if (action === "override") {
        const reader = new FileReader();
        n.addEventListener("click", this._onClickUpload.bind(reader));
        reader.addEventListener("load", this._onLoadOverride.bind(this, reader));
      } else if (action === "merge") {
        const reader = new FileReader();
        n.addEventListener("click", this._onClickUpload.bind(reader));
        reader.addEventListener("load", this._onLoadMerge.bind(this, reader));
      }
    });
  }

  /* -------------------- */
  /* Click event handlers */
  /* -------------------- */

  _onClickPacks(event) {
    new ClassPagesPackSettings(this.classes, this.pages).render(true);
    this.close();
  }

  _onClickArt(event) {
    new ClassPagesArtSettings(this.classes, this.pages).render(true);
    this.close();
  }

  _onClickLists(event) {
    new ClassPagesLists(this.classes, this.pages).render(true);
    this.close();
  }

  _onClickDownload(event) {
    const data = JSON.stringify(game.settings.get(ClassPages.MODULE, "spell-lists") ?? {});
    const type = "application/json";
    const name = "spell-list-backup-" + Date.now();
    return saveDataToFile(data, type, name);
  }

  async _onLoadMerge(reader) {
    const data = JSON.parse(reader.result);
    const current = game.settings.get(ClassPages.MODULE, "spell-lists") ?? {};
    for (const key in current) {
      const newData = new Set(data[key] ?? []);
      const oldData = new Set(current[key] ?? []);
      data[key] = Array.from(newData.union(oldData));
    }
    await game.settings.set(ClassPages.MODULE, "spell-lists", data);
    ui.notifications.info("CLASS_PAGES.NotifyMerge", {localize: true});
    this.close();
    this.pages.render();
  }

  async _onLoadOverride(reader) {
    const data = JSON.parse(reader.result);
    await game.settings.set(ClassPages.MODULE, "spell-lists", data);
    ui.notifications.info("CLASS_PAGES.NotifyOverride", {localize: true});
    this.close();
    this.pages.render();
  }

  _onClickUpload(event) {
    const reader = this;
    const file = event.currentTarget.previousElementSibling.files.item(0);
    if (!file) return;
    reader.readAsText(file);
  }
}

/* Utility class for configuring spell lists. */
class ClassPagesLists extends FormApplication {
  constructor(classes = [], pages) {
    super();
    this.classes = classes;
    this.pages = pages;
  }

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      width: "auto",
      template: "modules/class-pages/templates/list-settings.hbs",
      classes: ["class-pages-lists"],
      title: "CLASS_PAGES.SettingsListsTitle",
      filters: [{inputSelector: "#spell-list-filter", contentSelector: ".spells"}],
      id: "class-pages-lists"
    });
  }

  /** @override */
  _onSearchFilter(event, query, rgx, html) {
    let match;

    // level match
    match = query?.match(new RegExp("level:([0-9]+)"));
    const level = (match && match[1]) ? match[1] : null;
    if (level) query = query.replace(match[0], "").trim();

    // school match
    match = query?.match(new RegExp("school:([a-z]+)"));
    const school = (match && match[1]) ? match[1] : null;
    if (school) query = query.replace(match[0], "").trim();

    html.querySelectorAll(".label").forEach(n => {
      let show = true;
      if (level) show = show && (n.dataset.level == level);
      if (school) show = show && (n.dataset.school === school);
      if (query) show = show && new RegExp(query.toLowerCase().trim(), "i").test(SearchFilter.cleanQuery(n.innerText));

      n.closest(".form-group").style.display = show ? "" : "none";
    });
  }

  /** @override */
  async _updateObject(event, formData) {
    for (const c in formData) formData[c] = formData[c].filter(u => u);
    await game.settings.set(ClassPages.MODULE, "spell-lists", formData);
    this.pages.render();
  }

  /** @override */
  async getData() {
    const keys = game.settings.get(ClassPages.MODULE, "spells-packs") ?? [];
    const indices = await Promise.all(keys.map(key => game.packs.get(key)?.getIndex({
      fields: ["system.school", "system.level", "data.school", "data.level"]
    })));

    const index = indices.reduce((acc, indice) => {
      if (!indice) return acc;
      for (const idx of indice) if (idx.type === "spell") acc.push(idx);
      return acc;
    }, []);
    const setting = game.settings.get(ClassPages.MODULE, "spell-lists") ?? {};

    const classes = {};
    for (const c of this.classes) {
      const identifier = c.system?.identifier ?? c.data?.identifier ?? "";
      const list = setting[identifier] ?? [];
      classes[identifier] = {list, label: c.name};
    }

    const spells = [];
    for (const idx of index) {
      const spell = {...idx, classes: {}};
      for (const c in classes) spell.classes[c] = classes[c].list.includes(idx.uuid);
      spells.push(spell);
    }

    spells.sort((a, b) => a.name.localeCompare(b.name));

    return {spells, classes: this.classes};
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    html[0].querySelectorAll("[data-action=render]").forEach(n => {
      n.addEventListener("click", this._onClickRender.bind(this));
    });
    html[0].querySelector("#spell-list-filter").addEventListener("focus", event => event.currentTarget.select());
  }

  /** @override */
  async _onClickRender(event) {
    const uuid = event.currentTarget.closest("[data-uuid]").dataset.uuid;
    const item = await fromUuid(uuid);
    return item.sheet.render(true);
  }
}

/* Utility class for configuring compendium keys. */
class ClassPagesPackSettings extends FormApplication {
  constructor(classes, pages) {
    super();
    this.classes = classes;
    this.pages = pages;
  }

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "modules/class-pages/templates/pack-settings.hbs",
      classes: ["class-pages-pack-settings"],
      title: "CLASS_PAGES.SettingsPacksTitle",
      width: 400,
      height: "auto",
      id: "class-pages-pack-settings"
    });
  }

  /** @override */
  async getData() {
    return {
      model: this.model ??= new this.constructor._model({
        classes: game.settings.get(ClassPages.MODULE, "classes-packs") ?? [],
        subclasses: game.settings.get(ClassPages.MODULE, "subclasses-packs") ?? [],
        spells: game.settings.get(ClassPages.MODULE, "spells-packs") ?? []
      }),
      selectOptions: game.packs.reduce((acc, pack) => {
        if (pack.metadata.type === "Item") acc[pack.metadata.id] = pack.metadata.label;
        return acc;
      }, {})
    };
  }

  /** @override */
  async _updateObject() {
    const data = this.model.toObject();
    this.close();
    for (const key of ["classes", "subclasses", "spells"]) {
      await game.settings.set(ClassPages.MODULE, `${key}-packs`, data[key].filter(u => u));
    }
    this.pages.render();
  }

  /** @override */
  async _onChangeInput(event) {
    const data = new FormDataExtended(this.form).object;
    for (const key of ["classes", "subclasses", "spells"]) {
      if (typeof data[key] === "string") data[key] = [data[key]];
      data[key] = data[key].filter(u => u);
    }
    this.model.updateSource(data);
    this.render();
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    html[0].querySelectorAll("[data-action=delete]").forEach(n => {
      n.addEventListener("click", this._onDelete.bind(this));
    });
  }

  /**
   * Delete a form group.
   * @param {PointerEvent} event
   */
  async _onDelete(event) {
    event.currentTarget.closest(".form-group").remove();
    return this._onChangeInput(event);
  }

  /**
   * A data model instance.
   * @type {DataModel}
   */
  static get _model() {
    return class ClassPageSettingsModel extends foundry.abstract.DataModel {
      static defineSchema() {
        return {
          classes: new foundry.data.fields.SetField(new foundry.data.fields.StringField()),
          subclasses: new foundry.data.fields.SetField(new foundry.data.fields.StringField()),
          spells: new foundry.data.fields.SetField(new foundry.data.fields.StringField())
        };
      }
    };
  }
}

/* Utility class for configuring class backdrops and subclass labels. */
class ClassPagesArtSettings extends FormApplication {
  constructor(classes, pages) {
    super();
    this.classes = classes;
    this.pages = pages;
  }

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "modules/class-pages/templates/art-settings.hbs",
      classes: ["class-pages-art-settings"],
      title: "CLASS_PAGES.SettingsArtTitle",
      width: 500,
      height: "auto",
      id: "class-pages-art-settings"
    });
  }

  /** @override */
  async getData() {
    const backdrops = game.settings.get(ClassPages.MODULE, "class-backdrops") ?? {};
    const labels = game.settings.get(ClassPages.MODULE, "subclass-labels") ?? {};
    return {
      classes: this.classes.map(c => {
        const id = c.system?.identifier ?? c.data?.identifier ?? "";
        return {
          id: id,
          name: c.name,
          backdrop: backdrops[id] || null,
          label: labels[id] || null,
          formName: `backdrops.${id}`
        };
      })
    };
  }

  /** @override */
  async _updateObject(event, data) {
    const {backdrops, labels} = foundry.utils.expandObject(data) ?? {};
    for (const [key, val] of Object.entries(backdrops ?? {})) if (!val) backdrops[key] = null;
    for (const [key, val] of Object.entries(labels ?? {})) if (!val) labels[key] = null;

    await Promise.all([
      game.settings.set(ClassPages.MODULE, "class-backdrops", backdrops),
      game.settings.set(ClassPages.MODULE, "subclass-labels", labels)
    ]);
    this.pages.render();
  }

  /** @override */
  async _onChangeInput(event) {
    const target = event.currentTarget;
    target.value = target.value.trim();
  }
}

Hooks.once("init", ClassPages.init);
