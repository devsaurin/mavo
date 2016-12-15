(function($, $$) {

var _ = Mavo.Primitive = $.Class({
	extends: Mavo.Unit,
	constructor: function (element, mavo, o) {
		if (!this.fromTemplate("defaults", "attribute", "templateValue")) {
			this.defaults = _.getDefaults(element);

			// Which attribute holds the data, if any?
			// "null" or null for none (i.e. data is in content).
			this.attribute = _.getValueAttribute(this.element, this.defaults);
		}

		this.humanReadable = this.defaults.humanReadable;
		this.datatype = this.defaults.datatype;
		this.modes = this.modes || this.defaults.modes;
		this.mode = this.modes || "read";

		Mavo.hooks.run("primitive-init-start", this);

		if (this.defaults.init) {
			this.defaults.init.call(this, this.element);
		}

		if (this.defaults.changeEvents) {
			$.events(this.element, this.defaults.changeEvents, evt => {
				if (evt.target === this.element) {
					this.value = this.getValue();
				}
			});
		}

		/**
		 * Set up input widget
		 */

		if (!this.constant) {
			this.mavo.needsEdit = true;
		}

		// Nested widgets
		if (!this.editor && !this.attribute) {
			this.editor = $$(this.element.children).filter(function (el) {
			    return el.matches(Mavo.selectors.formControl) && !el.matches(Mavo.selectors.property);
			})[0];

			if (this.editor) {
				this.element.textContent = this.editorValue;
				$.remove(this.editor);
			}
		}

		// Linked widgets
		if (!this.editor && this.element.hasAttribute("data-edit")) {
			var original = $(this.element.getAttribute("data-edit"));

			if (original && Mavo.is("formControl", original)) {
				this.editor = original.cloneNode(true);

				// Update editor if original mutates
				if (!this.template) {
					new Mavo.Observer(original, "all", records => {
						for (let primitive of this.copies) {
							primitive.editor = original.cloneNode(true);
							primitive.setValue(primitive.value, {force: true, silent: true});
						}
					});
				}
			}
		}

		this.templateValue = this.getValue();

		this.default = this.element.getAttribute("data-default");

		if (this.constant || this.default === "") { // attribute exists, no value, default is template value
			this.default = this.templateValue;
		}
		else if (this.default === null) { // attribute does not exist
			this.default = this.editor? this.editorValue : this.emptyValue;
		}
		else {
			new Mavo.Observer(this.element, "data-default", record => {
				this.default = this.element.getAttribute("data-default");
			});
		}

		if (this.collection) {
			// Collection of primitives, deal with setting textContent etc without the UI interfering.
			var swapUI = callback => {
				this.sneak(() => {
					var ui = $.remove($(".mv-item-controls", this.element));

					var ret = callback();

					$.inside(ui, this.element);
				});

				return ret;
			};

			// Intercept certain properties so that any Mavo UI inside this primitive will not be destroyed
			["textContent", "innerHTML"].forEach(property => {
				var descriptor = Object.getOwnPropertyDescriptor(Node.prototype, property);

				Object.defineProperty(this.element, property, {
					get: function() {
						return swapUI(() => descriptor.get.call(this));
					},

					set: function(value) {
						swapUI(() => descriptor.set.call(this, value));
					}
				});
			});
		}

		if (!this.constant) {
			this.setValue(this.templateValue, {silent: true});
		}

		this.setValue(this.template? this.default : this.templateValue, {silent: true});

		// Observe future mutations to this property, if possible
		// Properties like input.checked or input.value cannot be observed that way
		// so we cannot depend on mutation observers for everything :(
		this.observer = new Mavo.Observer(this.element, this.attribute, records => {
			if (this.attribute || !this.editing) {
				this.value = this.getValue();
			}
		});
	},

	get editorValue() {
		if (this.getEditorValue) {
			var value = this.getEditorValue();

			if (value !== undefined) {
				return value;
			}
		}

		if (this.editor) {
			if (this.editor.matches(Mavo.selectors.formControl)) {
				return _.getValue(this.editor, {datatype: this.datatype});
			}

			// if we're here, this.editor is an entire HTML structure
			var output = $(Mavo.selectors.output + ", " + Mavo.selectors.formControl, this.editor);

			if (output) {
				return _.all.has(output)? _.all.get(output).value : _.getValue(output);
			}
		}
	},

	set editorValue(value) {
		if (this.setEditorValue && this.setEditorValue(value) !== undefined) {
			return;
		}

		if (this.editor) {
			if (this.editor.matches(Mavo.selectors.formControl)) {
				_.setValue(this.editor, value, {defaults: this.editorDefaults});
			}
			else {
				// if we're here, this.editor is an entire HTML structure
				var output = $(Mavo.selectors.output + ", " + Mavo.selectors.formControl, this.editor);

				if (output) {
					if (_.all.has(output)) {
						_.all.get(output).value = value;
					}
					else {
						_.setValue(output, value);
					}
				}
			}
		}
	},

	getData: function(o = {}) {
		var env = {
			context: this,
			options: o,
			data: this.super.getData.call(this, o)
		};

		if (env.data !== undefined) {
			return env.data;
		}

		env.data = this.value;

		if (env.data === "") {
			env.data = null;
		}

		Mavo.hooks.run("primitive-getdata-end", env);

		return env.data;
	},

	save: function() {
		this.savedValue = this.value;
		this.unsavedChanges = false;
	},

	done: function () {
		this.super.done.call(this);

		this.sneak(() => {
			if (this.defaults.done) {
				this.defaults.done.call(this);
				return;
			}

			if (this.popup) {
				this.popup.close();
			}
			else if (!this.attribute && this.editor) {
				$.remove(this.editor);
				this.element.textContent = this.editorValue;
			}
		});

		// Revert tabIndex
		if (this.element._.data.prevTabindex !== null) {
			this.element.tabIndex = this.element._.data.prevTabindex;
		}
		else {
			this.element.removeAttribute("tabindex");
		}
	},

	revert: function() {
		if (this.unsavedChanges && this.savedValue !== undefined) {
			// FIXME if we have a collection of properties (notgroups), this will cause
			// cancel to not remove new unsaved items
			// This should be fixed by handling this on the collection level.
			this.value = this.savedValue;
			this.unsavedChanges = false;
		}
	},

	sneak: function(callback) {
		this.observer? this.observer.sneak(callback) : callback();
	},

	// Called only the first time this primitive is edited
	initEdit: function () {
		if (!this.editor) {
			// No editor provided, use default for element type
			// Find default editor for datatype
			var editor = this.defaults.editor || Mavo.Elements["*"].editor;

			if (this.defaults.setEditorValue) {
				// TODO Temporary hack; refactor soon
				this.setEditorValue = this.defaults.setEditorValue;
			}

			this.editor = $.create($.type(editor) === "function"? editor.call(this) : editor);
			this.editorValue = this.value;
		}

		$.events(this.editor, {
			"input change": evt => {
				this.value = this.editorValue;
			},
			"focus": evt => {
				this.editor.select && this.editor.select();
			},
			"mavo:datachange": evt => {
				if (evt.property === "output") {
					evt.stopPropagation();
					$.fire(this.editor, "input");
				}
			}
		});

		if ("placeholder" in this.editor) {
			this.editor.placeholder = "(" + this.label + ")";
		}

		// Copy any data-input-* attributes from the element to the editor
		var dataInput = /^data-edit-/i;
		$$(this.element.attributes).forEach(function (attribute) {
			if (dataInput.test(attribute.name)) {
				this.editor.setAttribute(attribute.name.replace(dataInput, ""), attribute.value);
			}
		}, this);

		if (this.attribute) {
			this.popup = new _.Popup(this);
		}

		if (!this.popup) {
			this.editor.classList.add("mv-editor");
		}

		this.initEdit = null;
	},

	edit: function () {
		if (this.constant) {
			return;
		}

		this.super.edit.call(this);

		// Make element focusable, so it can actually receive focus
		this.element._.data.prevTabindex = this.element.getAttribute("tabindex");
		this.element.tabIndex = 0;

		if (this.defaults.edit) {
			this.defaults.edit.call(this);
			return;
		}

		(new Promise((resolve, reject) => {
			// Prepare for edit

			// Empty properties should become editable immediately
			// otherwise they could be invisible!
			if (this.empty && !this.attribute) {
				resolve();
			}

			this.element._.events({
				// click is needed too because it works with the keyboard as well
				"click.mavo:preedit": e => this.edit(),
				"focus.mavo:preedit": e => {
					resolve();
				},
				"click.mavo:edit": evt => {
					// Prevent default actions while editing
					// e.g. following links etc
					evt.preventDefault();
				}
			});

			var timer;

			if (!this.attribute) {
				// Hovering over the element for over 150ms will trigger edit
				this.element._.events({
					"mouseenter.mavo:preedit": e => {
						clearTimeout(timer);
						timer = setTimeout(resolve, 150);
					},
					"mouseleave.mavo:preedit": e => {
						clearTimeout(timer);
					}
				});
			}
		})).then(() => {
			// Actual edit
			this.element._.unbind(".mavo:preedit");

			if (this.initEdit) {
				this.initEdit();
			}

			if (this.popup) {
				this.popup.show();
			}
			else {
				this.editor.focus();
			}

			if (!this.attribute) {
				if (this.editor.parentNode != this.element) {
					this.editorValue = this.value;
					this.element.textContent = "";

					this.element.appendChild(this.editor);
				}
			}
		});
	}, // edit

	clear: function() {
		if (!this.constant) {
			this.value = this.emptyValue;
		}
	},

	render: function(data) {
		if (Array.isArray(data)) {
			data = data[0]; // TODO what is gonna happen to the rest? Lost?
		}

		if (typeof data === "object") {
			data = data[this.property];
		}

		if (data === undefined) {
			// New property has been added to the schema and nobody has saved since
			this.value = this.closestCollection? this.default : this.templateValue;
		}
		else {
			this.value = data;
		}

		this.save();
	},

	find: function(property) {
		if (this.property == property) {
			return this;
		}
	},

	/**
	 * Get value from the DOM
	 */
	getValue: function(o) {
		return _.getValue(this.element, {
			defaults: this.defaults,
			attribute: this.attribute,
			datatype: this.datatype
		});
	},

	lazy: {
		label: function() {
			return Mavo.readable(this.property);
		},

		emptyValue: function() {
			switch (this.datatype) {
				case "boolean":
					return false;
				case "number":
					return 0;
			}

			return "";
		},

		editorDefaults: function() {
			return this.editor && _.getDefaults(this.editor);
		}
	},

	setValue: function (value, o = {}) {
		this.sneak(() => {
			if ($.type(value) == "object" && "value" in value) {
				var presentational = value.presentational;
				value = value.value;
			}

			value = value || value === 0? value : "";
			value = _.safeCast(value, this.datatype);

			if (value == this._value && !o.force) {
				return value;
			}

			if (this.editor && document.activeElement != this.editor) {
				this.editorValue = value;
			}

			if (this.humanReadable && this.attribute) {
				presentational = this.humanReadable(value);
			}

			if (!this.editing || this.attribute) {
				if (this.editor && this.editor.matches("select") && this.editor.selectedOptions[0]) {
					presentational = this.editor.selectedOptions[0].textContent;
				}

				_.setValue(this.element, {value, presentational}, {
					defaults: this.defaults,
					attribute: this.attribute,
					datatype: this.datatype
				});
			}

			this.empty = value === "";

			this._value = value;

			if (!o.silent) {
				if (this.saved) {
					this.unsavedChanges = this.mavo.unsavedChanges = true;
				}

				requestAnimationFrame(() => this.dataChanged(value));
			}
		});

		return value;
	},

	dataChanged: function(value) {
		$.fire(this.element, "mavo:datachange", {
			property: this.property,
			value: value,
			mavo: this.mavo,
			node: this,
			action: "propertychange"
		});
	},

	live: {
		value: function (value) {
			return this.setValue(value);
		},

		empty: function (value) {
			var hide = value && // is empty
			!this.constant && // and editable
			!(this.attribute && $(Mavo.selectors.property, this.element)); // and has no property inside

			this.element.classList.toggle("mv-empty", hide);
		},

		hidden: function(value) {
			if (this._hidden !== value) {
				this._hidden = value;
				this.dataChanged();
			}
		}
	},

	static: {
		all: new WeakMap(),

		getDefaults: function (element) {
			var ret = null;

			for (var selector in Mavo.Elements) {
				if (element.matches(selector)) {
					ret = Mavo.Elements[selector];
				}
			}

			return ret;
		},

		getValueAttribute: function (element, defaults = _.getDefaults(element)) {
			var ret = element.getAttribute("data-attribute") || defaults.attribute;

			if (!ret || ret === "null") {
				ret = null;
			}

			return ret;
		},

		/**
		 * Only cast if conversion is lossless
		 */
		safeCast: function(value, datatype) {
			var existingType = typeof value;
			var cast = _.cast(value, datatype);

			if (value === null || value === undefined) {
				return value;
			}

			if (datatype == "boolean") {
				if (value === "false" || value === 0 || value === "") {
					return false;
				}

				if (value === "true" || value > 0) {
					return true;
				}

				return value;
			}

			if (datatype == "number") {
				if (/^[-+]?[0-9.e]+$/i.test(value + "")) {
					return cast;
				}

				return value;
			}

			return cast;
		},

		/**
		 * Cast to a different primitive datatype
		 */
		cast: function(value, datatype) {
			switch (datatype) {
				case "number": return +value;
				case "boolean": return !!value;
				case "string": return value + "";
			}

			return value;
		},

		getValue: function (element, {
			defaults = _.getDefaults(element),
			attribute = _.getValueAttribute(element, defaults),
			datatype = defaults.datatype
		}) {
			if (defaults.getValue && attribute == defaults.attribute) {
				return defaults.getValue(element);
			}

			var ret;

			if (attribute in element && _.useProperty(element, attribute)) {
				// Returning properties (if they exist) instead of attributes
				// is needed for dynamic elements such as checkboxes, sliders etc
				ret = element[attribute];
			}
			else if (attribute) {
				ret = element.getAttribute(attribute);
			}
			else {
				ret = element.getAttribute("content") || element.textContent || null;
			}

			return _.safeCast(ret, datatype);
		},

		setValue: function (element, value, {defaults, attribute, datatype}) {
			if ($.type(value) == "object" && "value" in value) {
				var presentational = value.presentational;
				value = value.value;
			}

			if (element.nodeType === 1) {
				defaults = defaults || _.getDefaults(element);
				attribute = attribute !== undefined? attribute : _.getValueAttribute(element, defaults);
				datatype = datatype !== undefined? datatype : defaults.datatype;

				if (defaults.setValue && attribute == defaults.attribute) {
					return defaults.setValue(element, value);
				}
			}

			if (attribute) {
				if (attribute in element && _.useProperty(element, attribute) && element[attribute] != value) {
					// Setting properties (if they exist) instead of attributes
					// is needed for dynamic elements such as checkboxes, sliders etc
					try {
						element[attribute] = value;
					}
					catch (e) {}
				}

				// Set attribute anyway, even if we set a property because when
				// they're not in sync it gets really fucking confusing.
				if (datatype == "boolean") {
					if (value != element.hasAttribute(attribute)) {
						$.toggleAttribute(element, attribute, value, value);
					}
				}
				else if (element.getAttribute(attribute) != value) {  // intentionally non-strict, e.g. "3." !== 3
					element.setAttribute(attribute, value);

					if (presentational) {
						element.textContent = presentational;
					}
				}
			}
			else {
				if (datatype === "number" && !presentational) {
					presentational = _.formatNumber(value);
				}

				element.textContent = presentational || value;

				if (presentational && element.setAttribute) {
					element.setAttribute("content", value);
				}
			}
		},

		/**
		 *  Set/get a property or an attribute?
		 * @return {Boolean} true to use a property, false to use the attribute
		 */
		useProperty: function(element, attribute) {
			if (["href", "src"].indexOf(attribute) > -1) {
				// URL properties resolve "" as location.href, fucking up emptiness checks
				return false;
			}

			if (element.namespaceURI == "http://www.w3.org/2000/svg") {
				// SVG has a fucked up DOM, do not use these properties
				return false;
			}

			return true;
		},

		lazy: {
			formatNumber: () => {
				var numberFormat = new Intl.NumberFormat("en-US", {maximumFractionDigits:2});

				return function(value) {
					if (value === Infinity || value === -Infinity) {
						// Pretty print infinity
						return value < 0? "-∞" : "∞";
					}

					return numberFormat.format(value);
				};
			}
		}
	}
});

_.Popup = $.Class({
	constructor: function(primitive) {
		this.primitive = primitive;

		this.popup = $.create("div", {
			className: "mv-popup",
			hidden: true,
			contents: [
				this.primitive.label + ":",
				this.editor
			],
			events: {
				keyup: evt => {
					if (evt.keyCode == 13 || evt.keyCode == 27) {
						if (this.popup.contains(document.activeElement)) {
							this.element.focus();
						}

						evt.stopPropagation();
						this.hide();
					}
				}
			}
		});

		// No point in having a dropdown in a popup
		if (this.editor.matches("select")) {
			this.editor.size = Math.min(10, this.editor.children.length);
		}
	},

	show: function() {
		$.unbind([this.element, this.popup], ".mavo:showpopup");

		this.shown = true;

		this.hideCallback = evt => {
			if (!this.popup.contains(evt.target) && !this.element.contains(evt.target)) {
				this.hide();
			}
		};

		this.position = evt => {
			var bounds = this.element.getBoundingClientRect();
			var x = bounds.left;
			var y = bounds.bottom;

			 // TODO what if it doesn’t fit?
			$.style(this.popup, { top:  `${y}px`, left: `${x}px` });
		};

		this.position();

		document.body.appendChild(this.popup);

		requestAnimationFrame(e => this.popup.removeAttribute("hidden")); // trigger transition

		$.events(document, "focus click", this.hideCallback, true);
		window.addEventListener("scroll", this.position);
	},

	hide: function() {
		$.unbind(document, "focus click", this.hideCallback, true);
		window.removeEventListener("scroll", this.position);
		this.popup.setAttribute("hidden", ""); // trigger transition
		this.shown = false;

		setTimeout(() => {
			$.remove(this.popup);
		}, parseFloat(getComputedStyle(this.popup).transitionDuration) * 1000 || 400); // TODO transition-duration could override this

		$.events(this.element, {
			"click.mavo:showpopup": evt => {
				this.show();
			},
			"keyup.mavo:showpopup": evt => {
				if ([13, 113].indexOf(evt.keyCode) > -1) { // Enter or F2
					this.show();
					this.editor.focus();
				}
			}
		});
	},

	close: function() {
		this.hide();
		$.unbind(this.element, ".mavo:edit .mavo:preedit .mavo:showpopup");
	},

	proxy: {
		"editor": "primitive",
		"element": "primitive"
	}
});

})(Bliss, Bliss.$);
