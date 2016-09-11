This takes JSDuck output (https://github.com/senchalabs/jsduck) and turns it into type declarations for Typescript (version 1.8+).

This is a fork of https://github.com/Dretch/typescript-declarations-for-ext
It adds short inline documentation to fields and configuration interfaces for constructors.

Pre-generated declaration files
===============================

Check the releases tab. Only 4.2.1 is pregenerated at the moment.

Generating your own declaration file
====================================
The easiest way to do this is probably to modify `Main.ts` and add another entry to the `EXT_VERSIONS` array. You can then run `npm install` and `npm run generate` to run the script.
