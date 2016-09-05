This takes JSDuck output (https://github.com/senchalabs/jsduck) and turns it into type declarations for Typescript (version 1.4+).

This is a fork of https://github.com/Dretch/typescript-declarations-for-ext
It adds short inline documentation to fields and methods and configuration interfaces for typing constructors.

Pre-generated declaration files
===============================

Check the releases tab.
Make an issue if you would like to see another one, or generate it yourself (see below).


Generating your own declaration file
====================================

The easiest way to do this is probably to modify `Main.ts` and add another entry to the `EXT_VERSIONS` array. You can then run `npm install` and `npm run generate` to run the script.
