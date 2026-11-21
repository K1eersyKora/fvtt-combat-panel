import { SPRITE_PIXELS } from './sprite-pixels-1.js';
const textures=new Map(),materials=new Map();
function texture(T,asset){
  if(textures.has(asset))return textures.get(asset);
  const info=SPRITE_PIXELS[asset];if(!info)throw Error('Unknown pixel sprite');
  const bytes=Uint8Array.from(atob(info.rle),c=>c.charCodeAt(0)),data=new Uint8Array(info.width*info.height*4);let cursor=0;
  for(let p=0;p<bytes.length;p+=6){const n=bytes[p]+256*bytes[p+1];for(let i=0;i<n;i++)data.set(bytes.subarray(p+2,p+6),cursor++*4);}
  if(cursor!==info.width*info.height)throw Error('Invalid sprite RLE');
  const map=new T.DataTexture(data,info.width,info.height);map.colorSpace=T.SRGBColorSpace;if(T.sRGBEncoding!==undefined)map.encoding=T.sRGBEncoding;map.flipY=true;map.magFilter=map.minFilter=T.NearestFilter;map.generateMipmaps=false;map.needsUpdate=true;textures.set(asset,map);return map;
}
export function stormSprite(T,sprite){
  const key=sprite.asset+':'+sprite.tint;
  if(!materials.has(key))materials.set(key,new T.MeshBasicMaterial({map:texture(T,sprite.asset),color:sprite.tint??'#ffffff',side:T.DoubleSide,transparent:true,alphaTest:.25,depthWrite:true}));
  const geo=new T.PlaneGeometry(sprite.width,sprite.height),mesh=new T.Mesh(geo,materials.get(key));
  mesh.position.set(sprite.width/2,sprite.height/2,sprite.width/2);mesh.name='mcb-standee-'+sprite.asset;
  mesh.userData.sprite2d=true;mesh.userData.mcbBillboard=true;
  // Conservative display bounds for a rotating plane. This is NEVER a collider.
  geo.boundingBox=new T.Box3(new T.Vector3(-sprite.width/2,-sprite.height/2,-sprite.width/2),new T.Vector3(sprite.width/2,sprite.height/2,sprite.width/2));
  const parentQ=new T.Quaternion(),cameraQ=new T.Quaternion();
  mesh.onBeforeRender=function(renderer,scene,camera){camera.getWorldQuaternion(cameraQ);this.parent?.getWorldQuaternion(parentQ);this.quaternion.copy(parentQ.invert().multiply(cameraQ));this.updateMatrixWorld(true);};
  return mesh;
}
