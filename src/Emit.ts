import { ExtVersion, Class, Member, Module, Param } from "./JsDuck";
import jsesc = require('jsesc');

/**
* Places quotes around the given property name if necessary
*/
function quoteProperty(name: string):string {
	// due to unicode this is conservative, not precise, but that is OK
	let needsQuotes = !/^[a-zA-Z$_][a-zA-Z$_0-9]*$/.test(name);
	return needsQuotes ? ("'" + jsesc(name) + "'") : name;
}

let TYPESCRIPT_KEYWORDS = [
		'class', 'const', 'enum', 'export', 'extends', 'import', 'super',
		'implements', 'interface', 'let', 'package', 'private', 'protected',
		'public', 'static', 'yield'
	];
function escapeParamName(name: string):string {
	var keyword = TYPESCRIPT_KEYWORDS.indexOf(name) != -1;
	return keyword ? (name + '_') : name;
}

export class Emitter {
	constructor(public extVersion: ExtVersion) { }

	jsGlobalsToAlias : Set<String> = new Set();
	currentModule : Module;
	currentModuleClassBaseNames : Set<string>;

	convertFromExtType(senchaType: string,
						properties?: Param[]):string {
		let SPECIAL_CASE_TYPE_MAPPINGS = {
			'*': 'any',
			'Arguments': 'any',
			'Array': 'any[]',
			'boolean': 'boolean',
			'Boolean': 'boolean',
			'CSSStyleSheet': 'CSSStyleSheet',
			'CSSStyleRule': 'CSSStyleRule',
			'Date': 'Date',
			'Error': 'Error',
			'Event': 'Event',
			'Function': 'Function',
			'HtmlElement': 'HTMLElement',
			'HTMLElement': 'HTMLElement',
			'null': 'void',
			'number': 'number',
			'Number': 'number',
			'NodeList': 'NodeList',
			'Mixed': 'any',
			'Object': 'any',
			'RegExp': 'RegExp',
			'string': 'string',
			'String': 'string',
			'TextNode': 'Text',
			'undefined': 'void',
			'XMLElement': 'any',
			'Window': 'Window'
		};

		let mapSubType = (typ:string, needsBracket:boolean) => {
			let arrays = /(\[])*$/.exec(typ)[0];
			if (arrays) {
				typ = typ.substring(0, typ.length - arrays.length);
			}

			if (typ === 'Function' && properties) {
				// if no return type is specified, assume any - it is not safe to assume void
				let params : Array<string> = [];
				let retTyp = 'any';
				for(let property of properties){
					if (property.name === 'return') {
						retTyp = this.convertFromExtType(property.type, property.properties);
					} else {
						let opt = property.optional ? '?' : '';
						let typ = this.convertFromExtType(property.type, property.properties);
						params.push(property.name + opt + ': ' + typ);
					}
				}

				let fnType = '(' + params.join(', ') + ') => ' + retTyp;
				return ( (needsBracket || arrays) ? ('(' + fnType + ')') : fnType) + arrays;
			} else if(typ.startsWith('"') && typ.endsWith('"')) {
				return typ; //A string literal type; supported in later versions of Typescript
			} else if (SPECIAL_CASE_TYPE_MAPPINGS.hasOwnProperty(typ)) {
				let jsType = SPECIAL_CASE_TYPE_MAPPINGS[typ];
				if(this.currentModuleClassBaseNames.has(jsType)){
					this.jsGlobalsToAlias.add(jsType);
					jsType = "Js" + jsType;
				}
				return jsType + arrays;
			} else {
				let cls = this.extVersion.lookupClass(typ);
				if(!cls){
					console.warn('Warning: unable to find class, using "any" instead: "' + typ + '". Sencha type: \"' + senchaType + '\"');
					return 'any';
				}
				// enum types (e.g. Ext.enums.Widget) need special handling
				return (cls.enum ? this.convertFromExtType(cls.enum.type) : cls.name) + arrays;
			}
		}

		//Multiple types may be delineated by | or /
		let subTypes = senchaType.replace(/ /g, '').split(/[|\/]/);
		let mappedSubTypes = subTypes.map( (typ)=>mapSubType(typ, subTypes.length > 1) );

		return mappedSubTypes.join('|');
	}
	// Whether the visibility rules say we should emit this member
	isMemberVisible(cls: Class, member: Member):boolean {
		return member.protected ? (!cls.singleton && !member.static) : !member.private;
	}

