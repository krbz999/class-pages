export class ClassPages extends Application {
  static MODULE = "class-pages";

  constructor(initial) {
    super();
    this.initial = initial;
  }

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "class-pages",
      classes: ["class-pages-list"],
      tabs: [],
      title: "CLASS_PAGES.ClassPages",
      template: "modules/class-pages/templates/pages.hbs",
      resizable: true,
      height: 1000,
      width: 800
    });
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    html[0].querySelectorAll("[data-action='toggle-item']").forEach(n => {
      n.addEventListener("click", this._onToggleItem.bind(this));
    });
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

  /**
   * Get the index objects of each type of compendium, each with enriched data.
   * @param {string} type             The type of compendium to index from 'classes', 'subclasses', 'spells'.
   * @param {string[]} fields         Additional fields to load.
   * @param {string} itemType         The item type to filter by from 'class', 'subclass', 'spell'.
   * @returns {Promise<object[]>}     An array of index objects from multiple compendiums.
   */
  async _getIndex(type, fields, itemType) {
    const keys = game.settings.get(ClassPages.MODULE, `${type}-packs`) ?? [];
    const packs = keys.reduce((acc, key) => {
      const pack = game.packs.get(key);
      if (pack) acc.push(pack.getIndex({fields: [...fields, "system.description.value"]}));
      return acc;
    }, []);
    const classes = new Set();
    const items = (await Promise.all(packs)).reduce((acc, pack) => {
      for (const idx of pack) {
        if (idx.type === itemType) {
          if (itemType === "class") {
            if (classes.has(idx.system.identifier)) {
              console.warn(`Duplicate class identifiers found. The class '${idx.name}' with uuid '${idx.uuid}' was skipped.`);
              continue;
            } else {
              classes.add(idx.system.identifier);
            }
          }
          acc.push(this._enrichData(idx));
        }
      }
      return acc;
    }, []);
    return Promise.all(items);
  }

  /** @override */
  async getData(options = {}) {
    const data = await super.getData(options);

    const nameSort = (a, b) => a.name.localeCompare(b.name);

    const loaded = await Promise.all([
      ["classes", ["system.identifier"], "class"],
      ["subclasses", ["system.classIdentifier"], "subclass"],
      ["spells", ["system.level", "system.school"], "spell"]
    ].map(([type, fields, itemType]) => this._getIndex(type, fields, itemType)));

    this.classes = data.classes = loaded[0];

    // Subclasses split by class identifier.
    const subclassIds = loaded[1].reduce((acc, idx) => {
      const key = idx.system.classIdentifier;
      if (!data.classes.some(c => c.system.identifier === key)) {
        console.warn(`The subclass '${idx.name}' has no matching class with class identifier '${key}'.`);
        return acc;
      }
      acc[key] ??= [];
      acc[key].push(idx);
      return acc;
    }, {});



    const setting = game.settings.get(ClassPages.MODULE, "spell-lists") ?? {};
    for (const c of data.classes) {
      // Add all subclasses to the class.
      c.subclasses = subclassIds[c.system.identifier].sort(nameSort);

      // Retrieve and enrich spell descriptions.
      const spellIds = setting[c.system.identifier] ?? [];
      const _spells = spellIds.reduce((acc, uuid) => {
        const idx = loaded[2].find(e => e.uuid === uuid);
        if (idx) acc.push(idx);
        return acc;
      }, []);

      // Create empty arrays.
      c.spellLists = Object.entries(CONFIG.DND5E.spellLevels).map(([n, label]) => ({level: n, label, spells: []}));

      // Push to array, partitioned by spell level.
      for (const spell of _spells) {
        const {level, school} = spell.system;
        if (!(level in CONFIG.DND5E.spellLevels) || !(school in CONFIG.DND5E.spellSchools)) {
          console.warn(`The spell '${spell.name}' has an invalid spell school ('${school}') or spell level ('${level}').`);
          continue;
        }
        c.spellLists[spell.system.level].spells.push(spell);
      }

      // Sort the spells.
      for (const spellList of c.spellLists) spellList.spells.sort(nameSort);
      c.hasSpells = _spells.length > 0;
    }

    // Sort the classes.
    data.classes.sort(nameSort);
    return data;
  }

  /**
   * Utility function to batch enrich an index entry.
   * @param {object} idx            One entry from a compendium's index.
   * @returns {Promise<object>}     A different object with more data.
   */
  async _enrichData(idx) {
    const [_, scope, key] = idx.uuid.split(".");
    const pack = `${scope}.${key}`;
    const desc = await TextEditor.enrichHTML(idx.system.description.value);
    const data = {...idx, id: idx._id, desc, pack};
    if (idx.type === "class") {
      const hasi18n = foundry.utils.getProperty(game.i18n.translations, `CLASS_PAGES.SubclassLabel${idx.system.identifier.capitalize()}`);
      let subclassLabel = hasi18n ? game.i18n.localize(hasi18n) : "Subclass";
      try {
        const setting = game.settings.get(ClassPages.MODULE, "subclass-labels")[idx.system.identifier];
        if (setting) subclassLabel = setting;
      } catch (err) {}
      data.subclassLabel = subclassLabel;
      try {
        data.backdrop = game.settings.get(ClassPages.MODULE, "class-backdrops")[idx.system.identifier];
      } catch (err) {
        data.backdrop = false;
      }
    }
    return data;
  }

  /** @override */
  async _renderInner(data) {
    const tabs = [{
      group: "page",
      navSelector: ".tabs[data-group=page]",
      contentSelector: ".page",
      initial: this.initial
    }];
    for (const cls of data.classes) {
      const id = cls.system.identifier;
      tabs.push({
        group: id,
        navSelector: `[data-tab='${id}'] .tabs[data-group=subpage]`,
        contentSelector: `[data-group=page][data-tab='${id}'] .subpage`
      }, {
        group: "spells",
        navSelector: `[data-group=page][data-tab='${id}'] .subpage .tabs[data-group=subsubpage]`,
        contentSelector: `[data-tab='${id}'] .subsubpage`
      });
    }
    this.options.tabs = tabs;
    this._tabs = this._createTabHandlers();
    return super._renderInner(data);
  }

  /**
   * Render this application.
   * @param {string} [initial=null]     The initial tab to render.
   * @returns {ClassPages}       The rendered application.
   */
  static show(initial = null) {
    const active = Object.values(ui.windows).find(w => w instanceof ClassPages);
    if (active) return active.render();
    return new ClassPages(initial).render(true);
  }

  /** @override */
  _getHeaderButtons() {
    const buttons = super._getHeaderButtons();
    if (game.user.isGM) {
      buttons.unshift({
        class: "class-pages-config",
        icon: "fa-solid fa-rectangle-list",
        label: "CLASS_PAGES.ClassPagesConfig",
        onclick: () => {
          new ClassPagesConfig(this.classes, this).render(true);
        }
      }, {
        class: "class-pages-config-backup",
        icon: "fa-solid fa-download",
        label: "CLASS_PAGES.ClassPagesConfigDownload",
        onclick: () => {
          const data = JSON.stringify(game.settings.get(ClassPages.MODULE, "spell-lists") ?? {});
          const type = "application/json";
          const name = "spell-list-backup-" + Date.now();
          return saveDataToFile(data, type, name);
        }
      }, {
        class: "class-pages-pack-settings",
        icon: "fa-solid fa-cog",
        label: "CLASS_PAGES.ClassPagesPackSettings",
        onclick: () => {
          new ClassPagesPackSettings(this.classes, this).render(true);
        }
      }, {
        class: "class-pages-art-settings",
        icon: "fa-solid fa-cog",
        label: "CLASS_PAGES.ClassPagesArtSettings",
        onclick: () => {
          new ClassPagesArtSettings(this.classes, this).render(true);
        }
      });
    }
    return buttons;
  }

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
          return ClassPages.show(initial ?? null);
        }
      });
    });

    for (const type of ["classes", "subclasses", "spells"]) {
      game.settings.register(ClassPages.MODULE, `${type}-packs`, {
        type: Array, config: false, scope: "world"
      });
    }

    for (const s of ["spell-lists", "subclass-labels", "class-backdrops"]) {
      game.settings.register(ClassPages.MODULE, s, {
        scope: "world", config: false, type: Object, default: {}
      });
    }
  }
}

