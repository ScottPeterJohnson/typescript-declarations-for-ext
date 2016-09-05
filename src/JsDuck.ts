import fs = require('fs');
import path = require('path');

// This describes a subset of what JSDuck seems to produce when given the
// "--export=full" switch. There are no offical docs regarding this format.
export interface Class {
    name: string;
    alternateClassNames: string[];
    extends: string;
    singleton: boolean;
    members: Member[];
    mixins: string[];
    enum?: { type: string };
	short_doc: string;
}

export interface Member {
    tagname: string;
    name: string;
    type: string;
    private: boolean;
    protected: boolean;
    owner: string;
    static: boolean;
    optional: boolean;
    required: boolean;
    overrides: { name: string; owner: string; }[];
    params: Param[];
    return: Param;
	short_doc : string;
}

export interface Param {
    tagname: string;
    name: string;
    type: string;
    optional: boolean;
    properties?: Param[];
	short_doc : string;
}

export interface Module {
	name : string;
	classes: Class[];
}


export class ExtVersion {
    constructor(private inputDir: string, public docUrl : string) {
		this.read();
    }

    allClasses: Class[] = [];
    private nameMap: { [name: string]: Class } = {};
	modules : Module[] = [];

	public lookupClass(name: string):(Class|null) {
		return this.nameMap[name];
	}

	public lookupMember(cls : Class, name: string, tagNames?: string[], isStatic?: boolean):(Member|null) {
		for(let member of cls.members){
			let tagMatch = !tagNames || tagNames.indexOf(member.tagname) !== -1;
			let staticMatch = typeof isStatic !== 'boolean' || !!member.static === isStatic;
			if (member.name === name && tagMatch && staticMatch) {
				return member;
			}
		}
		return null;
	}

	public normalizeClassName(name: string):(string|null) {
		let cls = this.lookupClass(name);
		return cls && cls.name;
	}

	public convertFromExtType(senchaType: string,
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
				return SPECIAL_CASE_TYPE_MAPPINGS[typ] + arrays;
			} else {
				let cls = this.lookupClass(typ);
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

    /**
    * Reads all JsDuck documentation files in inputDir and parses them into classes.
    */
    private read() {
		let id = 0;
        let files = fs.readdirSync(this.inputDir);
        for (let file of files) {
            let jsonPath = path.join(this.inputDir, file);
            let cls = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            if (file.startsWith('Ext.')) { // ignore non-Ext files
                if (cls.tagname != 'class') {
                    throw 'Unknown top level tagname: ' + cls.tagname;
                }
                // workaround weirdness in the JSDuck output
                if (cls.name == 'Ext.Error') {
                    cls.extends = '';
                }
                this.allClasses.push(cls);
            }
        }

		//Populate name map for fast lookup
        for (let cls of this.allClasses) {
            this.nameMap[cls.name] = cls;
            for (let alternateName of cls.alternateClassNames) {
                this.nameMap[alternateName] = cls;
            }
        }
		//Populate modules
		let modulesDict = {};
		for(let cls of this.allClasses){
			let moduleName = cls.name.substring(0, cls.name.lastIndexOf('.'));
			modulesDict[moduleName] = modulesDict[moduleName] || [];
			modulesDict[moduleName].push(cls);
		}

		for (let module in modulesDict) {
			if (modulesDict.hasOwnProperty(module)) {
				this.modules.push({
					name: module,
					classes: modulesDict[module]
				});
			}
		}
		this.modules.sort(function(a, b) {
			return (a.name == b.name) ? 0 : (a.name < b.name ? -1 : 1);
		});
    }
}