	// Test if one of the parent classes of the given class will emit the given member
	doesParentEmitMember(cls: Class, memberName: string, staticSide:boolean):boolean {
		if (!cls.extends) { //No parent
			return false;
		}
		let parentCls = this.extVersion.lookupClass(cls.extends);
		if(!parentCls){ return false; }
		if (this.doesParentEmitMember(parentCls, memberName, staticSide)) {
			return true;
		}
		let member = this.extVersion.lookupMember(parentCls, memberName, ['property', 'method', 'cfg'], staticSide);
		return member && this.isMemberVisible(parentCls, member);
	}

	isConstructor(member : Member) : boolean {
		return member.tagname === "method" && member.name === "constructor";
	}

	shouldEmitMember(cls : Class, member : Member) : boolean {
		let isConstructor = this.isConstructor(member);
		if (cls.singleton && (member.static || isConstructor || !this.isMemberVisible(cls, member))) {
			return false;
		// Don't repeat inherited members, because they are already in the parent class
		// Ext sometimes has overrides with incompatible types too, which is weird.
	} else if (isConstructor){ //Always emit the new constructor.
		return true;
	}else if (!this.isMemberVisible(cls, member) || this.doesParentEmitMember(cls, member.name, member.static)){
		return false;
	}
		return true;
	}

	getClassBaseName(cls : Class) : string {
		return cls.name.substring(cls.name.lastIndexOf('.') + 1);
	}

	getConfigName(cls : Class){ return this.getClassBaseName(cls) + "Config"; }

	getModuleName(cls : Class){ return cls.name.substring(0,cls.name.lastIndexOf('.')); }

	getClassDocUrl(cls : Class){
		return this.extVersion.docUrl + cls.name;
	}
	getMemberDocUrl(cls : Class, member : Member){
		return this.extVersion.docUrl + cls.name + "-" + member.tagname + "-" + member.name;
	}

	/**
	* Construct a configuration object literal type for a constructor that accepts configuration.
	*/
	constructConfigurationInterface(cls : Class) : string {
		let willExtend = cls.extends && this.doesParentEmitMember(cls, "constructor", false);
		let memberTxt = cls.members.map((member)=>{
			if(member.tagname === "cfg"){
				let cfgType = this.convertFromExtType(member.type);
				if(willExtend && this.doesParentEmitMember(cls, member.name, false)){
					return null;
				}
				let optional = member.required ? '' : '?';
				return quoteProperty(member.name) + optional + ': ' + cfgType;
			} else { return null; }
		}).filter((txt)=>txt).join(",\n");
		let extend = willExtend ? (" extends " + this.extVersion.normalizeClassName(cls.extends) + "Config ") : "";
		return 'interface ' + this.getConfigName(cls) + extend + '{\n' + memberTxt + '\n}\n';
	}

