import { ALL_STYLES as STYLES } from './storm-catalog-1.js';
import { stormSprite } from './storm-sprites-2.js';
const cache = new Map();
const rgb = hex => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
export function kitMaterial(T, styleId, role) {
  const key = `${styleId}:${role}`;
  if (cache.has(key)) return cache.get(key);
  const style = STYLES.find(s=>s.id===styleId), stone = role==='stone', timber = role==='wood';
  const tint = role==='paper'?'#d9cba8':role==='ember'?'#ecae51':role==='roof'?style.cloth:(style[role] ?? style.stone);
  const base=rgb(tint), pixels=new Uint8Array(64*64*4);
  for(let y=0;y<64;y++) for(let x=0;x<64;x++) {
    let shade = ((x*17+y*29+(x*y)%23)%11-5)*1.25;
    if(timber) shade += x%16<2?-28:((y+Math.floor(x/16)*11)%32<1?-15:0);
    if(stone) {
      if(style.pattern==='timber') shade += y%16<2 || (x+(Math.floor(y/16)%2)*16)%32<2 ? -22:0;
      if(style.pattern==='brick') shade += y%16<2 || (x+(Math.floor(y/16)%2)*16)%32<2 ? -33:0;
      if(style.pattern==='sandstone') shade += y%32<2?-27:(y%8===0?-10:0);
      if(style.pattern==='runes') shade += y%32<2 || x%32<2?-22:0;
    }
    if(['basalt','wetrock'].includes(role)) {shade+=x%16<2?-24:0;shade+=(y+(Math.floor(x/16)%3)*7)%32<2?-18:0;}
    if(role==='moss')shade+=(x*3+y*7)%13<3?18:-5;
    if(role.startsWith('crystal'))shade+=(x+y)%16<2?24:0;
    if(role==='water')shade+=(x+Math.floor(y/7)*3)%24<2?14:0;
    if(role==='roof') shade+=y%16<3 || (x+Math.floor(y/16)*8)%16<1?-25:0;
    if(role==='cloth') shade+=(x+y)%4===0?10:0;
    if(role==='trim'&&style.pattern==='sandstone') shade+=(x%16<4&&y%16<4)?22:0;
    let c=base.map(n=>Math.max(0,Math.min(255,Math.round(n+shade))));
    if(stone&&style.pattern==='runes'&&((x%32===15&&y%32>9&&y%32<24)||(y%32===16&&x%32>9&&x%32<21))) c=rgb(style.rune);
    pixels.set([...c,255],(y*64+x)*4);
  }
  const map=new T.DataTexture(pixels,64,64); map.colorSpace=T.SRGBColorSpace; if(styleId==='stormwreck'&&T.sRGBEncoding!==undefined)map.encoding=T.sRGBEncoding; map.wrapS=map.wrapT=T.RepeatWrapping; map.magFilter=map.minFilter=T.NearestFilter; map.generateMipmaps=false; map.needsUpdate=true;
  const m=new T.MeshStandardMaterial({map,roughness:role==='metal'?.75:1,metalness:role==='metal'?.25:0,side:T.DoubleSide});
  if(role==='ember') { m.emissive.set(tint); m.emissiveIntensity=.8; }
  if(role.startsWith('crystal')){m.emissive.set(tint);m.emissiveIntensity=.18;}
  if(role==='water'||role==='foam'){m.transparent=true;m.opacity=role==='water'?.62:.48;m.depthWrite=false;}
  cache.set(key,m); return m;
}
// Merge boxes by material inside each placeable item. Anchors remain on meshes
// for exact picking of thin shapes instead of the old half-cell occupancy map.
export function kitProp(T, entry, origin) {
  const root=new T.Group(), groups=new Map();
  for(const p of (entry.def.sprite?[]:entry.def.parts)) {
    const key=p.role, g=groups.get(key)??{positions:[],normals:[],uvs:[],indices:[]}; groups.set(key,g);
    const size=p.max.map((v,i)=>v-p.min[i]), geo=new T.BoxGeometry(...size), start=g.positions.length/3;
    const pos=geo.attributes.position, norm=geo.attributes.normal;
    for(let i=0;i<pos.count;i++) {
      const v=[pos.getX(i),pos.getY(i),pos.getZ(i)].map((v,a)=>v+(p.min[a]+p.max[a])/2), n=[norm.getX(i),norm.getY(i),norm.getZ(i)];
      g.positions.push(...v); g.normals.push(...n);
      // Physical-scale world-aligned UVs; no stretched whole-wall texture.
      const axis=n.findIndex(v=>Math.abs(v)>.5); g.uvs.push(v[(axis+1)%3],v[(axis+2)%3]);
    }
    g.indices.push(...Array.from(geo.index.array,n=>n+start)); geo.dispose();
  }
  for(const [role,g] of groups) {
    const geo=new T.BufferGeometry(); geo.setAttribute('position',new T.Float32BufferAttribute(g.positions,3)); geo.setAttribute('normal',new T.Float32BufferAttribute(g.normals,3)); geo.setAttribute('uv',new T.Float32BufferAttribute(g.uvs,2)); geo.setIndex(g.indices);
    const shared=kitMaterial(T,entry.def.style,role), m=entry.def.kind==='door'?shared.clone():shared, mesh=new T.Mesh(geo,m);
    if(entry.def.kind==='door') mesh.dispose=()=>m.dispose(); root.add(mesh);
  }
  if(entry.def.sprite)root.add(stormSprite(T,entry.def.sprite));
  if(entry.def.motion) { root.name='mcb-kit-motion'; root.userData.motion=entry.def.motion; root.userData.height=entry.def.height; }
  const orient=new T.Group(); orient.position.set(.5,0,.5); const pivot=new T.Group(); pivot.position.set(-.5,0,-.5); pivot.add(root); orient.add(pivot); orient.rotation.y=entry.def.rotation*Math.PI/2;
  const placement=new T.Group(); placement.position.set(...entry.local); placement.add(orient);
  const cell=entry.local.map((v,a)=>v+origin[a]*8);
  placement.traverse(o=>{o.userData.mcbAnchor=cell;o.userData.mcbKind=entry.def.kind;});
  return placement;
}
export function poseKitDoor(visual,open) {
  const moving=visual?.getObjectByName('mcb-kit-motion'); if(!moving) return false;
  if(moving.userData.motion==='trapdoor') moving.rotation.x=open?-Math.PI/2:0;
  if(moving.userData.motion==='portcullis') moving.position.y=open?moving.userData.height:0;
  return true;
}
