const ID='fvtt-automation-repair';let shared;
export function namespaceSocket(namespace){
 shared??=socketlib.registerModule(ID);
 const key=name=>namespace+'.'+name;
 return {register:(name,fn)=>shared.register(key(name),fn),executeAsGM:(name,...args)=>shared.executeAsGM(key(name),...args),executeAsUser:(name,user,...args)=>shared.executeAsUser(key(name),user,...args),executeForEveryone:(name,...args)=>shared.executeForEveryone(key(name),...args),executeForOthers:(name,...args)=>shared.executeForOthers(key(name),...args)};
}