	emitMember(cls: Class, member: Member): string {
		let isConstructor = this.isConstructor(member);
		if (!this.shouldEmitMember(cls, member)){ return ""; }

		let staticStr = (cls.singleton || member.static) ? 'static ' : '';
		let doc = '/* ' + (member.short_doc || "") + " " + this.getMemberDocUrl(cls, member) + ' */\n';

		if (member.tagname === 'property') {
			if (this.extVersion.lookupMember(cls, member.name, ['method'])) {
				console.warn('Warning: omitting property that also exists as a method: ' + cls.name + '.' + member.name);
				return;
			}

			let optional = member.optional ? '?' : '';
			let typ: string;
			let configTag = this.extVersion.lookupMember(cls, member.name, ['cfg']);
			if (!cls.singleton && configTag) {
				typ = this.convertFromExtType(configTag.type + '|' + member.type);
			} else {
				typ = this.convertFromExtType(member.type);
			}

			return doc + staticStr + quoteProperty(member.name) + optional + ": " + typ + ';';
		} else if (member.tagname === 'method') {
			let params: Array<string> = [];
			let prevParamNames = {};
			let returnType = member.return ? this.convertFromExtType(member.return.type, member.return.properties) : 'void';
			let returnString = isConstructor ? '' : ':' + returnType;
			let optional = false;

			for (var i = 0; i < member.params.length; i++) {
				let param = member.params[i];
				let paramName = escapeParamName(param.name);
				let typ = param.type;

				// Ext 5.1.0 has a method with a parameter documented twice, even though
				// it only exists once in the code (Ext.app.BaseController.redirectTo)
				if (prevParamNames[paramName]) {
					console.warn('Warning: skipping duplicate parameter ' + cls.name + '.' + member.name + '#' + paramName);
					continue;
				} else {
					prevParamNames[paramName] = true;
				}

				// after one optional parameter, all the following parameters must also be optional
				optional = optional || param.optional;

				if (/\.\.\.$/.test(typ)) {

					paramName = '...' + paramName;
					typ = typ.substring(0, typ.length - '...'.length) + '[]';
					optional = false;

					// deal with types like string|number
					if (/[|\/]/.test(typ)) {
						typ = 'Mixed[]';
					}

					// Typescript can't have parameters after a ...param, so we have to relax the type
					if (i < member.params.length - 1) {
						typ = 'Mixed[]';
						i = member.params.length; // skip remaining params
					}
				}

				if (isConstructor && param.name === "config") {
					typ = this.getConfigName(cls);
				} else {
					typ = this.convertFromExtType(typ, param.properties);
				}

				params.push(paramName + (optional ? '?' : '') + ": " + typ);
			}
			return doc + ' ' + staticStr + quoteProperty(member.name) + '(' + params.join(', ') + ')' + returnString + ';';
		}
		else if (member.tagname === 'cfg') {
			if (this.extVersion.lookupMember(cls, member.name, ['method', 'property'])) {
				return ''; // we will emit the method/property tag instead
			}
			if (!cls.singleton) {
				var typ = this.convertFromExtType(member.type);
				return doc + staticStr + quoteProperty(member.name) + ': ' + typ + ';';
			}
		}
	}

	emitClass(cls: Class): string {
		let constructorConfigurationInterface = "";
		let constructor = this.extVersion.lookupMember(cls, "constructor", ["method"]);
		let doc = '/* ' + (cls.short_doc || "") + " " + this.getClassDocUrl(cls) + ' */\n';
		if(constructor && this.shouldEmitMember(cls, constructor)){
			constructorConfigurationInterface = this.constructConfigurationInterface(cls);
		}
		let rootName = this.getClassBaseName(cls);
		let normalizedParent = cls.extends && this.extVersion.normalizeClassName(cls.extends);
		if (cls.extends && !normalizedParent) {
			console.warn('Warning: unable to find parent class, so omitting extends clause: ' + cls.extends);
		}

		let extend = (!cls.singleton && normalizedParent) ? (' extends ' + normalizedParent) : '';
		let declarationStart = (this.getModuleName(cls) ? 'export' : 'declare ') + ' class ' + rootName + extend + ' {\n';
		let memberDeclarations = cls.members.map((member : Member)=> this.emitMember(cls, member), this);
		let declarationEnd = '}';
		return constructorConfigurationInterface + doc + declarationStart + memberDeclarations.filter((decl)=>decl).join("\n") + declarationEnd;
	}

	emitModule(module: Module): string {
		this.currentModule = module;
		this.currentModuleClassBaseNames = new Set();
		for(let cls of module.classes){
				this.currentModuleClassBaseNames.add(this.getClassBaseName(cls));
		}

		let moduleStart = 'declare namespace ' + module.name + ' {';
		let containedClasses = module.classes.map(this.emitClass, this).join("\n");
		if(module.name){
			return moduleStart + containedClasses + "}";
		} else { //Don't declare the top-level module
			return containedClasses;
		}
	}

	emit(): string {
		let header = '// Ext type declarations (Typescript 1.8 or newer) generated on ' + new Date() + '\n';
		header += '// For more information, see: https://github.com/ScottPeterJohnson/typescript-declarations-for-ext\n';

		let declarationText = this.extVersion.modules.map(this.emitModule, this).join("\n");
		let jsGlobals = [...this.jsGlobalsToAlias].map((global)=>"type Js" + global + " = " + global +";\n").join("");
		return header + jsGlobals + declarationText;
	}
}
