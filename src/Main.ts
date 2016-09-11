/**
 * This script generates the default declaration files.
 *
 * It requires these external programs: wget, unzip and jsduck  (https://github.com/senchalabs/jsduck)
 */
import fs = require('fs');
import shelljs = require('shelljs');
import {ExtVersion, Class, Member} from "./JsDuck";
import {Emitter} from "./Emit";

let EXT_VERSIONS = [
		{ name: 'ExtJS-4.2.1.883', folder: 'ext-4.2.1.883', url: 'http://cdn.sencha.com/ext/gpl/ext-4.2.1-gpl.zip', jsduck_extra: '', docUrl: 'http://docs.sencha.com/extjs/4.2.5/#!/api/' }
	];

EXT_VERSIONS.forEach(function(version) {
	//Download and unzip ExtJS, then run JsDuck to get documentation
	let versionDirectory = 'build/' + version.name;
	shelljs.mkdir('-p', versionDirectory);

	shelljs.echo("Downloading " + version.name)
	shelljs.exec('wget --timestamping -P' + versionDirectory + " " + version.url);

	shelljs.echo("Extracting " + version.name);
	shelljs.exec('unzip -uq -d' + versionDirectory + " " + versionDirectory  + '/*.zip');

	let extjsFolder = versionDirectory + "/" + version.folder;
	let docsFolder = extjsFolder + '.docs';
	if(!fs.existsSync(docsFolder)){
		shelljs.echo("Running jsduck...");
		shelljs.mkdir('-p', docsFolder);
		shelljs.exec('jsduck ' + extjsFolder + '/src ' + version.jsduck_extra + ' --export=full --output ' + docsFolder);
	} else {
		shelljs.echo("jsduck skipped; " + docsFolder + " exists");
	}

	shelljs.echo("Running generator");
	let declarationOutput = versionDirectory + "/" + version.name + ".d.ts";

	var extVersion : ExtVersion = new ExtVersion(docsFolder, version.docUrl);
	let emitter = new Emitter(extVersion);
	console.log('Writing ' + extVersion.allClasses.length + " classes");
	let source = emitter.emit();
	fs.writeFileSync(declarationOutput, source);
	console.log('Wrote ' + extVersion.allClasses.length + ' class declarations into ' + process.argv[3]);

	// check that Typescript accepts the generated file
	shelljs.echo("Typings generated. Checking with tsc");
	let testFileContent = '/// <reference path="' + version.name + '.d.ts" />';
	let testFile = versionDirectory + "/test.ts";
	fs.writeFileSync(testFile, testFileContent);
	if (shelljs.exec('npm run tsc -- ' + testFile).code != 0) {
		shelljs.echo('Generation failure on ' + version.name + ', see error messages above');
		shelljs.exit(1);
	} else {
		shelljs.echo("Running tsfmt on generated file...");
		if(shelljs.exec("npm run tsfmt -- -r " + declarationOutput).code != 0){
			shelljs.echo('tsfmt failed- declaration usable but unformatted.');
			shelljs.exit(1);
		}
	}
});
