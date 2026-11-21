import {embeddedSources} from './embedded-sources-2.js';
import {jediEmbedded} from './jedi-3.js';
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor, compiled = new Map();
const args = ['workflow', 'trigger', 'ditem', 'rollUtils', 'tokenUtils', 'jediEmbedded'];
export const embeddedRegistry = {
  run(name, {workflow, trigger, ditem} = {}) {
    const source = embeddedSources[name];
    if (!source) throw Error('未注册的职业自动化：' + name);
    let fn = compiled.get(name);
    if (!fn) {fn = new AsyncFunction(...args, source); compiled.set(name, fn);}
    const helpers = globalThis.chrisPremades?.utils;
    return fn(workflow, trigger, ditem, helpers?.rollUtils, helpers?.tokenUtils, jediEmbedded);
  },
  validate() {
    return Object.entries(embeddedSources).map(([name, source]) => {
      try {new AsyncFunction(...args, source); return {name, ok: true};}
      catch (error) {return {name, ok: false, error: error.message};}
    });
  }
};