/* Utility class for configuring spell lists. */
class ClassPagesConfig extends FormApplication {
  constructor(classes = [], pages) {
    super();
    this.classes = classes;
    this.pages = pages;
  }

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      width: "auto",
      template: "modules/class-pages/templates/config.hbs",
      classes: ["class-pages-config"],
      title: "CLASS_PAGES.ClassPagesConfig"
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
    const index = keys.reduce((acc, key) => {
      const pack = game.packs.get(key);
      if (!pack) return acc;
      for (const idx of pack.index) if (idx.type === "spell") acc.push(idx);
      return acc;
    }, []);
    const setting = game.settings.get(ClassPages.MODULE, "spell-lists") ?? {};

    const classes = {};
    for (const c of this.classes) {
      const list = setting[c.system.identifier] ?? [];
      classes[c.system.identifier] = {list, label: c.name};
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

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "modules/class-pages/templates/pack-settings.hbs",
      classes: ["class-pages-pack-settings"],
      title: "CLASS_PAGES.ClassPagesPackSettings",
      width: 400,
      height: "auto"
    });
  }

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

  async _updateObject() {
    const data = this.model.toObject();
    this.close();
    for (const key of ["classes", "subclasses", "spells"]) {
      game.settings.set(ClassPages.MODULE, `${key}-packs`, data[key].filter(u => u));
    }
  }

  async _onChangeInput(event) {
    const data = new FormDataExtended(this.form).object;
    for (const key of ["classes", "subclasses", "spells"]) {
      if (typeof data[key] === "string") data[key] = [data[key]];
      data[key] = data[key].filter(u => u);
    }
    this.model.updateSource(data);
    this.render();
  }

  activateListeners(html) {
    super.activateListeners(html);
    html[0].querySelectorAll("[data-action=delete]").forEach(n => {
      n.addEventListener("click", this._onDelete.bind(this));
    });
  }

  async _onDelete(event) {
    event.currentTarget.closest(".form-group").remove();
    return this._onChangeInput(event);
  }

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

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "modules/class-pages/templates/art-settings.hbs",
      classes: ["class-pages-art-settings"],
      title: "CLASS_PAGES.ClassPagesArtSettings",
      width: 500,
      height: "auto"
    });
  }

  async getData() {
    const backdrops = game.settings.get(ClassPages.MODULE, "class-backdrops") ?? {};
    const labels = game.settings.get(ClassPages.MODULE, "subclass-labels") ?? {};
    return {
      classes: this.classes.map(c => {
        const id = c.system.identifier;
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

  async _updateObject(event, data) {
    const {backdrops, labels} = foundry.utils.expandObject(data);
    for (const [key, val] of Object.entries(backdrops)) if (!val) backdrops[key] = null;
    for (const [key, val] of Object.entries(labels)) if (!val) labels[key] = null;

    return Promise.all([
      game.settings.set(ClassPages.MODULE, "class-backdrops", backdrops),
      game.settings.set(ClassPages.MODULE, "subclass-labels", labels)
    ]);
  }

  async _onChangeInput(event) {
    const target = event.currentTarget;
    target.value = target.value.trim();
  }
}

Hooks.once("init", ClassPages.init);
